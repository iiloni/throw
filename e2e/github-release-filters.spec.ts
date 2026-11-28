import { createHmac, randomUUID } from 'node:crypto';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { card, cardIds, fixture, taskRow } from './board-helpers';
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

// The desktop bar's filter card; a phone's search page shows its card unnamed.
const filters = (page: Page, isMobile = false) =>
  isMobile ? page.locator('body') : page.getByRole('region', { name: 'Filters and sort' });
const section = (page: Page, name: 'Size' | 'Release') =>
  page
    .getByRole('tablist', { name: 'Filter type' })
    .getByRole('tab', { name, exact: true })
    .click();
// The bar's chips on a desktop, the board header's on a phone; not the search page's.
const chips = (page: Page) =>
  page
    .locator('header, [aria-label="Search the board"]')
    .getByRole('group', { name: 'Active filters' });

/** Opens the Links tab of a phone's or a narrow desktop pane, as these tests keep it. */
async function showLinks(page: Page) {
  const pane = page.getByLabel('Task', { exact: true });
  const tab = pane.getByRole('tab', { name: /^Links/ });
  await expect(tab).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  if ((await tab.getAttribute('aria-expanded')) !== 'true') await tab.click();
  await expect(tab).toHaveAttribute('aria-expanded', 'true');
  return pane;
}

/**
 * Review this and Low priority each have a merged pull request; Review this then ships in a
 * manual v0.1.0 release, as another device or MCP would record it.
 */
async function mergedBoard(page: Page) {
  const board = await fixture(page);
  const send = await connect(page.request, board.headers, board.projectId);
  for (const [title, number] of [
    ['Review this', 42],
    ['Low priority', 43],
  ] as const) {
    const row = await taskRow(page, board.headers, board.ids[title]!);
    await send('pull_request', {
      pull_request: {
        number,
        title: `Ship ${title} (BRD-${row?.number})`,
        head: { ref: `feat/brd-${row?.number}`, sha: `${number}`.padEnd(40, 'a') },
        state: 'closed',
        merged: true,
        merged_at: '2026-11-26T07:00:00Z',
        merge_commit_sha: `${number}`.padEnd(40, 'b'),
        draft: false,
        updated_at: '2026-11-26T07:00:00Z',
      },
    });
  }
  await expect
    .poll(async () => (await shapeRows(page.request, 'task-github-links', board.headers)).length)
    .toBe(2);
  async function release(tagName: string, taskTitle: string) {
    const base = `/api/integrations/github/projects/${board.projectId}/releases`;
    const created = await page.request.post(base, {
      headers: board.headers,
      data: { repo: REPO, tagName, publishedAt: '2026-11-26T08:00:00Z' },
    });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    const bound = await page.request.put(`${base}/${id}/tasks/${board.ids[taskTitle]}`, {
      headers: board.headers,
    });
    expect(bound.ok(), await bound.text()).toBe(true);
    return String(id);
  }
  return { ...board, release };
}

async function openFilters(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('combobox', { name: /^Search tasks/ })).toBeFocused();
    await page.getByRole('button', { name: 'Filter and sort', exact: true }).click();
  } else {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('searchbox', { name: 'Search tasks', exact: true })).toBeFocused();
    await page
      .getByRole('search', { name: 'Search the board', exact: true })
      .getByRole('button', { name: 'Filter and sort', exact: true })
      .click();
  }
  await expect(page.getByRole('tablist', { name: 'Filter type' })).toBeVisible();
  await section(page, 'Release');
}

test('merged work filters as unreleased until a release ships it, then by that release', async ({
  page,
  isMobile,
}) => {
  const board = await mergedBoard(page);
  await openFilters(page, isMobile);
  const unreleased = filters(page, isMobile).getByRole('button', { name: /^Unreleased,/ });
  await expect(unreleased).toHaveAccessibleName('Unreleased, 2 tasks');
  await unreleased.click();
  await expect(unreleased).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: test.info().outputPath('release-filter.png') });

  // Recorded elsewhere, v0.1.0 ships Review this: it leaves Unreleased and lists as a release.
  await board.release('v0.1.0', 'Review this');
  await expect(unreleased).toHaveAccessibleName('Unreleased, 1 task');
  const shipped = filters(page, isMobile).getByRole('button', { name: /^Release v0\.1\.0,/ });
  await expect(shipped).toHaveAccessibleName('Release v0.1.0, 1 task');
  await shipped.click();
  await unreleased.click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: test.info().outputPath('release-filter-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  if (isMobile) {
    await expect(page.getByText('1 task on the board', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
  }
  await expect.poll(() => cardIds(page, 'Review')).toEqual([board.ids['Review this']]);
  if (!isMobile) await expect.poll(() => cardIds(page, 'Build')).toEqual([]);
  const remove = chips(page).getByRole('button', {
    name: 'Remove release v0.1.0 filter',
    exact: true,
  });
  await expect(remove).toBeVisible();
  await remove.click();
  await expect(chips(page)).toHaveCount(0);
});

test('the task pane shows the release that shipped a task, or that its merge awaits one', async ({
  page,
  isMobile,
}) => {
  const board = await mergedBoard(page);
  await board.release('v0.1.0', 'Review this');
  await card(page, 'Review this').click();
  let pane = await showLinks(page);
  const releases = pane.getByRole('list', { name: 'Releases' });
  const pill = releases.getByRole('link', { name: 'Release v0.1.0. Open on GitHub' });
  await expect(pill).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await expect(pill).toHaveAttribute('href', `https://github.com/${REPO}/releases/tag/v0.1.0`);
  await expect(pill).toHaveAttribute('target', '_blank');
  await expect(releases).not.toContainText('unreleased');
  // The release leads the pull request that shipped.
  await expect(pane.getByRole('region', { name: 'GitHub' }).getByRole('heading')).toHaveText([
    'Release',
    'Pull requests',
  ]);
  await page.screenshot({ path: test.info().outputPath('release-pill.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: test.info().outputPath('release-pill-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });

  await page.goto(
    `/w/${board.workspaceId}/p/${board.projectId}?view=board&task=${board.ids['Low priority']}`,
  );
  pane = await showLinks(page);
  await expect(pane.getByRole('list', { name: 'Releases' })).toHaveText('Merged · unreleased', {
    timeout: APP_LOAD_TIMEOUT,
  });
  if (isMobile) await page.screenshot({ path: test.info().outputPath('unreleased-pill.png') });
});
