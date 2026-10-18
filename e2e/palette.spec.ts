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
const input = (page: Page) => page.getByRole('combobox', { name: /^Search tasks/ });
async function open(page: Page) {
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  // A phone's drawer opens search on its field, so the keyboard rises with it.
  await expect(input(page)).toBeFocused();
}
async function openWorkspace(page: Page, workspaceId: string) {
  await page.goto(`/w/${workspaceId}/board`);
  await expect(page.getByRole('heading', { name: 'One board, every project' })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
  await page.keyboard.press('ControlOrMeta+k');
  await expect(input(page)).toBeFocused();
}
async function closeSearch(page: Page, mobile: boolean) {
  await page.getByRole('button', { name: mobile ? 'Close' : 'Close search', exact: true }).click();
}
async function closeTask(page: Page) {
  await page.getByRole('button', { name: 'Back to the board', exact: true }).click();
}
function taskPane(page: Page, mobile: boolean) {
  return page.getByRole(mobile ? 'dialog' : 'region', { name: 'Task', exact: true });
}
const captureControls = (page: Page) =>
  page.getByRole('toolbar', { name: 'New task controls', exact: true });

test('a project board searches titles, identifiers, descriptions, closed tasks and subtasks in that project; the workspace board searches every project', async ({
  page,
  isMobile,
}) => {
  const account = await fixture(page);
  await open(page);
  await expect(palette(page).getByRole('button', { name: 'Filter by project' })).toHaveCount(0);
  await input(page).fill('keyboard');
  const result = palette(page).getByRole('option', { name: /Fix keyboard capture/ });
  await expect(result).toContainText('CAT-1');
  await expect(result).toContainText('active');
  await input(page).press('Enter');
  await expect(taskPane(page, isMobile).getByRole('textbox', { name: 'Task title' })).toHaveValue(
    'Fix keyboard capture',
  );
  if (!isMobile)
    await expect(
      page.getByRole('button', { name: 'Back to the board', exact: true }),
    ).toBeFocused();
  await closeTask(page);
  for (const query of ['CAT-1', '1']) {
    await open(page);
    await input(page).fill(query);
    await expect(palette(page).getByRole('listbox').getByRole('option').first()).toContainText(
      'Fix keyboard capture',
    );
    await input(page).press('Enter');
    await expect(taskPane(page, isMobile)).toContainText('CAT-1');
    await closeTask(page);
  }
  await open(page);
  await input(page).fill('needle');
  await expect(palette(page).getByRole('option', { name: /Fix keyboard capture/ })).toBeVisible();
  await expect(palette(page).getByRole('option', { name: /Closed palette task/ })).toBeVisible();
  await expect(palette(page).getByRole('option', { name: /Small nested job/ })).toBeVisible();
  // Another project's tasks and the jump to it belong to the workspace board.
  await input(page).fill('Throw');
  await expect(palette(page).getByRole('option', { name: /^Create “Throw”/ })).toBeVisible();
  await expect(palette(page).getByRole('region', { name: 'Projects' })).toHaveCount(0);
  await input(page).fill('workspace search');
  await expect(palette(page).getByRole('option', { name: /Review workspace search/ })).toHaveCount(
    0,
  );

  await openWorkspace(page, account.workspaceId);
  await input(page).fill('workspace search');
  const remote = palette(page).getByRole('option', { name: /Review workspace search/ });
  await expect(remote).toContainText('Throw');
  await remote.click();
  await expect(taskPane(page, isMobile).getByRole('textbox', { name: 'Task title' })).toHaveValue(
    'Review workspace search',
  );
});

test('project jump on the workspace board, arrow selection, Escape and focus return', async ({
  page,
}) => {
  const account = await fixture(page);
  await open(page);
  await page.keyboard.press('Escape');
  await expect(palette(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeFocused();
  await openWorkspace(page, account.workspaceId);
  await input(page).fill('Throw');
  await expect(palette(page).getByRole('region', { name: 'Projects' })).toBeVisible();
  await input(page).press('ArrowDown');
  await input(page).press('ArrowUp');
  await input(page).press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Throw');
  await expect(palette(page)).toHaveCount(0);
});

test('quick capture lands in the board it was opened from', async ({ page, isMobile }) => {
  const account = await fixture(page);
  const ideas = account.catchProject.statuses[0];
  if (isMobile) {
    // Catch's quick note: a card above the dock, which holds the new task's controls.
    const create = page.getByRole('button', { name: 'New task', exact: true });
    await create.click();
    // The drawer takes a picker's name while one is open, so find the title by itself.
    const title = page.getByRole('textbox', { name: 'Task title', exact: true });
    await expect(capture(page)).toBeVisible();
    await expect(title).toBeFocused();
    await expect(page.getByRole('button', { name: 'Choose capture project' })).toHaveCount(0);
    // Closing it creates nothing and returns to the create button.
    await title.fill('Not this one');
    await page.getByRole('button', { name: 'Close new task', exact: true }).click();
    await expect(capture(page)).toHaveCount(0);
    await expect(create).toBeFocused();

    await create.click();
    await expect(title).toHaveValue('');
    await title.fill('A newly captured task');
    // A new card from the board lands in the column on screen.
    const status = captureControls(page).getByRole('button', { name: /^Status:/ });
    await expect(status).toHaveAccessibleName('Status: active. Change');
    // A picker opens under the dock and puts the keyboard away; picking returns to the title.
    await status.click();
    await expect(title).not.toBeFocused();
    await page.getByRole('radio', { name: 'Ideas', exact: true }).click();
    await expect(title).toBeFocused();
    await expect(status).toHaveAccessibleName('Status: Ideas. Change');
    await captureControls(page)
      .getByRole('button', { name: /^Priority:/ })
      .click();
    await page.getByRole('radio', { name: 'High', exact: true }).click();
    await expect(title).toBeFocused();
    await expect(title).toHaveValue('A newly captured task');
    await title.press('Enter');
  } else {
    // Search creates in its board's backlog.
    await open(page);
    await input(page).fill('A newly captured task');
    await expect(page.getByRole('option', { name: /^Create “/ })).toContainText(
      `In Catch · ${ideas?.name}`,
    );
    await input(page).press('ControlOrMeta+Enter');
  }
  await expect(taskPane(page, isMobile).getByRole('textbox', { name: 'Task title' })).toHaveValue(
    'A newly captured task',
  );
  await expect(page).toHaveURL(new RegExp(`/p/${account.catchProject.id}`));
  await expect
    .poll(async () => {
      const row = (await shapeRows(page.request, 'tasks', account.headers)).find(
        (row) => row.title === 'A newly captured task',
      );
      return row && [row.status_id, String(row.priority)];
    })
    .toEqual([ideas?.id, isMobile ? '2' : '3']);
  const rows = await shapeRows(page.request, 'tasks', account.headers);
  expect(rows.some((row) => row.title === 'Not this one')).toBe(false);
});

test('offline capture is immediate, searchable, persists and receives a number on reconnect', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(120_000);
  const account = await fixture(page);
  await waitForDeviceSync(page);
  await page.route('**/api/**', (route) => route.abort('connectionfailed'));
  await open(page);
  await input(page).fill('Captured with no connection');
  await input(page).press('ControlOrMeta+Enter');
  await expect(taskPane(page, isMobile)).toContainText('Pending');
  await closeTask(page);
  await open(page);
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
  await open(page);
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
    await open(page);
    await input(page).fill('Captured with no connection');
  } else await page.unroute('**/api/**');
  await expect(
    palette(page).getByRole('option', { name: /Captured with no connection CAT-4/ }),
  ).toBeVisible({ timeout: 60_000 });
  const rows = await shapeRows(page.request, 'tasks', account.headers);
  expect(rows.filter((row) => row.title === 'Captured with no connection')).toHaveLength(1);
});

test('workspace board asks for capture project; phone search and capture sit above the keyboard and keep the tray', async ({
  page,
  isMobile,
  browserName,
}) => {
  const phone = isMobile || browserName === 'firefox';
  if (phone && !isMobile) await page.setViewportSize({ width: 412, height: 915 });
  // The test sets --keyboard itself. Without the VirtualKeyboard API, the app reads the
  // keyboard from the viewport on every focus change, which would put it back to 0, so
  // Firefox gets one that never moves, as Chromium's does here.
  if (browserName === 'firefox')
    await page.addInitScript(() =>
      Object.defineProperty(navigator, 'virtualKeyboard', {
        value: Object.assign(new EventTarget(), {
          overlaysContent: false,
          boundingRect: new DOMRect(),
        }),
      }),
    );
  const account = await fixture(page);
  if (phone) {
    const above = (locator: ReturnType<Page['locator']>) =>
      expect
        .poll(async () => {
          const box = await locator.boundingBox();
          return box ? box.y + box.height : Number.POSITIVE_INFINITY;
        })
        .toBeLessThanOrEqual(page.viewportSize()!.height - 320);
    const handle = page.getByRole('button', { name: /^Backlog \d+$/ });
    await handle.click();
    await open(page);
    await page.evaluate(() => document.documentElement.style.setProperty('--keyboard', '320px'));
    // The field rests at the bottom of the drawer, just above the keyboard.
    await above(input(page));
    await expect
      .poll(async () => (await input(page).boundingBox())!.y)
      .toBeGreaterThan(page.viewportSize()!.height / 3);
    await closeSearch(page, true);
    // The card and the dock beneath it ride above the keyboard too.
    await page.getByRole('button', { name: 'New task in the backlog', exact: true }).click();
    await above(capture(page).getByRole('textbox', { name: 'Task title' }));
    await above(page.getByRole('button', { name: 'Close new task', exact: true }));
    // A picker puts the keyboard away and settles at the bottom, not where the keyboard was,
    // even when it is taller than the room the keyboard left.
    await page.evaluate(() => document.documentElement.style.setProperty('--keyboard', '520px'));
    await captureControls(page)
      .getByRole('button', { name: /^Status:/ })
      .click();
    const picker = page.getByRole('radiogroup', { name: 'Status' });
    await expect(picker).toBeVisible();
    // Its height is measured once, as it opens: shortened to the room above the keyboard, a
    // tall picker would rise to the top and stay there once the keyboard had gone.
    await expect(page.getByRole('dialog', { name: 'Status', exact: true })).toHaveCSS(
      'bottom',
      '0px',
    );
    await page.evaluate(() => document.documentElement.style.setProperty('--keyboard', '0px'));
    await expect
      .poll(async () => {
        const box = await picker.boundingBox();
        return box ? box.y + box.height : 0;
      })
      .toBeGreaterThan(page.viewportSize()!.height - 120);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(capture(page)).toHaveCount(0);
    await page.evaluate(() => document.documentElement.style.removeProperty('--keyboard'));
    await expect(page.getByRole('region', { name: 'Backlog', exact: true })).toHaveAttribute(
      'data-detent',
      'half',
    );
  }
  await openWorkspace(page, account.workspaceId);
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
  // A fresh page may still be loading statuses; capture waits for the project's backlog.
  await expect(capture(page).getByText('Ideas', { exact: true })).toBeVisible();
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
  await open(page);
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
