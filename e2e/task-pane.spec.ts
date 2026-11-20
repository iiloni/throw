import { randomUUID } from 'node:crypto';
import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import { APP_LOAD_TIMEOUT, shapeRows, signUp, waitForCachedProject } from './helpers';

async function fixture(page: Page) {
  const account = await signUp(page);
  const [workspace] = await shapeRows(page.request, 'workspaces', account.headers);
  const workspaceId = String(workspace?.id);
  const projectId = randomUUID();
  const taskId = randomUUID();
  const statuses = (['backlog', 'active', 'done', 'cancelled'] as const).map((category) => ({
    id: randomUUID(),
    name: category === 'active' ? 'Working' : category,
    category,
    position: 'a0',
    isDefault: true,
  }));
  const status = (category: string) => statuses.find((row) => row.category === category)!.id;
  expect(
    (
      await page.request.post('/api/projects', {
        headers: account.headers,
        data: {
          id: projectId,
          workspaceId,
          name: 'Task workspace',
          key: 'TASK',
          color: 'teal',
          icon: null,
          position: 'a0',
          statuses,
        },
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await page.request.patch(`/api/projects/${projectId}`, {
        headers: account.headers,
        data: { priorityNames: ['Urgent', '', '', '', 'Someday'] },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.post('/api/tasks', {
        headers: account.headers,
        data: {
          id: taskId,
          projectId,
          title: 'Write the launch plan',
          statusId: status('active'),
          priority: 3,
          position: 'a0',
          parentId: null,
          description: null,
          descriptionVersion: null,
        },
      })
    ).status(),
  ).toBe(201);
  const path = `/w/${workspaceId}/p/${projectId}?view=board`;
  await page.goto(path);
  const card = page.getByRole('article', { name: 'TASK-1 Write the launch plan', exact: true });
  await expect(card).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await card.click();
  const pane = page.getByLabel('Task', { exact: true });
  await expect(pane).toBeVisible();
  await expect(pane.locator('.bn-editor[contenteditable="true"]')).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
  await expect(pane.getByRole('button', { name: 'Edit description' })).toHaveCount(0);
  return { ...account, projectId, taskId, workspaceId, statuses, status, path, pane };
}

async function editDescription(pane: Locator, text: string) {
  const editor = pane.locator('.bn-editor[contenteditable="true"]');
  await expect(editor).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await editor.fill(text);
  return editor;
}

async function closeTask(pane: Locator) {
  await pane.getByRole('button', { name: 'Back to the board', exact: true }).click();
  await expect(pane).toHaveCount(0);
  await expect(pane.page().locator('[data-task-screen]')).toHaveCount(0);
}

/** The pane's drawer on desktop; on a phone, the board drawer's dock (ADR 0009). */
function controls(page: Page) {
  return page.getByRole('toolbar', { name: 'Task controls', exact: true });
}

async function openMore(page: Page) {
  await controls(page).getByRole('button', { name: 'More task actions', exact: true }).click();
}

async function taskRow(page: Page, account: { headers: Record<string, string>; taskId: string }) {
  return (await shapeRows(page.request, 'tasks', account.headers)).find(
    (row) => row.id === account.taskId,
  );
}

async function anotherDevice(page: Page, browser: Browser) {
  const storageState = await page.context().storageState();
  // Only the login travels to another device; unsaved drafts are device-local data.
  for (const origin of storageState.origins)
    origin.localStorage = origin.localStorage.filter(
      (item) => !item.name.startsWith('throw-description:'),
    );
  return browser.newContext({ storageState, viewport: page.viewportSize()! });
}

test('task fields, actions, subtasks and task links work in the split pane and phone screen', async ({
  page,
  isMobile,
}) => {
  const account = await fixture(page);
  const { pane } = account;
  const box = (await pane.boundingBox())!;
  const backlog = page.getByRole('button', { name: /^Backlog \d+$/ });
  if (isMobile) {
    expect(box.width).toBe(page.viewportSize()!.width);
    // The open task's controls take the dock's place; the board's return when it closes.
    await expect(controls(page)).toBeInViewport();
    await expect(backlog).toHaveCount(0);
  } else {
    expect(box.width).toBeLessThan(page.viewportSize()!.width * 0.65);
    const handle = page.getByRole('separator', { name: 'Resize task' });
    const before = Number(await handle.getAttribute('aria-valuenow'));
    await handle.focus();
    await handle.press('ArrowLeft');
    await expect(handle).toHaveAttribute('aria-valuenow', String(before + 32));
  }
  await pane.getByRole('textbox', { name: 'Task title' }).fill('A plan ready to share');
  await pane.getByRole('textbox', { name: 'Task title' }).press('Enter');
  await controls(page)
    .getByRole('button', { name: 'Status: Working. Change', exact: true })
    .click();
  await page.getByRole('radio', { name: 'backlog', exact: true }).click();
  await controls(page).getByRole('button', { name: 'Priority: Default. Change' }).click();
  await page.getByRole('radio', { name: 'Urgent', exact: true }).click();
  await editDescription(pane, 'Prepare the launch checklist.');
  expect((await taskRow(page, account))?.description).toBeNull();
  await closeTask(pane);
  await expect
    .poll(async () => {
      const row = await taskRow(page, account);
      return [
        row?.title,
        row?.status_id,
        row?.priority,
        String(row?.description).includes('Prepare the launch checklist.'),
      ];
    })
    .toEqual(['A plan ready to share', account.status('backlog'), '1', true]);
  if (isMobile) {
    await expect(backlog).toBeVisible();
    await expect(controls(page)).toHaveCount(0);
  }

  await page.goto(`${account.path}&task=${account.taskId}`);
  // Adding a subtask makes it at once and opens it as a task of its own, over its parent,
  // with its title ready to be written and its full controls.
  const addSubtask = pane.getByRole('button', { name: 'Add subtask', exact: true });
  const title = pane.getByRole('textbox', { name: 'Task title' });
  const subtaskRows = async () =>
    (await shapeRows(page.request, 'tasks', account.headers)).filter(
      (row) => row.parent_id === account.taskId,
    );
  await addSubtask.click();
  await expect(title).toHaveValue('');
  await expect(title).toBeFocused();
  await expect(addSubtask).toHaveCount(0);
  await expect(pane.getByRole('button', { name: /^Open parent / })).toBeVisible();
  await expect(
    controls(page).getByRole('button', { name: 'Status: backlog. Change', exact: true }),
  ).toBeVisible();
  if (isMobile) await expect(page.getByLabel('Task beneath', { exact: true })).toHaveCount(1);
  // Left as it was made, it was never wanted: it goes, rather than stay as an untitled task.
  await title.press('Escape');
  await expect(title).toHaveValue('A plan ready to share');
  await expect(pane.getByRole('article', { name: /Untitled task$/ })).toHaveCount(0);
  await expect.poll(async () => (await subtaskRows()).length).toBe(0);
  await addSubtask.click();
  await expect(title).toBeFocused();
  await page.keyboard.type('Draft the announcement');
  // Escape names it and goes back to the parent, whose list now holds it.
  await title.press('Escape');
  await expect(title).toHaveValue('A plan ready to share');
  const added = pane.getByRole('article', { name: /^TASK-\d+ Draft the announcement$/ });
  await expect(added).toBeVisible();
  if (isMobile) await expect(addSubtask).toBeFocused();
  else await expect(added).toBeFocused();
  await pane
    .getByRole('button', { name: 'Status of Draft the announcement: backlog. Change' })
    .click();
  await page.getByRole('menuitem', { name: 'Working', exact: true }).click();
  await expect(pane.getByRole('textbox', { name: 'Task title' })).toHaveValue(
    'A plan ready to share',
  );
  await pane.getByRole('article', { name: /^TASK-\d+ Draft the announcement$/ }).click();
  await expect(pane.getByRole('textbox', { name: 'Task title' })).toHaveValue(
    'Draft the announcement',
  );
  await expect(pane.getByRole('button', { name: 'Add subtask', exact: true })).toHaveCount(0);
  // Opened from its parent's pane, the subtask goes back there rather than to the board.
  if (isMobile) await expect(page.getByLabel('Task beneath', { exact: true })).toHaveCount(1);
  await pane.getByRole('button', { name: 'Back to TASK-1', exact: true }).click();
  await expect(pane.getByRole('textbox', { name: 'Task title' })).toHaveValue(
    'A plan ready to share',
  );
  await expect(page.locator('[data-task-screen]')).toHaveCount(isMobile ? 1 : 0);
  await pane.getByRole('article', { name: /^TASK-\d+ Draft the announcement$/ }).click();
  await expect(pane.getByRole('textbox', { name: 'Task title' })).toHaveValue(
    'Draft the announcement',
  );
  await pane.getByRole('button', { name: 'Open parent TASK-1' }).click();
  await expect(pane.getByRole('textbox', { name: 'Task title' })).toHaveValue(
    'A plan ready to share',
  );
  await expect(pane.getByRole('button', { name: 'Back to the board', exact: true })).toBeVisible();

  await openMore(page);
  await page.getByRole('button', { name: 'Close task', exact: true }).click();
  await expect(
    controls(page).getByRole('button', { name: 'Status: done. Change', exact: true }),
  ).toBeVisible();
  await openMore(page);
  await page.getByRole('button', { name: 'Reopen task', exact: true }).click();
  await expect(
    controls(page).getByRole('button', { name: 'Status: backlog. Change', exact: true }),
  ).toBeVisible();
  await pane.getByRole('button', { name: 'Move to trash' }).click();
  await expect(pane).toContainText('This task is in the trash.');
  await pane.getByRole('button', { name: 'Restore task' }).click();
  await expect(pane).not.toContainText('This task is in the trash.');

  // HTTP on a LAN and denied clipboard permission both need a selectable fallback.
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }),
  );
  await openMore(page);
  await page.getByRole('button', { name: 'Copy task link' }).click();
  const linkDialog = page.getByRole('dialog', { name: 'Task link', exact: true });
  const linkInput = linkDialog.getByRole('textbox', { name: 'Task link' });
  await expect(linkInput).toBeInViewport();
  await expect(linkInput).toBeFocused();
  const href = await linkInput.inputValue();
  expect(
    await linkInput.evaluate((input: HTMLInputElement) => [
      input.selectionStart,
      input.selectionEnd,
    ]),
  ).toEqual([0, href.length]);
  await page.keyboard.press('Escape');
  await expect(linkDialog).toHaveCount(0);
  await expect(pane).toBeVisible();
  await expect(controls(page).getByRole('button', { name: 'More task actions' })).toBeFocused();
  await page.goto(href);
  await expect(pane.getByRole('textbox', { name: 'Task title' })).toHaveValue(
    'A plan ready to share',
    { timeout: APP_LOAD_TIMEOUT },
  );
  await title.fill('A title committed on Escape');
  await title.press('Escape');
  await expect(pane).toHaveCount(0);
  await expect
    .poll(async () => (await taskRow(page, account))?.title)
    .toBe('A title committed on Escape');
});

test('offline field edits and a description save survive reload and sync', async ({ page }) => {
  test.setTimeout(120_000);
  const account = await fixture(page);
  const { pane } = account;
  // Load the editor before blocking API calls; dev code itself stays online.
  await editDescription(pane, 'Written on the train.');
  await waitForCachedProject(
    page,
    account.projectId,
    account.statuses.map((row) => row.id),
  );
  await page.route('**/api/**', (route) => route.abort('connectionfailed'));
  await pane.getByRole('textbox', { name: 'Task title' }).fill('Plan written offline');
  await pane.getByRole('textbox', { name: 'Task title' }).press('Enter');
  await controls(page).getByRole('button', { name: 'Priority: Default. Change' }).click();
  await page.getByRole('radio', { name: 'Someday', exact: true }).click();
  await controls(page)
    .getByRole('button', { name: 'Status: Working. Change', exact: true })
    .click();
  await page.getByRole('radio', { name: 'backlog', exact: true }).click();
  await closeTask(pane);
  // The phone's task dialog makes the board's sync indicator inert to assistive tech.
  await expect(page.getByRole('status', { includeHidden: true })).toContainText('unsaved', {
    timeout: 40_000,
  });
  await page.goto(`${account.path}&task=${account.taskId}`);
  await expect(pane.getByRole('textbox', { name: 'Task title' })).toHaveValue(
    'Plan written offline',
    { timeout: APP_LOAD_TIMEOUT },
  );
  await expect(pane).toContainText('Written on the train.');
  await page.unroute('**/api/**');
  await expect
    .poll(
      async () => {
        const row = await taskRow(page, account);
        return [
          row?.title,
          row?.priority,
          row?.status_id,
          String(row?.description).includes('Written on the train.'),
        ];
      },
      { timeout: 60_000 },
    )
    .toEqual(['Plan written offline', '5', account.status('backlog'), true]);
});

test('a remote description preserves an active draft and requires review before replacement', async ({
  page,
  browser,
}) => {
  const account = await fixture(page);
  const { pane } = account;
  await editDescription(pane, 'My unsaved launch details.');
  const context = await anotherDevice(page, browser);
  try {
    const other = await context.newPage();
    await other.goto(`${account.path}&task=${account.taskId}`);
    const otherPane = other.getByLabel('Task', { exact: true });
    await editDescription(otherPane, 'A description from the other device.');
    await closeTask(otherPane);
    await expect(pane).toContainText('The description changed on another device.');
    await expect(pane.locator('.bn-editor[contenteditable="true"]')).toContainText(
      'My unsaved launch details.',
    );
    await expect(pane.getByRole('button', { name: 'Save description' })).toHaveCount(0);
    await pane.getByRole('button', { name: 'Review latest description' }).click();
    await expect(pane).toContainText('A description from the other device.');
    await pane.getByRole('button', { name: 'Keep my version' }).click();
    await closeTask(pane);
    await expect
      .poll(async () => String((await taskRow(page, account))?.description))
      .toContain('My unsaved launch details.');
    await other.goto(`${account.path}&task=${account.taskId}`);
    await expect(otherPane).toContainText('My unsaved launch details.');
  } finally {
    await context.close();
  }
});

test('a refused offline description stays recoverable after closing and reloading the pane', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const account = await fixture(page);
  const { pane } = account;
  // A separate browser context has its own local database and outbox, as another device does.
  const context = await anotherDevice(page, browser);
  try {
    const other = await context.newPage();
    await other.goto(`${account.path}&task=${account.taskId}`);
    const otherPane = other.getByLabel('Task', { exact: true });
    await editDescription(pane, 'Offline text that must not disappear.');
    await waitForCachedProject(
      page,
      account.projectId,
      account.statuses.map((row) => row.id),
    );
    await page.route('**/api/**', (route) => route.abort('connectionfailed'));
    await closeTask(pane);
    await editDescription(otherPane, 'The server keeps this version.');
    await closeTask(otherPane);
    await expect
      .poll(async () => String((await taskRow(other, account))?.description))
      .toContain('The server keeps this version.');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Task workspace', {
      timeout: APP_LOAD_TIMEOUT,
    });
    await page.unroute('**/api/**');
    await expect
      .poll(
        async () =>
          page.evaluate(
            async () =>
              (await import(/* @vite-ignore */ '/src/lib/syncStatus.ts')).getSyncStatus().pending,
          ),
        { timeout: 60_000 },
      )
      .toBe(0);
    await page.goto(`${account.path}&task=${account.taskId}`);
    await expect(pane).toContainText('Your description was not applied.', {
      timeout: APP_LOAD_TIMEOUT,
    });
    await expect(pane.locator('.bn-editor[contenteditable="true"]')).toContainText(
      'Offline text that must not disappear.',
    );
    await pane.getByRole('button', { name: 'Review latest description' }).click();
    await expect(pane).toContainText('The server keeps this version.');
    await pane.getByRole('button', { name: 'Use latest description' }).click();
    await expect(pane).not.toContainText('Offline text that must not disappear.');
    await expect
      .poll(async () => String((await taskRow(page, account))?.description))
      .toContain('The server keeps this version.');
  } finally {
    await context.close();
  }
});

test('reduced motion keeps the drawer, keyboard controls and close-to-save editor usable in both themes', async ({
  page,
  isMobile,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { pane } = await fixture(page);
  const draft = await editDescription(
    pane,
    'A focused plan for the launch, with room for the details.',
  );
  // While a finger types, the dock formats; leaving the editor brings the controls back.
  await draft.blur();
  // Focus opens the control's tooltip and Enter closes it. Slow tooltip animations make sure a
  // tooltip lingering after it closes would hold, and swallow, the Escapes below.
  await page.addStyleTag({
    content: '[data-slot="tooltip-content"] { animation-duration: 10s !important; }',
  });
  await controls(page).getByRole('button', { name: 'Priority: Default. Change' }).focus();
  await page.keyboard.press('Enter');
  // A phone opens the picker as a page of the board's drawer; the pane's drawer expands.
  const priority = page.getByRole(isMobile ? 'dialog' : 'region', {
    name: 'Priority',
    exact: true,
  });
  await expect(priority).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pane).toBeVisible();
  await expect(priority).toHaveCount(0);
  await expect(
    controls(page).getByRole('button', { name: 'Priority: Default. Change' }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(pane).toHaveCount(0);
  await page.getByRole('article', { name: 'TASK-1 Write the launch plan', exact: true }).click();
  await expect(pane.locator('.bn-editor[contenteditable="true"]')).toContainText(
    'A focused plan for the launch',
  );
  // Native Android keeps the layout viewport while the keyboard takes its lower area.
  const editor = pane.locator('.bn-editor[contenteditable="true"]');
  await page.evaluate(() => document.documentElement.style.setProperty('--keyboard', '300px'));
  await editor.fill(
    Array.from({ length: 24 }, (_, index) => `Line ${index + 1} of the plan.`).join('\n'),
  );
  await editor.press('Control+End');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const selection = getSelection();
        if (!selection?.rangeCount) return false;
        const range = selection.getRangeAt(0);
        let caret = range.getBoundingClientRect();
        if (!caret.height) {
          const node = selection.focusNode;
          const element = node instanceof Element ? node : node?.parentElement;
          const block = element?.closest('[data-content-type]');
          if (!block) return false;
          caret = block.getBoundingClientRect();
        }
        const drawer = document.querySelector('[data-task-drawer]')!.getBoundingClientRect();
        return caret.bottom > 0 && caret.bottom <= drawer.top;
      }),
    )
    .toBe(true);
  await page.evaluate(() => document.documentElement.style.setProperty('--keyboard', '0px'));
  await editor.fill('A focused plan for the launch, with room for the details.');
  await pane.getByRole('button', { name: 'Back to the board' }).focus();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    const path = testInfo.outputPath(`task-pane-${colorScheme}-reduced.png`);
    await page.screenshot({ path });
    await testInfo.attach(`${colorScheme} with reduced motion`, { path, contentType: 'image/png' });
  }
});

test('the phone task drawer holds still until a panel opens, and keeps its tabs above it', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Desktop has no drawer (ADR 0009)');
  await fixture(page);
  const dock = controls(page);
  const status = dock.getByRole('button', { name: 'Status: Working. Change', exact: true });
  const top = async () => (await dock.boundingBox())!.y;
  const before = await top();
  const session = await page.context().newCDPSession(page);
  const touch = (type: string, y: number) =>
    session.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x: 40, y }],
    });
  await touch('touchStart', before + 20);
  for (let step = 1; step <= 10; step++) await touch('touchMove', before + 20 - step * 25);
  expect(await top()).toBe(before);
  await touch('touchEnd', 0);
  await session.detach();
  await expect(page.getByRole('dialog', { name: 'Backlog' })).toHaveCount(0);

  await status.click();
  await expect(status).toHaveAttribute('aria-expanded', 'true');
  const panel = page.getByRole('dialog', { name: 'Status', exact: true });
  await expect(panel.getByRole('radio', { name: 'Working', exact: true })).toBeChecked();
  // The controls stay above the panel as its tabs.
  await expect(dock).toBeInViewport();
  const priority = dock.getByRole('button', { name: 'Priority: Default. Change' });
  await priority.click();
  await expect(page.getByRole('dialog', { name: 'Priority', exact: true })).toBeVisible();
  await expect(status).toHaveAttribute('aria-expanded', 'false');
  await priority.click();
  await expect(page.getByRole('dialog', { name: 'Priority', exact: true })).toHaveCount(0);
  await expect(priority).toBeFocused();
});

test('a finger formats the description from the dock while typing, as in Catch', async ({
  page,
  isMobile,
}, testInfo) => {
  test.skip(!isMobile, "A mouse formats from BlockNote's floating toolbar");
  const { pane } = await fixture(page);
  const editor = pane.locator('.bn-editor[contenteditable="true"]');
  await expect(editor).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await expect(controls(page)).toBeVisible();
  await editor.tap();
  const formatting = page.getByRole('toolbar', { name: 'Formatting', exact: true });
  await expect(formatting).toBeVisible();
  await expect(controls(page)).toHaveCount(0);
  const bold = formatting.getByRole('button', { name: 'Bold', exact: true });
  await bold.tap();
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  // The tools never take focus, so the keyboard stays up.
  await expect(editor).toBeFocused();
  await page.keyboard.type('Ship it');
  await expect(editor.locator('strong')).toHaveText('Ship it');
  await formatting.getByRole('button', { name: 'Bulleted list', exact: true }).tap();
  await expect(editor.locator('[data-content-type="bulletListItem"]')).toHaveCount(1);
  const path = testInfo.outputPath('formatting-dock.png');
  await page.screenshot({ path });
  await testInfo.attach('formatting dock', { path, contentType: 'image/png' });
  // Leaving the editor brings the task's controls back.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(controls(page)).toBeVisible();
  await expect(formatting).toHaveCount(0);
});

test('the desktop dock sits below the card, its panels open above it and follow it for Tab', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'The phone shows its controls in the drawer (ADR 0009)');
  await fixture(page);
  const dock = controls(page);
  // The card is the pane's scroller, between the toolbars and the dock.
  const card = page.locator('[data-task-card]');
  const dockTop = async () => (await dock.boundingBox())!.y;
  const cardBottom = async () => {
    const box = (await card.boundingBox())!;
    return box.y + box.height;
  };
  expect(await dockTop()).toBeGreaterThanOrEqual(await cardBottom());
  const status = dock.getByRole('button', { name: 'Status: Working. Change', exact: true });
  await status.focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('region', { name: 'Status', exact: true });
  await expect(panel.getByRole('radio', { name: 'Working', exact: true })).toBeChecked();
  const dockBox = (await dock.boundingBox())!;
  const panelBox = (await panel.boundingBox())!;
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(dockBox.y);
  // The card stays put under the panel.
  expect(await cardBottom()).toBeLessThanOrEqual(dockBox.y);
  // Tab from the controls reaches the panel they opened.
  for (let step = 0; step < 8; step++) {
    if (await panel.evaluate((node) => node.contains(document.activeElement))) break;
    await page.keyboard.press('Tab');
  }
  await expect
    .poll(() => panel.evaluate((node) => node.contains(document.activeElement)))
    .toBe(true);
  // The keyboard lifts the dock with the pane rather than covering it.
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(status).toBeFocused();
  const resting = (await dock.boundingBox())!.y;
  await page.evaluate(() => document.documentElement.style.setProperty('--keyboard', '200px'));
  await expect.poll(async () => (await dock.boundingBox())!.y).toBeLessThanOrEqual(resting - 199);
});

test('tags are picked from the task controls and listed on the task', async ({
  page,
  isMobile,
}) => {
  const account = await fixture(page);
  const { pane } = account;
  // Tags are made in the project's tag manager; without any there is nothing to pick.
  await expect(controls(page).getByRole('button', { name: /^(Tags|Color):/ })).toHaveCount(0);
  const tag = async (name: string, parentId: string | null) => {
    const id = randomUUID();
    const data = { id, projectId: account.projectId, name, parentId, icon: null };
    const response = await page.request.post('/api/tags', {
      headers: account.headers,
      data: { ...data, color: parentId ? null : 'amber' },
    });
    expect(response.status()).toBe(201);
    return id;
  };
  const launch = await tag('Launch', null);
  const press = await tag('Press', launch);
  // Enough children that the color picker's list is taller than its swatches.
  for (const name of ['Blog', 'Events', 'Partners', 'Social', 'Video']) await tag(name, launch);
  // The children reach the device after the root; the picker can only open what it has.
  await controls(page).getByRole('button', { name: 'Tags: none. Change', exact: true }).click();
  await expect(
    page
      .getByRole(isMobile ? 'dialog' : 'region', { name: 'Tags', exact: true })
      .getByRole('checkbox', { name: 'Launch / Video', exact: true }),
  ).toBeAttached();
  await page.keyboard.press('Escape');
  // The color picks the primary tag, as Catch's palette does, and opens its children.
  await controls(page).getByRole('button', { name: 'Color: none. Change', exact: true }).click();
  const color = page.getByRole(isMobile ? 'dialog' : 'region', { name: 'Color', exact: true });
  await color.getByRole('button', { name: 'Amber: Launch', exact: true }).click();
  // On a phone the drawer grows with the picker's child list, so all of it is on screen; the
  // desktop panel keeps its height and scrolls.
  const last = color.getByRole('button', { name: 'Launch / Video', exact: true });
  if (isMobile) await expect(last).toBeInViewport({ ratio: 1 });
  else await expect(last).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('color-picker.png') });
  await page.keyboard.press('Escape');
  await expect(color).toHaveCount(0);
  await expect(
    controls(page).getByRole('button', { name: 'Color: Launch. Change', exact: true }),
  ).toBeFocused();
  await controls(page).getByRole('button', { name: 'Tags: none. Change', exact: true }).click();
  const picker = page.getByRole(isMobile ? 'dialog' : 'region', { name: 'Tags', exact: true });
  await picker.getByRole('checkbox', { name: 'Launch / Press', exact: true }).check();
  // Tags take several choices, so the picker stays open until it is dismissed.
  await expect(picker).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('tag-picker.png') });
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(pane).toBeVisible();
  await expect(
    controls(page).getByRole('button', { name: 'Tags: Press. Change', exact: true }),
  ).toBeFocused();
  const listed = pane.getByRole('region', { name: 'Task tags' });
  await expect(listed).toContainText('Launch');
  await expect(listed).toContainText('Press');
  await expect
    .poll(async () => {
      const row = await taskRow(page, account);
      const assignments = await shapeRows(page.request, 'task-tags', account.headers);
      return [row?.primary_tag_id, assignments.map((assignment) => assignment.tag_id)];
    })
    .toEqual([launch, [press]]);
  await closeTask(pane);
  const card = page.getByRole('article', { name: 'TASK-1 Write the launch plan', exact: true });
  await expect(card.getByText('Launch', { exact: true })).toBeVisible();
  await expect(card.getByText('Press', { exact: true })).toBeVisible();
});

test('the phone surface grows from its card without scaling text and lands back in it', async ({
  page,
  isMobile,
  browserName,
}) => {
  test.skip(
    !isMobile && browserName !== 'firefox',
    'Phone morph; Firefox exercises the same phone viewport.',
  );
  if (!isMobile) await page.setViewportSize({ width: 412, height: 915 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const account = await fixture(page);
  await closeTask(account.pane);
  const card = page.getByRole('article', { name: 'TASK-1 Write the launch plan', exact: true });
  const source = (await card.boundingBox())!;
  function sample(direction: 'opening' | 'closing') {
    return page.evaluate(async (direction) => {
      const samples: Array<{ width: number; textWidth: number; clip: string }> = [];
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const frame = () => {
          const surface = document.querySelector('[data-task-surface]');
          if (surface) {
            const box = surface.getBoundingClientRect();
            samples.push({
              width: box.width,
              textWidth: surface.firstElementChild!.getBoundingClientRect().width,
              clip: getComputedStyle(surface).clipPath,
            });
            if (
              direction === 'opening' &&
              samples.length > 2 &&
              Math.abs(box.width - innerWidth) < 0.5
            ) {
              resolve();
              return;
            }
          } else if (direction === 'closing' && samples.length) {
            resolve();
            return;
          }
          if (performance.now() - start > 5000) {
            resolve();
            return;
          }
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      return samples;
    }, direction);
  }
  const opening = sample('opening');
  await card.click();
  const arrived = await opening;
  expect(
    arrived.some(
      (frame) => frame.width > source.width + 2 && frame.width < page.viewportSize()!.width - 2,
    ),
  ).toBe(true);
  expect(
    arrived.every(
      (frame) =>
        Math.abs(frame.textWidth - page.viewportSize()!.width) < 1 && frame.clip === 'none',
    ),
  ).toBe(true);
  await expect(account.pane.getByRole('textbox', { name: 'Task title' })).toBeVisible();
  const closing = sample('closing');
  await account.pane.getByRole('button', { name: 'Back to the board' }).click();
  const left = await closing;
  expect(
    left.some(
      (frame) => frame.width > source.width + 2 && frame.width < page.viewportSize()!.width - 2,
    ),
  ).toBe(true);
  await expect(card).toBeVisible();
});

test('the open task lives in the URL: reload keeps it, Back closes it, a stale link says so', async ({
  page,
}) => {
  const account = await fixture(page);
  const { pane } = account;
  await expect(page).toHaveURL(new RegExp(`task=${account.taskId}`));
  await page.reload();
  await expect(page.getByLabel('Task', { exact: true })).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await expect(pane.getByRole('textbox', { name: 'Task title' })).toHaveValue(
    'Write the launch plan',
  );
  // Opened in this session, the task's history entry is gone once it closes.
  await closeTask(pane);
  await expect(page).not.toHaveURL(/task=/);
  await page.getByRole('article', { name: 'TASK-1 Write the launch plan', exact: true }).click();
  await expect(pane).toBeVisible();
  await page.goBack();
  await expect(pane).toHaveCount(0);
  await expect(page).not.toHaveURL(/task=/);
  await expect(page).toHaveURL(new RegExp(`/p/${account.projectId}`));

  // A subtask opened from its parent replaces the entry: Back closes both in one step.
  await page.getByRole('article', { name: 'TASK-1 Write the launch plan', exact: true }).click();
  await pane.getByRole('button', { name: 'Add subtask', exact: true }).click();
  await expect(pane.getByRole('textbox', { name: 'Task title' })).toBeFocused();
  await page.keyboard.type('Draft the outline');
  await pane.getByRole('textbox', { name: 'Task title' }).press('Enter');
  await expect(pane.getByRole('textbox', { name: 'Task title' })).toHaveValue('Draft the outline');
  await expect(page).not.toHaveURL(new RegExp(`task=${account.taskId}`));
  await page.goBack();
  await expect(page.locator('[data-task-screen]')).toHaveCount(0);
  await expect(pane).toHaveCount(0);
  await expect(page).not.toHaveURL(/task=/);

  await page.goto(`${account.path}&task=${randomUUID()}`);
  await expect(page.getByText('That task is not available')).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
  await expect(page).not.toHaveURL(/task=/);
  await expect(pane).toHaveCount(0);
});

/**
 * The room the card leaves for the side column on every frame from the one before `act` until
 * `ms` after it. It does not depend on the pane's width, which a resize changes meanwhile.
 */
async function columnRoom(
  page: Page,
  act: () => Promise<void>,
  { ms = 900, leaving = false }: { ms?: number; leaving?: boolean } = {},
) {
  await page.evaluate(
    ({ leaving }) => {
      const room: number[] = [];
      const state = window as unknown as { room: number[]; until: number };
      state.room = room;
      state.until = Number.POSITIVE_INFINITY;
      requestAnimationFrame(function sample(now) {
        // Looked up each frame: switching tasks mounts a new card. The one sliding away is
        // hidden, and counts only when asked for: then the frame's widest room is recorded.
        const cards = [...document.querySelectorAll('[data-task-card]')].filter(
          (card) => leaving || !card.closest('[aria-hidden="true"]'),
        );
        const values = cards.map((card) =>
          Math.round(Number.parseFloat(getComputedStyle(card.parentElement!).paddingRight)),
        );
        if (values.length) room.push(Math.max(...values));
        if (now < state.until) requestAnimationFrame(sample);
      });
    },
    { leaving },
  );
  await act();
  // Timed from the end of `act`, which can take a while on a busy machine.
  await page.evaluate((ms) => {
    (window as unknown as { until: number }).until = performance.now() + ms;
  }, ms);
  await page.waitForTimeout(ms + 100);
  return page.evaluate(() => (window as unknown as { room: number[] }).room);
}

/** Frames of the column part-way open: it springs rather than jumping. */
function sprung(room: number[]) {
  return room.filter((value) => value > 8 && value < 260).length;
}

test('a wide desktop pane keeps tags and subtasks in a column that opens and shuts with them', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'A phone keeps its stacked layout (ADR 0009)');
  const account = await fixture(page);
  const { pane } = account;
  // The task shown, not one sliding away as another replaces it.
  const card = pane.locator(':scope > :not([aria-hidden="true"]) [data-task-card]');
  const column = pane.getByRole('complementary', { name: 'Task sidebar' });
  const handle = page.getByRole('separator', { name: 'Resize task' });
  const addSubtask = pane.getByRole('button', { name: 'Add subtask', exact: true });
  const width = async () => Math.round((await card.boundingBox())!.width);
  const paneWidth = async () => Number(await handle.getAttribute('aria-valuenow'));

  // The pane opens narrower than the column needs, and an empty task has nothing for it.
  await expect(column).toHaveCount(0);
  await handle.focus();
  while ((await paneWidth()) < 620) await handle.press('Shift+ArrowLeft');
  await expect(column).toHaveCount(0);
  await expect(addSubtask).toBeVisible();
  await expect.poll(width).toBe(await paneWidth());

  // The first tag, picked from the dock, springs the column open; the card narrows for it.
  const tag = { id: randomUUID(), projectId: account.projectId, name: 'Launch', parentId: null };
  expect(
    (
      await page.request.post('/api/tags', {
        headers: account.headers,
        data: { ...tag, icon: null, color: 'amber' },
      })
    ).status(),
  ).toBe(201);
  const full = await width();
  await controls(page).getByRole('button', { name: 'Color: none. Change', exact: true }).click();
  const color = page.getByRole('region', { name: 'Color', exact: true });
  let room = await columnRoom(page, () =>
    color.getByRole('button', { name: 'Amber: Launch', exact: true }).click(),
  );
  await expect(column).toBeVisible();
  await expect.poll(width).toBe(full - 268);
  expect(sprung(room)).toBeGreaterThanOrEqual(3);
  await page.screenshot({ path: test.info().outputPath('column-open.png') });
  // It goes straight to the column, with the slot to add a subtask; the inline copies are
  // hidden and cannot be reached.
  await expect(pane.getByRole('region', { name: 'Task tags' })).toHaveCount(1);
  await expect(column.getByRole('region', { name: 'Task tags' })).toContainText('Launch');
  await expect(addSubtask).toHaveCount(1);
  await expect(column.getByRole('button', { name: 'Add subtask', exact: true })).toBeVisible();
  if (await color.count()) await page.keyboard.press('Escape');
  await expect(color).toHaveCount(0);

  // Removing the last tag springs it shut, and the slot comes back inline.
  await controls(page).getByRole('button', { name: 'Color: Launch. Change', exact: true }).click();
  room = await columnRoom(page, () =>
    color.getByRole('button', { name: 'No color tag', exact: true }).click(),
  );
  await expect(column).toHaveCount(0);
  await expect.poll(width).toBe(full);
  expect(sprung(room)).toBeGreaterThanOrEqual(3);
  if (await color.count()) await page.keyboard.press('Escape');
  await expect(color).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Add subtask', exact: true })).toBeVisible();

  // A subtask left untouched is discarded on the way back, and never opens the column.
  const title = pane.getByRole('textbox', { name: 'Task title' });
  room = await columnRoom(
    page,
    async () => {
      await addSubtask.click();
      await expect(title).toBeFocused();
      await title.press('Escape');
      await expect(title).toHaveValue('Write the launch plan');
    },
    { leaving: true },
  );
  // The new row reaches the parent a frame or two before the subtask's page pushes it off,
  // and the parent then holds its layout while it leaves: the column never shows.
  expect(Math.max(...room)).toBeLessThan(8);
  await expect(card.getByRole('button', { name: 'Add subtask', exact: true })).toBeVisible();

  // The first subtask opens it: made inline, it is in the column when its parent comes back,
  // with focus on its card there.
  await addSubtask.click();
  await expect(title).toBeFocused();
  await expect(column).toHaveCount(0);
  await page.keyboard.type('Draft the announcement');
  await title.press('Escape');
  await expect(title).toHaveValue('Write the launch plan');
  const subtask = pane.getByRole('article', { name: /^TASK-\d+ Draft the announcement$/ });
  await expect(column).toBeVisible();
  await expect(subtask).toHaveCount(1);
  await expect(column.getByRole('article')).toHaveCount(1);
  await expect(subtask).toBeFocused();
  expect(await width()).toBe(full - 268);
  // Opening it and coming back keeps the column as it was, without springing it again.
  room = await columnRoom(page, async () => {
    await subtask.click();
    await expect(title).toHaveValue('Draft the announcement');
    await pane.getByRole('button', { name: 'Back to TASK-1', exact: true }).click();
    await expect(title).toHaveValue('Write the launch plan');
  });
  await expect(subtask).toBeFocused();
  expect(sprung(room)).toBe(0);

  // Narrowed past the breakpoint, the layout springs back to stacked: the card widens on the
  // spring while the subtasks unfold below the description, and only one copy is reachable.
  await handle.focus();
  room = await columnRoom(page, async () => {
    while ((await paneWidth()) >= 620) await handle.press('ArrowRight');
  });
  await expect(column).toHaveCount(0);
  await expect.poll(width).toBe(await paneWidth());
  expect(sprung(room)).toBeGreaterThanOrEqual(3);
  await expect(card.getByRole('article', { name: /Draft the announcement$/ })).toBeVisible();
  await expect(pane.getByRole('article')).toHaveCount(1);
  await expect(addSubtask).toHaveCount(1);
});
