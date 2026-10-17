import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { APP_LOAD_TIMEOUT, shapeRows, signUp, waitForDeviceSync } from './helpers';

async function fixture(page: Page) {
  const account = await signUp(page);
  const [workspace] = await shapeRows(page.request, 'workspaces', account.headers);
  const workspaceId = String(workspace?.id);
  async function project(name: string, key: string, position: string) {
    const id = randomUUID();
    const statuses = (['backlog', 'active', 'done', 'cancelled'] as const).map((category) => ({
      id: randomUUID(),
      category,
      name: category === 'backlog' ? 'Ideas' : category,
      position: 'a0',
      isDefault: true,
    }));
    const response = await page.request.post('/api/projects', {
      headers: account.headers,
      data: { id, workspaceId, name, key, color: 'teal', icon: null, position, statuses },
    });
    expect(response.status()).toBe(201);
    return { id, statuses };
  }
  const catchProject = await project('Catch', 'CAT', 'a0');
  const throwProject = await project('Throw', 'THR', 'a1');
  async function task(
    project: typeof catchProject,
    title: string,
    closed = false,
    parentId: string | null = null,
  ) {
    const id = randomUUID();
    const response = await page.request.post('/api/tasks', {
      headers: account.headers,
      data: {
        id,
        projectId: project.id,
        title,
        statusId: project.statuses[closed ? 2 : 1]?.id,
        position: 'a0',
        parentId,
        description: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Local description needle' }] },
        ],
        descriptionVersion: randomUUID(),
      },
    });
    expect(response.status()).toBe(201);
    return id;
  }
  const first = await task(catchProject, 'Fix keyboard capture');
  await task(catchProject, 'Closed palette task', true);
  await task(catchProject, 'Small nested job', false, first);
  const remote = await task(throwProject, 'Review workspace search');
  await page.goto(`/w/${workspaceId}/p/${catchProject.id}?view=board`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Catch', {
    timeout: APP_LOAD_TIMEOUT,
  });
  await expect(
    page.getByRole('article', { name: 'CAT-1 Fix keyboard capture', exact: true }),
  ).toBeVisible();
  return { ...account, workspaceId, catchProject, throwProject, first, remote };
}
const palette = (page: Page) => page.getByRole('dialog', { name: 'Search', exact: true });
const capture = (page: Page) => page.getByRole('dialog', { name: 'New task', exact: true });
const input = (page: Page) => page.getByRole('combobox', { name: 'Search tasks and projects' });
async function open(page: Page, mobile = false) {
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  if (mobile) {
    // A phone's search is a drawer page, which takes focus itself (ADR 0009).
    await expect(palette(page)).toBeFocused();
    await input(page).click();
  }
  await expect(input(page)).toBeFocused();
}
async function closeSearch(page: Page, mobile: boolean) {
  await page.getByRole('button', { name: mobile ? 'Close' : 'Close search', exact: true }).click();
}
async function closeTask(page: Page, mobile: boolean) {
  await page
    .getByRole('button', { name: mobile ? 'Back to the board' : 'Close task', exact: true })
    .click();
}
function taskPane(page: Page, mobile: boolean) {
  return page.getByRole(mobile ? 'dialog' : 'region', { name: 'Task', exact: true });
}

test('palette searches titles, identifiers, description, closed tasks and subtasks with project/workspace scope', async ({
  page,
  isMobile,
}) => {
  await fixture(page);
  await open(page, isMobile);
  await expect(palette(page).getByRole('button', { name: 'Remove Catch filter' })).toBeVisible();
  await input(page).fill('keyboard');
  const result = palette(page).getByRole('option', { name: /Fix keyboard capture/ });
  await expect(result).toContainText('CAT-1');
  await expect(result).toContainText('Catch');
  await expect(result).toContainText('active');
  await input(page).press('Enter');
  await expect(taskPane(page, isMobile).getByRole('textbox', { name: 'Task title' })).toHaveValue(
    'Fix keyboard capture',
  );
  if (!isMobile)
    await expect(page.getByRole('button', { name: 'Close task', exact: true })).toBeFocused();
  await closeTask(page, isMobile);
  for (const query of ['CAT-1', '1']) {
    await open(page, isMobile);
    await input(page).fill(query);
    await expect(palette(page).getByRole('listbox').getByRole('option').first()).toContainText(
      'Fix keyboard capture',
    );
    await input(page).press('Enter');
    await expect(taskPane(page, isMobile)).toContainText('CAT-1');
    await closeTask(page, isMobile);
  }
  await open(page, isMobile);
  await input(page).fill('needle');
  await expect(palette(page).getByRole('option', { name: /Fix keyboard capture/ })).toBeVisible();
  await expect(palette(page).getByRole('option', { name: /Closed palette task/ })).toBeVisible();
  await expect(palette(page).getByRole('option', { name: /Small nested job/ })).toBeVisible();
  await input(page).fill('workspace search');
  await expect(palette(page).getByRole('option', { name: /Review workspace search/ })).toHaveCount(
    0,
  );
  await palette(page).getByRole('button', { name: 'Remove Catch filter' }).click();
  await palette(page)
    .getByRole('option', { name: /Review workspace search/ })
    .click();
  await expect(taskPane(page, isMobile).getByRole('textbox', { name: 'Task title' })).toHaveValue(
    'Review workspace search',
  );
});

test('project jump, shortcut, arrow selection, Escape and focus return', async ({
  page,
  isMobile,
}) => {
  await fixture(page);
  if (isMobile) await open(page, isMobile);
  else {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(input(page)).toBeFocused();
  }
  await input(page).fill('Throw');
  await input(page).press('ArrowDown');
  await input(page).press('ArrowUp');
  await input(page).press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Throw');
  await expect(palette(page)).toHaveCount(0);
  await open(page, isMobile);
  await page.keyboard.press('Escape');
  await expect(palette(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeFocused();
});

test('quick capture uses backlog default and chooses another project without losing its title', async ({
  page,
  isMobile,
}) => {
  const account = await fixture(page);
  if (isMobile) {
    // The dock's create button opens capture as a drawer page.
    await page.getByRole('button', { name: 'New task', exact: true }).click();
    await expect(capture(page)).toBeFocused();
    const title = capture(page).getByRole('textbox', { name: 'Task title' });
    await title.fill('A newly captured task');
    await page.getByRole('button', { name: 'Choose capture project' }).click();
    await page.getByRole('combobox', { name: 'Find capture project' }).fill('Throw');
    await page.getByRole('combobox', { name: 'Find capture project' }).press('Enter');
    await expect(page.getByRole('button', { name: 'Choose capture project' })).toContainText(
      'Throw',
    );
    await expect(title).toBeFocused();
    await expect(title).toHaveValue('A newly captured task');
    await title.press('Enter');
  } else {
    // Search creates in the project it is filtered to.
    await open(page, isMobile);
    await input(page).fill('A newly captured task');
    await page.getByRole('button', { name: 'Filter by project' }).click();
    await page.getByRole('combobox', { name: 'Find project to search' }).fill('Throw');
    await page.getByRole('combobox', { name: 'Find project to search' }).press('Enter');
    await expect(input(page)).toBeFocused();
    // Named after the project's default backlog status.
    await expect(page.getByRole('option', { name: /^Create “/ })).toContainText(
      `In Throw · ${account.throwProject.statuses[0]?.name}`,
    );
    await expect(input(page)).toHaveValue('A newly captured task');
    await input(page).press('ControlOrMeta+Enter');
  }
  await expect(taskPane(page, isMobile).getByRole('textbox', { name: 'Task title' })).toHaveValue(
    'A newly captured task',
  );
  await expect(page).toHaveURL(new RegExp(`/p/${account.throwProject.id}`));
  await expect
    .poll(
      async () =>
        (await shapeRows(page.request, 'tasks', account.headers)).find(
          (row) => row.title === 'A newly captured task',
        )?.status_id,
    )
    .toBe(account.throwProject.statuses[0]?.id);
});

test('offline capture is immediate, searchable, persists and receives a number on reconnect', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(120_000);
  const account = await fixture(page);
  await waitForDeviceSync(page);
  await page.route('**/api/**', (route) => route.abort('connectionfailed'));
  await open(page, isMobile);
  await input(page).fill('Captured with no connection');
  await input(page).press('ControlOrMeta+Enter');
  await expect(taskPane(page, isMobile)).toContainText('Pending');
  await closeTask(page, isMobile);
  await open(page, isMobile);
  await input(page).fill('Captured with no connection');
  await expect(
    palette(page).getByRole('option', { name: /Captured with no connection Pending/ }),
  ).toBeVisible();
  await closeSearch(page, isMobile);
  await expect(page.getByRole('status')).toContainText('unsaved', { timeout: 40_000 });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Catch', {
    timeout: APP_LOAD_TIMEOUT,
  });
  await open(page, isMobile);
  await input(page).fill('Captured with no connection');
  await expect(
    palette(page).getByRole('option', { name: /Captured with no connection Pending/ }),
  ).toBeVisible();
  if (isMobile) {
    // The phone board reloads its statuses on reconnecting, which closes its drawer page.
    await closeSearch(page, true);
    await page.unroute('**/api/**');
    await expect(
      page.getByRole('article', { name: 'CAT-4 Captured with no connection', exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    await open(page, true);
    await input(page).fill('Captured with no connection');
  } else await page.unroute('**/api/**');
  await expect(
    palette(page).getByRole('option', { name: /Captured with no connection CAT-4/ }),
  ).toBeVisible({ timeout: 60_000 });
  const rows = await shapeRows(page.request, 'tasks', account.headers);
  expect(rows.filter((row) => row.title === 'Captured with no connection')).toHaveLength(1);
});

test('workspace board asks for capture project; phone palette clears keyboard insets and preserves tray', async ({
  page,
  isMobile,
  browserName,
}) => {
  const phone = isMobile || browserName === 'firefox';
  if (phone && !isMobile) await page.setViewportSize({ width: 412, height: 915 });
  const account = await fixture(page);
  if (phone) {
    const handle = page.getByRole('button', { name: /^Backlog \d+$/ });
    await handle.click();
    await open(page, true);
    await page.evaluate(() => document.documentElement.style.setProperty('--keyboard', '320px'));
    // The drawer lifts its page above the keyboard.
    await expect
      .poll(async () => {
        const box = await input(page).boundingBox();
        return box ? box.y + box.height : Number.POSITIVE_INFINITY;
      })
      .toBeLessThanOrEqual(page.viewportSize()!.height - 320);
    await page.getByRole('button', { name: 'Filter by project' }).click();
    await expect(page.getByRole('combobox', { name: 'Find project to search' })).toBeInViewport();
    await closeSearch(page, true);
    await page.evaluate(() => document.documentElement.style.removeProperty('--keyboard'));
    await expect(page.getByRole('region', { name: 'Backlog', exact: true })).toHaveAttribute(
      'data-detent',
      'half',
    );
  }
  await page.goto(`/w/${account.workspaceId}/board`);
  await expect(page.getByRole('heading', { name: 'One board, every project' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(input(page)).toBeFocused();
  await expect(palette(page).getByRole('button', { name: /^Remove .* filter$/ })).toHaveCount(0);
  await input(page).fill('Capture from workspace');
  await expect(palette(page).getByRole('option', { name: /^Create “/ })).toContainText(
    'Choose a project',
  );
  // Search hands the title to the capture window, which opens on its project list.
  await input(page).press('ControlOrMeta+Enter');
  await capture(page).getByRole('option', { name: 'Catch', exact: true }).click();
  const title = capture(page).getByRole('textbox', { name: 'Task title' });
  await expect(title).toHaveValue('Capture from workspace');
  await expect(title).toBeFocused();
  await title.press('Enter');
  await expect(taskPane(page, phone).getByRole('textbox', { name: 'Task title' })).toHaveValue(
    'Capture from workspace',
  );
});

test('palette remains usable with reduced motion in light and dark', async ({
  page,
  isMobile,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await fixture(page);
  await open(page, isMobile);
  await input(page).fill('keyboard');
  const result = palette(page).getByRole('option', { name: /Fix keyboard capture/ });
  await expect(result).toBeVisible();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    const name = `palette-${isMobile ? 'phone' : 'desktop'}-${colorScheme}-reduced`;
    const path = testInfo.outputPath(`${name}.png`);
    await page.screenshot({ path });
    await testInfo.attach(name, {
      path,
      contentType: 'image/png',
    });
  }
  await input(page).press('Enter');
  await expect(taskPane(page, isMobile).getByRole('textbox', { name: 'Task title' })).toHaveValue(
    'Fix keyboard capture',
  );
});
