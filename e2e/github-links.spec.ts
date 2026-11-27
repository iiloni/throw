import { createHmac, randomUUID } from 'node:crypto';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { card, fixture, taskRow } from './board-helpers';
import { APP_LOAD_TIMEOUT, shapeRows } from './helpers';

type Headers = Record<string, string>;
const REPO = 'octo-org/website';

/** Connects the project to the repository and returns a sender of signed deliveries. */
async function connect(request: APIRequestContext, headers: Headers, projectId: string) {
  const response = await request.post(`/api/integrations/github/projects/${projectId}`, {
    headers,
    data: { repository: REPO },
  });
  expect(response.status()).toBe(201);
  const {
    secret,
    connection: { webhookUrl },
  } = await response.json();
  return async (event: string, fields: Record<string, unknown>) => {
    const body = JSON.stringify({ repository: { full_name: REPO }, ...fields });
    const delivered = await request.post(new URL(webhookUrl).pathname, {
      data: body,
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': event,
        'X-GitHub-Delivery': randomUUID(),
        'X-Hub-Signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
      },
    });
    expect(delivered.status(), await delivered.text()).toBe(200);
  };
}

/** An open pull request for `key`, approved, with one failing and two passing checks. */
async function reviewedPull(send: Awaited<ReturnType<typeof connect>>, key: string) {
  const pr = {
    number: 42,
    title: `Rework the review flow (${key})`,
    head: { ref: `feat/${key.toLowerCase()}-review`, sha: 'abc123' },
    state: 'open',
    draft: false,
    updated_at: '2026-11-25T09:00:00Z',
  };
  await send('pull_request', { pull_request: pr });
  await send('pull_request_review', {
    pull_request: pr,
    review: { id: 1, user: { id: 7 }, state: 'approved' },
  });
  const run = (id: number, conclusion: string) => ({
    id,
    check_suite: { id },
    head_sha: pr.head.sha,
    status: 'completed',
    conclusion,
    pull_requests: [{ number: pr.number }],
  });
  await send('check_run', { check_run: run(1, 'success') });
  await send('check_run', { check_run: run(2, 'success') });
  await send('check_run', { check_run: run(3, 'failure') });
  return pr;
}

async function linkRows(request: APIRequestContext, headers: Headers) {
  return shapeRows(request, 'task-github-links', headers);
}

/** Opens the Links tab of a phone's or a narrow desktop pane, as these tests keep it. */
async function showLinks(page: Page) {
  const pane = page.getByLabel('Task', { exact: true });
  const tab = pane.getByRole('tab', { name: /^Links/ });
  await expect(tab).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  // The pane remembers its tab, and the open tab's button folds it away.
  if ((await tab.getAttribute('aria-expanded')) !== 'true') await tab.click();
  await expect(tab).toHaveAttribute('aria-expanded', 'true');
  return pane;
}

test('a linked pull request shows on its card and as a live card in the task pane', async ({
  page,
  isMobile,
}) => {
  const board = await fixture(page);
  const id = board.ids['Review this']!;
  const row = await taskRow(page, board.headers, id);
  const key = `BRD-${row?.number}`;
  const send = await connect(page.request, board.headers, board.projectId);
  const pr = await reviewedPull(send, key);
  await expect.poll(async () => (await linkRows(page.request, board.headers)).length).toBe(1);

  const reviewCard = card(page, 'Review this');
  const mark = reviewCard.locator('[data-github-mark]');
  await expect(mark).toHaveText('#42');
  await expect(mark).toHaveAttribute('data-color', 'red');
  await expect(card(page, 'Low priority').locator('[data-github-mark]')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('board-mark.png') });

  if (isMobile) {
    // A touch screen's mark is only a mark: tapping it opens the task, as the rest of the card.
    await expect(reviewCard.getByRole('img', { name: /^Pull request #42, open/ })).toBeVisible();
    await expect(reviewCard.getByRole('link')).toHaveCount(0);
    await mark.tap();
  } else {
    // A mouse lingers on the mark for a glass preview, whose links open GitHub, not the task.
    const link = reviewCard.getByRole('link', { name: /Pull request #42, open, checks failing/ });
    await expect(link).toHaveAttribute('href', `https://github.com/${REPO}/pull/42`);
    await expect(link).toHaveAttribute('target', '_blank');
    await link.hover();
    const preview = page.locator('[data-github-preview]');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText(pr.title);
    await expect(preview).toContainText('Approved');
    await expect(preview).toContainText(pr.head.ref);
    await expect(preview.getByRole('img', { name: 'Checks: 1 failed, 2 passed' })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('board-preview.png') });
    await page.emulateMedia({ colorScheme: 'dark' });
    // The theme cross-fades; the capture waits for it to settle.
    await page.waitForTimeout(800);
    await page.screenshot({ path: test.info().outputPath('board-preview-dark.png') });
    await page.emulateMedia({ colorScheme: 'light' });
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      preview.getByRole('link', { name: /Open on GitHub/ }).click(),
    ]);
    expect(popup.url()).toBe(`https://github.com/${REPO}/pull/42`);
    await popup.close();
    // Neither the press nor the click opened the task or picked the card up.
    await expect(page.getByLabel('Task', { exact: true })).toHaveCount(0);
    await expect(reviewCard).not.toHaveAttribute('aria-current', 'true');
    await page.mouse.move(0, 0);
    await expect(preview).toHaveCount(0);
    // The keyboard reaches the mark from its card and previews it on focus.
    await reviewCard.focus();
    await page.keyboard.press('Tab');
    await expect(link).toBeFocused();
    await expect(preview).toBeVisible();
    await page.keyboard.press('Escape');
    await reviewCard.click();
  }

  const pane = await showLinks(page);
  const github = pane.getByRole('region', { name: 'GitHub' });
  const item = github.getByRole('link', { name: new RegExp(`Pull request ${REPO}#42`) });
  await expect(item).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await expect(item).toHaveAttribute('href', `https://github.com/${REPO}/pull/42`);
  await expect(item).toContainText(pr.title);
  await expect(item).toContainText('Open');
  await expect(item).toContainText('Approved');
  await expect(item).toContainText(pr.head.ref);
  await page.screenshot({ path: test.info().outputPath('task-pane-pull.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: test.info().outputPath('task-pane-pull-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });

  // A delivery updates the card where it is: merged, it turns violet on the board too.
  await send('pull_request', {
    pull_request: {
      ...pr,
      state: 'closed',
      merged: true,
      merged_at: '2026-11-26T07:00:00Z',
      updated_at: '2026-11-26T07:00:00Z',
    },
  });
  await expect(item).toContainText('Merged');
  await expect(item).not.toContainText('Open');
  if (!isMobile) await expect(mark).toHaveAttribute('data-color', 'violet');

  await github.getByRole('button', { name: `Remove pull request ${REPO}#42` }).click();
  await expect(github).toHaveCount(0);
  await expect.poll(async () => (await linkRows(page.request, board.headers)).length).toBe(0);
  if (!isMobile) await expect(mark).toHaveCount(0);
});

test('a pasted pull request or issue links from the picker once the project is connected', async ({
  page,
}) => {
  const board = await fixture(page);
  const id = board.ids['Low priority']!;
  await page.goto(`/w/${board.workspaceId}/p/${board.projectId}?view=board&task=${id}`);
  let pane = await showLinks(page);
  // Unconnected, the picker takes tasks only: a pasted address is a search like any other.
  await pane.getByRole('button', { name: 'Link a task', exact: true }).click();
  const field = page.getByRole('combobox', { name: 'Find a task' });
  await expect(field).toHaveAttribute('placeholder', 'Search every project by title or key');
  await field.fill(`https://github.com/${REPO}/issues/81`);
  await expect(page.locator('[data-github-option]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await connect(page.request, board.headers, board.projectId);
  await page.reload();
  pane = await showLinks(page);
  await pane.getByRole('button', { name: 'Link a task, PR or issue', exact: true }).click();
  await expect(field).toHaveAttribute('placeholder', 'Search tasks, or paste a GitHub link');
  // Another repository's item is explained rather than offered.
  await field.fill('https://github.com/someone/else/pull/3');
  const option = page.locator('[data-github-option]');
  await expect(option).toContainText(`This project follows ${REPO}.`);
  await expect(option).toBeDisabled();
  await expect(page.getByRole('radiogroup', { name: 'Relation' })).toBeHidden();
  await field.fill(`https://github.com/${REPO}/issues/81`);
  await expect(option).toContainText('Link issue #81');
  await page.screenshot({ path: test.info().outputPath('picker-github.png') });
  await field.press('Enter');
  await expect(page.getByRole('listbox', { name: 'Tasks to link' })).toHaveCount(0);

  pane = await showLinks(page);
  const github = pane.getByRole('region', { name: 'GitHub' });
  await expect(github.getByRole('heading', { name: 'Issues' })).toBeVisible();
  const issue = github.getByRole('link', { name: new RegExp(`Issue ${REPO}#81`) });
  await expect(issue).toContainText('Open');
  await expect.poll(async () => (await linkRows(page.request, board.headers)).length).toBe(1);

  // The same item again is already there.
  await pane.getByRole('button', { name: 'Link a task, PR or issue', exact: true }).click();
  await field.fill(`https://github.com/${REPO}/issues/81`);
  await expect(option).toContainText('Already linked to this task.');
  await page.keyboard.press('Escape');

  // Disconnected, the link can still be removed, and the picker takes tasks only again.
  const removed = await page.request.delete(
    `/api/integrations/github/projects/${board.projectId}`,
    { headers: board.headers },
  );
  expect(removed.ok()).toBe(true);
  await page.reload();
  pane = await showLinks(page);
  await pane
    .getByRole('region', { name: 'GitHub' })
    .getByRole('button', { name: `Remove issue ${REPO}#81` })
    .click();
  await expect(pane.getByRole('region', { name: 'GitHub' })).toHaveCount(0);
  await expect(pane.getByRole('button', { name: 'Link a task', exact: true })).toBeVisible();
});

test('a wide desktop pane opens its side column for a task with only GitHub links', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'A phone keeps its stacked layout (ADR 0009)');
  const board = await fixture(page);
  const id = board.ids['Review this']!;
  const row = await taskRow(page, board.headers, id);
  const send = await connect(page.request, board.headers, board.projectId);
  await reviewedPull(send, `BRD-${row?.number}`);
  await page.goto(`/w/${board.workspaceId}/p/${board.projectId}?view=board&task=${id}`);
  const pane = page.getByLabel('Task', { exact: true });
  await expect(pane.getByRole('tab', { name: 'Links · 1' })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
  const handle = page.getByRole('separator', { name: 'Resize task' });
  await handle.focus();
  while (Number(await handle.getAttribute('aria-valuenow')) < 620)
    await handle.press('Shift+ArrowLeft');
  const column = pane.getByRole('complementary', { name: 'Task sidebar' });
  await expect(column.getByRole('region', { name: 'GitHub' })).toBeVisible();
  await expect(column.getByRole('heading', { name: 'Pull requests' })).toBeVisible();
  await expect(pane.getByRole('tab', { name: /^Links/ })).toHaveCount(0);
  await expect
    .poll(() => column.evaluate((element) => getComputedStyle(element).opacity))
    .toBe('1');
  await page.screenshot({ path: test.info().outputPath('side-column.png') });
});

test('the prototype board shows no GitHub marks', async ({ page }) => {
  await page.goto('/prototype/board');
  await expect(page.getByRole('article').first()).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await expect(page.locator('[data-github-mark]')).toHaveCount(0);
});
