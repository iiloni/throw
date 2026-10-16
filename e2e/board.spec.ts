import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { APP_LOAD_TIMEOUT, shapeRows, signUp } from './helpers';

async function fixture(page: Page, empty = false) {
  const account = await signUp(page);
  const [workspace] = await shapeRows(page.request, 'workspaces', account.headers);
  const projectId = randomUUID();
  const workspaceId = String(workspace?.id);
  const statusSeeds = [
    ['Ideas', 'backlog', 'a0', true],
    ['Planned', 'backlog', 'a1', false],
    ['Build', 'active', 'a0', true],
    ['Review', 'active', 'a1', false],
    ['Done', 'done', 'a0', true],
    ['Cancelled', 'cancelled', 'a0', true],
  ] as const;
  const statuses = statusSeeds.map(([name, category, position, isDefault]) => ({
    id: randomUUID(),
    name,
    category,
    position,
    isDefault,
  }));
  const status = (name: string) => statuses.find((item) => item.name === name)!.id;
  const response = await page.request.post('/api/projects', {
    headers: account.headers,
    data: {
      id: projectId,
      workspaceId,
      name: 'Real board',
      key: 'BRD',
      color: 'teal',
      icon: 'target',
      position: 'a0',
      statuses,
    },
  });
  expect(response.status()).toBe(201);
  const ids: Record<string, string> = {};
  async function add(
    title: string,
    name: string,
    priority = 3,
    position = 'a0',
    parentId: string | null = null,
  ) {
    const id = randomUUID();
    const response = await page.request.post('/api/tasks', {
      headers: account.headers,
      data: {
        id,
        projectId,
        title,
        statusId: status(name),
        priority,
        position,
        parentId,
        description: null,
        descriptionVersion: null,
      },
    });
    expect(response.status()).toBe(201);
    ids[title] = id;
    return id;
  }
  if (!empty) {
    const parent = await add('Board parent', 'Build', 1);
    await add('Subtask in progress', 'Build', 3, 'a0', parent);
    await add('Subtask complete', 'Done', 3, 'a1', parent);
    await add('Low priority', 'Build', 5);
    await add('Earlier position', 'Build', 3, 'a0');
    await add('Later position', 'Build', 3, 'a1');
    await add('Review this', 'Review', 2);
    await add('Idea for later', 'Ideas', 4);
    await add('Planned first', 'Planned', 2);
    await add('Finished', 'Done');
    await add('Cancelled work', 'Cancelled');
  }
  await page.goto(`/w/${workspaceId}/p/${projectId}?view=board`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Real board', {
    timeout: APP_LOAD_TIMEOUT,
  });
  await expect(page.getByRole('region', { name: 'Build', exact: true })).toBeVisible();
  if (!empty) await expect(page.getByRole('article', { name: /Board parent$/ })).toBeVisible();
  return { ...account, projectId, workspaceId, ids, status };
}

const cardIds = (page: Page, region: string) =>
  page
    .getByRole('region', { name: region, exact: true })
    .getByRole('article')
    .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-card-id')));

async function openBacklog(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole('button', { name: /^Backlog \d+$/ }).click();
  else {
    const opener = page.getByRole('button', { name: /^Open backlog,/ });
    if (await opener.count()) await opener.click();
  }
}

async function openClosed(page: Page, isMobile: boolean) {
  await page
    .getByRole('button', { name: isMobile ? /done this week. Show closed tasks/ : /^Open closed,/ })
    .click();
}

test('real tasks occupy their ordered columns, mixed backlog and closed rail or sheet', async ({
  page,
  isMobile,
}) => {
  const { ids } = await fixture(page);
  await expect
    .poll(() => cardIds(page, 'Build'))
    .toEqual(
      ['Board parent', 'Earlier position', 'Later position', 'Low priority'].map(
        (title) => ids[title],
      ),
    );
  await expect.poll(() => cardIds(page, 'Review')).toEqual([ids['Review this']]);
  if (isMobile) {
    await page
      .getByRole('navigation', { name: 'Columns' })
      .getByRole('button', { name: 'Review', exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 2, name: 'Review 1' })).toBeVisible();
    await expect(page.getByRole('article', { name: /Review this$/ })).toBeInViewport();
    await page
      .getByRole('navigation', { name: 'Columns' })
      .getByRole('button', { name: 'Build', exact: true })
      .click();
  }
  await openBacklog(page, isMobile);
  await expect
    .poll(() => cardIds(page, 'Backlog tasks'))
    .toEqual([ids['Planned first'], ids['Idea for later']]);
  const backlog = isMobile
    ? page.getByRole('region', { name: 'Backlog', exact: true })
    : page.getByRole('complementary', { name: 'Backlog', exact: true });
  await backlog.getByRole('button', { name: 'Ideas', exact: true }).click();
  await expect.poll(() => cardIds(page, 'Backlog tasks')).toEqual([ids['Idea for later']]);
  if (isMobile) await backlog.getByRole('button', { name: /^Backlog \d+$/ }).click();
  else await backlog.getByRole('button', { name: 'Close backlog' }).click();
  await openClosed(page, isMobile);
  const closed = isMobile
    ? page.getByRole('dialog', { name: 'Closed', exact: true })
    : page.getByRole('complementary', { name: 'Closed', exact: true });
  await expect(closed.getByRole('article')).toHaveCount(2);
  await expect(closed.getByRole('article').first()).toHaveAttribute(
    'data-card-id',
    ids['Cancelled work']!,
  );
  await closed.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(closed.getByRole('article')).toHaveCount(1);
  await expect(closed.getByRole('article')).toHaveAttribute('data-card-id', ids.Finished!);
});

test('subtasks change status in place and tasks open beside the board or full screen', async ({
  page,
  isMobile,
}) => {
  const account = await fixture(page);
  await page.getByRole('button', { name: '1 of 2 subtasks done' }).click();
  await page.getByRole('button', { name: 'Status: Build. Change', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: '2 of 2 subtasks done' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect
    .poll(
      async () =>
        (await shapeRows(page.request, 'tasks', account.headers)).find(
          (task) => task.id === account.ids['Subtask in progress'],
        )?.status_id,
    )
    .toBe(account.status('Done'));
  await page.getByRole('button', { name: 'Subtask in progress', exact: true }).click();
  const pane = page.getByRole(isMobile ? 'dialog' : 'region', { name: 'Task', exact: true });
  await expect(pane).toBeVisible();
  await expect(pane.getByRole('textbox', { name: 'Task title' })).toHaveValue(
    'Subtask in progress',
  );
  const box = await pane.boundingBox();
  if (!box) throw new Error('Task has no bounds');
  const viewport = page.viewportSize()!;
  if (isMobile) expect(box.width).toBe(viewport.width);
  else expect(box.width).toBeLessThan(viewport.width * 0.65);
  await page
    .getByRole('button', { name: isMobile ? 'Back to the board' : 'Close task', exact: true })
    .click();
  await expect(pane).toHaveCount(0);
  await page.getByRole('article', { name: /Board parent$/ }).focus();
  await page.keyboard.press('Enter');
  await expect(pane).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pane).toHaveCount(0);
});

test('a task created offline appears immediately, survives reload and gains its number on sync', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(120_000);
  const account = await fixture(page, true);
  // The API-created fixture must finish caching before this test disconnects the device.
  // The empty tasks shape can be ready before the project's initial snapshot commits.
  await page.evaluate(async () => {
    const { projectsCollection, statusesCollection } = await import(
      /* @vite-ignore */ '/src/lib/collections.ts'
    );
    await Promise.all([projectsCollection.preload(), statusesCollection.preload()]);
  });
  await expect(page.locator('[aria-busy="false"]')).toBeVisible();
  await page.route('**/api/**', (route) => route.abort('connectionfailed'));
  await page
    .getByRole('button', { name: isMobile ? 'New task' : 'Add task to Build', exact: true })
    .click();
  const pane = page.getByRole(isMobile ? 'dialog' : 'region', { name: 'Task', exact: true });
  const title = pane.getByRole('textbox', { name: 'Task title' });
  await expect(title).toBeFocused();
  await title.fill('Written without a connection');
  await title.press('Enter');
  await expect(pane).toContainText('Pending');
  await page
    .getByRole('button', { name: isMobile ? 'Back to the board' : 'Close task', exact: true })
    .click();
  const card = page.getByRole('article', {
    name: 'Pending Written without a connection',
    exact: true,
  });
  await expect(card).toBeVisible();
  await expect(page.getByRole('status')).toContainText('unsaved', { timeout: 40_000 });
  await page.reload();
  await expect(card).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await page.unroute('**/api/**');
  await expect(
    page.getByRole('article', { name: 'BRD-1 Written without a connection', exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () =>
      (await shapeRows(page.request, 'tasks', account.headers)).map(
        ({ title, number, status_id }) => ({ title, number, status_id }),
      ),
    )
    .toEqual([
      { title: 'Written without a connection', number: '1', status_id: account.status('Build') },
    ]);
});

test('board settings opens in the drawer on a phone and in a panel held to the window on desktop', async ({
  page,
  isMobile,
}) => {
  const height = 568;
  await page.setViewportSize({ width: isMobile ? 320 : 1024, height });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fixture(page, true);
  const trigger = page.getByRole('button', { name: 'Board settings', exact: true });
  const settings = page.getByRole('dialog', { name: 'Board settings', exact: true });
  const theme = settings.getByRole('group', { name: 'Theme', exact: true });
  if (isMobile) {
    const backlog = page.getByRole('region', { name: 'Backlog', exact: true });
    await backlog.getByRole('button', { name: /^Backlog \d+$/ }).click();
    await expect(backlog).toHaveAttribute('data-detent', 'half');
  }
  await trigger.click();
  await expect(settings).toBeVisible();
  // The drawer takes focus itself, so its close button's tooltip does not take the first Escape.
  if (isMobile) await expect(settings).toBeFocused();
  const bounds = await settings.boundingBox();
  if (!bounds) throw new Error('Board settings has no bounds');
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(isMobile ? 320 : 1024);
  if (isMobile) {
    // The drawer, raised to full height in place of the backlog.
    expect(bounds.y).toBeLessThan(24);
    await expect(page.getByRole('region', { name: 'Backlog', exact: true })).toHaveCount(0);
    await expect(settings).toHaveAttribute('data-page', 'settings');
  }
  for (const name of ['Dark', 'Light']) {
    const option = theme.getByRole('button', { name, exact: true });
    await option.scrollIntoViewIfNeeded();
    await expect(option).toBeInViewport();
    await option.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', name.toLowerCase());
  }
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await expect(trigger).toBeFocused();
  if (isMobile) {
    // Closing a page returns the drawer to what it showed, at the height it was.
    await expect(page.getByRole('region', { name: 'Backlog', exact: true })).toHaveAttribute(
      'data-detent',
      'half',
    );
    await trigger.click();
    await settings.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(settings).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
});

test('rails, galleries, board settings and the phone tray keep their distinct layouts', async ({
  page,
  isMobile,
  browserName,
}) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Board settings', exact: true }).click();
  await page.getByRole('switch', { name: 'Priority labels', exact: true }).click();
  await page.getByRole('switch', { name: 'Priority on cards', exact: true }).click();
  await page.getByRole('switch', { name: 'Scrollbars', exact: true }).click();
  await page
    .getByRole('group', { name: 'Backlog', exact: true })
    .getByRole('button', { name: 'With board' })
    .click();
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).not.toHaveAttribute('data-hide-scrollbars');
  await page.reload();
  await page.getByRole('button', { name: 'Board settings', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Priority labels', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(
    page
      .getByRole('group', { name: 'Backlog', exact: true })
      .getByRole('button', { name: 'With board' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await openBacklog(page, isMobile);
  if (isMobile) {
    const tray = page.getByRole('region', { name: 'Backlog', exact: true });
    await expect(tray).toHaveAttribute('data-detent', 'half');
    const handle = tray.getByRole('button', { name: /^Backlog \d+$/ });
    await handle.focus();
    await page.keyboard.press('ArrowUp');
    await expect(tray).toHaveAttribute('data-detent', 'full');
    await page.getByRole('button', { name: 'New task in the backlog', exact: true }).click();
    await expect(
      page.getByRole(isMobile ? 'dialog' : 'region', { name: 'Task', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Back to the board' }).click();
    await handle.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(tray).toHaveAttribute('data-detent', 'closed');
  } else {
    const rail = page.getByRole('complementary', { name: 'Backlog', exact: true });
    await rail.getByRole('button', { name: 'Open as a gallery' }).click();
    await expect(page.getByRole('region', { name: 'Build', exact: true })).toHaveCount(0);
    await rail.getByRole('button', { name: 'Back to a column' }).click();
    await expect(page.getByRole('region', { name: 'Build', exact: true })).toBeVisible();
    await rail.getByRole('button', { name: 'Close backlog' }).click();
    await openClosed(page, false);
    await page
      .getByRole('complementary', { name: 'Closed', exact: true })
      .getByRole('button', { name: 'Open as a gallery' })
      .click();
    await expect(page.getByRole('region', { name: 'Build', exact: true })).toHaveCount(0);
  }
  test.info().annotations.push({ type: 'browser', description: browserName });
});

test('loading resolves to an empty board and long columns scroll within the board in light, dark and reduced motion', async ({
  page,
  browser,
}, testInfo) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/shapes/tasks?**', async (route) => {
    await gate;
    await route.continue();
  });
  const account = await fixture(page, true);
  const column = page.getByRole('region', { name: 'Build', exact: true });
  await expect(column).toContainText('Loading tasks…');
  release();
  await expect(column).toContainText('Nothing here.');
  await expect(page.locator('[aria-busy="false"]')).toBeVisible();
  const { positionsBetween } = await import('../packages/shared/src/position');
  const positions = positionsBetween(null, null, 18);
  for (let index = 0; index < 18; index++) {
    const response = await page.request.post('/api/tasks', {
      headers: account.headers,
      data: {
        id: randomUUID(),
        projectId: account.projectId,
        title: `Scroll card ${index + 1}`,
        statusId: account.status('Build'),
        priority: 3,
        position: positions[index],
        parentId: null,
        description: null,
        descriptionVersion: null,
      },
    });
    expect(response.status()).toBe(201);
  }
  await expect(column.getByRole('article')).toHaveCount(18);
  const scroller = column.locator('[data-slot="scroll-area-viewport"]');
  const edges = column.locator('[data-edges]');
  await expect(edges).toHaveAttribute('data-more-bottom');
  await scroller.evaluate((element) => element.scrollTo({ top: 117 }));
  await expect(edges).toHaveAttribute('data-more-top');
  await page.screenshot({ path: testInfo.outputPath('scroll-light.png') });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.screenshot({ path: testInfo.outputPath('scroll-dark-reduced.png') });
  await scroller.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await expect(column.getByRole('article', { name: /Scroll card 18$/ })).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  testInfo.annotations.push({ type: 'browser version', description: browser.version() });
});

test('desktop selection sends tasks through the status menu while retaining their priority and order', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Phone selection and the move drawer arrive with the drag engine.');
  const account = await fixture(page);
  for (const title of ['Earlier position', 'Later position'])
    await page
      .getByRole('article', { name: new RegExp(`${title}$`) })
      .click({ modifiers: ['Control'] });
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Move to', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Review', exact: true }).click();
  await expect
    .poll(() => cardIds(page, 'Review'))
    .toEqual(
      ['Review this', 'Earlier position', 'Later position'].map((title) => account.ids[title]),
    );
  await expect
    .poll(async () =>
      (await shapeRows(page.request, 'tasks', account.headers))
        .filter(
          (task) =>
            task.id === account.ids['Earlier position'] ||
            task.id === account.ids['Later position'],
        )
        .map((task) => ({ status: task.status_id, priority: task.priority })),
    )
    .toEqual([
      { status: account.status('Review'), priority: '3' },
      { status: account.status('Review'), priority: '3' },
    ]);
});

test('phone tray responds to touch or pointer pulls between all three heights', async ({
  page,
  isMobile,
  browserName,
}) => {
  test.skip(
    !isMobile && browserName !== 'firefox',
    'Phone gestures; Firefox also checks the phone layout with a pointer.',
  );
  if (!isMobile) await page.setViewportSize({ width: 412, height: 915 });
  await fixture(page);
  const tray = page.getByRole('region', { name: 'Backlog', exact: true });
  const handle = tray.getByRole('button', { name: /^Backlog \d+$/ });
  if (isMobile) await handle.tap();
  else await handle.click();
  await expect(tray).toHaveAttribute('data-detent', 'half');
  const halfTop = await tray.evaluate(
    (element) =>
      parseFloat(getComputedStyle(element).top) + Math.round(element.clientHeight * 0.42),
  );
  await expect.poll(async () => Math.abs((await tray.boundingBox())!.y - halfTop)).toBeLessThan(3);
  async function pull(to: number) {
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2;
    const start = box.y + box.height / 2;
    if (isMobile) {
      const session = await page.context().newCDPSession(page);
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y: start }],
      });
      for (let step = 1; step <= 12; step++)
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x, y: start + ((to - start) * step) / 12 }],
        });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await session.detach();
    } else {
      await page.mouse.move(x, start);
      await page.mouse.down();
      await page.mouse.move(x, to, { steps: 12 });
      await page.mouse.up();
    }
  }
  await pull(20);
  await expect(tray).toHaveAttribute('data-detent', 'full');
  await expect.poll(async () => (await tray.boundingBox())!.y).toBeLessThan(10);
  await pull(page.viewportSize()!.height - 30);
  await expect(tray).toHaveAttribute('data-detent', 'closed');
  await openClosed(page, true);
  const closed = page.getByRole('dialog', { name: 'Closed', exact: true });
  await expect(closed).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(closed).toHaveCount(0);
});

test('creating from a filtered backlog uses its default status and reveals the new task', async ({
  page,
  isMobile,
}) => {
  const account = await fixture(page);
  await openBacklog(page, isMobile);
  const backlog = isMobile
    ? page.getByRole('region', { name: 'Backlog', exact: true })
    : page.getByRole('complementary', { name: 'Backlog', exact: true });
  await backlog.getByRole('button', { name: 'Planned', exact: true }).click();
  await page.getByRole('button', { name: 'New task in the backlog', exact: true }).click();
  const pane = page.getByRole(isMobile ? 'dialog' : 'region', { name: 'Task', exact: true });
  const title = pane.getByRole('textbox', { name: 'Task title' });
  await title.fill('New backlog task');
  await title.press('Enter');
  await page
    .getByRole('button', { name: isMobile ? 'Back to the board' : 'Close task', exact: true })
    .click();
  await expect(backlog.getByRole('button', { name: 'All', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(backlog.getByRole('article', { name: /New backlog task$/ })).toBeVisible();
  await expect
    .poll(
      async () =>
        (await shapeRows(page.request, 'tasks', account.headers)).find(
          (task) => task.title === 'New backlog task',
        )?.status_id,
    )
    .toBe(account.status('Ideas'));
});
