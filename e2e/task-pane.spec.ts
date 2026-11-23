import { randomUUID } from 'node:crypto';
import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import { APP_LOAD_TIMEOUT, shapeRows, signUp, waitForCachedProject } from './helpers';
import { newTag } from './tag-helpers';

async function fixture(page: Page, { followWorkspaceHome = false } = {}) {
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
  if (followWorkspaceHome) await expect(page).toHaveURL(path, { timeout: APP_LOAD_TIMEOUT });
  else await page.goto(path);
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
  await expect(pane).toHaveCount(0);
  await expect(page.locator('[data-task-screen]')).toHaveCount(0);
  const trashToast = page.locator('[data-sonner-toast]', { hasText: 'TASK-1 moved to the trash' });
  await expect(trashToast).toBeVisible();
  await trashToast.getByRole('button', { name: 'Undo', exact: true }).click();
  if (isMobile) await backlog.click();
  const restoredCard = page.getByRole('article', {
    name: 'TASK-1 A plan ready to share',
    exact: true,
  });
  await expect(restoredCard).toBeVisible();
  await restoredCard.click();
  await expect(pane).toBeVisible();

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
  // Enough children that the primary tag's list is taller than its swatches.
  for (const name of ['Blog', 'Events', 'Partners', 'Social', 'Video']) await tag(name, launch);
  const tagsPanel = () =>
    page.getByRole(isMobile ? 'dialog' : 'region', { name: 'Tags', exact: true });
  // The children reach the device after the root; the picker can only open what it has.
  await controls(page).getByRole('button', { name: 'Tags: none. Change', exact: true }).click();
  // The Primary / Secondary tab selector sits at the bottom of the panel, below the picker content.
  const roleTabs = tagsPanel().getByRole('tablist', { name: 'Tag role', exact: true });
  await expect(roleTabs).toBeVisible();
  // Measured once the panel has come to rest: it grows as the new tags reach the device.
  const below = async (above: Locator) => {
    const box = (await above.boundingBox())!;
    return (await roleTabs.boundingBox())!.y - (box.y + box.height);
  };
  await expect
    .poll(() => below(tagsPanel().getByRole('button', { name: 'No color tag', exact: true })))
    .toBeGreaterThanOrEqual(0);
  await tagsPanel().getByRole('tab', { name: 'Secondary', exact: true }).click();
  await expect(
    tagsPanel().getByRole('checkbox', { name: 'Launch / Video', exact: true }),
  ).toBeAttached();
  // The Primary tab picks the primary tag by color and opens its children.
  await tagsPanel().getByRole('tab', { name: 'Primary', exact: true }).click();
  await tagsPanel().getByRole('button', { name: 'Amber: Launch', exact: true }).click();
  // On a phone the drawer grows with the picker's child list, so all of it is on screen; the
  // desktop panel keeps its height and scrolls.
  const last = tagsPanel().getByRole('button', { name: 'Launch / Video', exact: true });
  if (isMobile) await expect(last).toBeInViewport({ ratio: 1 });
  else await expect(last).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('color-picker.png') });
  await page.keyboard.press('Escape');
  await expect(tagsPanel()).toHaveCount(0);
  const launchButton = controls(page).getByRole('button', {
    name: 'Tags: Launch. Change',
    exact: true,
  });
  await expect(launchButton).toBeFocused();
  await expect(launchButton.locator('[data-color="amber"]')).toBeVisible();
  await launchButton.click();
  const picker = tagsPanel();
  // Switching role swaps the views above the role tabs, and the panel springs between their
  // heights rather than jumping (the phone's drawer follows it frame by frame). The spring
  // starts with the tab, not once the leaving view has gone.
  const roles = picker.getByRole('tablist', { name: 'Tag role', exact: true });
  const views = roles.locator('xpath=../preceding-sibling::*[1]');
  await expect(views).toBeVisible();
  // Clicked from the page so the samples start with the click, not after Playwright's wait for
  // the drawer to come to rest.
  const sampled = await roles.evaluate(
    (tabs, views) =>
      new Promise<number[]>((resolve) => {
        const seen: number[] = [];
        const step = () => {
          seen.push(Math.round(views.getBoundingClientRect().height));
          // Done once it has held still for a while after moving.
          const still = seen.length > 20 && new Set(seen.slice(-15)).size === 1;
          if ((still && seen.at(-1) !== seen[0]) || seen.length >= 180) resolve(seen);
          else requestAnimationFrame(step);
        };
        tabs.querySelector<HTMLElement>('[role="tab"]:not([aria-selected="true"])')?.click();
        requestAnimationFrame(step);
      }),
    await views.elementHandle(),
  );
  const [from, to] = [sampled[0]!, sampled.at(-1)!];
  expect(to - from).toBeGreaterThan(20);
  expect(sampled.filter((h) => h > from + 4 && h < to - 4).length).toBeGreaterThan(2);
  expect(sampled.findIndex((h) => h !== from)).toBeLessThanOrEqual(3);
  const steps = sampled.slice(1).map((h, i) => Math.abs(h - sampled[i]!));
  expect(Math.max(...steps)).toBeLessThan((to - from) / 2);
  await expect(picker.getByRole('tab', { name: 'Secondary', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await picker.getByRole('checkbox', { name: 'Launch / Press', exact: true }).check();
  // Tags take several choices, so the picker stays open until it is dismissed, with tabs pinned below.
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('tab', { name: 'Secondary · 1', exact: true })).toBeVisible();
  await expect
    .poll(() => below(picker.getByRole('textbox', { name: 'Find tags' })))
    .toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: test.info().outputPath('tag-picker.png') });
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(pane).toBeVisible();
  await expect(
    controls(page).getByRole('button', { name: 'Tags: Launch, Press. Change', exact: true }),
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

test('the unified tags panel makes a tag in either tab’s corner and assigns it at once', async ({
  page,
  isMobile,
}) => {
  const account = await fixture(page);
  const { pane } = account;
  const tag = async (name: string, parentId: string | null, color: string | null) => {
    const id = randomUUID();
    const response = await page.request.post('/api/tags', {
      headers: account.headers,
      data: { id, projectId: account.projectId, name, parentId, icon: null, color },
    });
    expect(response.status()).toBe(201);
    return id;
  };
  const launch = await tag('Launch', null, 'red');
  await tag('Press', launch, null);
  // On a phone the picker is a page of the drawer and the form takes its place there; on
  // desktop the picker is a panel of the dock and the form is a centred dialog over it.
  const panel = page.getByRole(isMobile ? 'dialog' : 'region', { name: 'Tags', exact: true });
  const form = page.getByRole('dialog', { name: 'New tag', exact: true });
  const newTag = panel.getByRole('button', { name: 'New tag', exact: true });

  // A top-level tag starts with the first color no root holds, and becomes the primary.
  await controls(page).getByRole('button', { name: 'Tags: none. Change', exact: true }).click();
  await newTag.click();
  await expect(form.getByRole('textbox', { name: 'Name' })).toBeFocused();
  if (isMobile) {
    // The open task raises the drawer, whose dock rides up on the keyboard; the form's page
    // ends above the keyboard instead, so its title and the field being typed in stay in view.
    const keyboard = 300;
    await page.evaluate(
      (height) => document.documentElement.style.setProperty('--keyboard', `${height}px`),
      keyboard,
    );
    const viewport = page.viewportSize()!;
    await expect
      .poll(async () => (await form.boundingBox())!.y + (await form.boundingBox())!.height)
      .toBeLessThanOrEqual(viewport.height - keyboard + 1);
    await expect(form.getByRole('heading', { name: 'New tag' })).toBeInViewport({ ratio: 1 });
    await expect(form.getByRole('textbox', { name: 'Name' })).toBeInViewport({ ratio: 1 });
    await expect.poll(async () => (await form.boundingBox())!.y).toBeGreaterThanOrEqual(0);
    await page.evaluate(() => document.documentElement.style.removeProperty('--keyboard'));
  }
  await expect(form.getByRole('button', { name: 'Orange', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await form.getByRole('textbox', { name: 'Name' }).fill('Roadmap');
  await page.screenshot({ path: test.info().outputPath('new-tag-form.png') });
  await form.getByRole('button', { name: 'Save tag', exact: true }).click();
  await expect(form).toHaveCount(0);
  const roadmap = panel.getByRole('button', { name: 'Orange: Roadmap', exact: true });
  await expect(roadmap).toHaveAttribute('aria-pressed', 'true');
  await expect(roadmap).toBeInViewport({ ratio: 1 });
  if (!isMobile) await expect(newTag).toBeFocused();
  await page.screenshot({ path: test.info().outputPath('color-new-tag.png') });

  // In a color's children, it makes another child there, and Back returns to that list.
  await panel.getByRole('button', { name: 'Red: Launch', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Back from Launch' })).toBeVisible();
  await newTag.click();
  await expect(form.getByRole('combobox', { name: 'Parent tag' })).toHaveValue(launch);
  await page.keyboard.press('Escape');
  await expect(form).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Back from Launch' })).toBeVisible();
  await newTag.click();
  await form.getByRole('textbox', { name: 'Name' }).fill('Video');
  await form.getByRole('button', { name: 'Save tag', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Launch / Video', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // The Secondary tab's corner adds the new tag to the task's other tags, and returns there on mobile.
  await panel.getByRole('tab', { name: 'Secondary', exact: true }).click();
  // The Primary view is still fading out beside it, so this names the arriving one's corner.
  const secondaryNewTag = panel
    .getByRole('tabpanel', { name: /^Secondary/ })
    .getByRole('button', { name: 'New tag', exact: true });
  await secondaryNewTag.click();
  await expect(form.getByRole('combobox', { name: 'Parent tag' })).toHaveValue('');
  await form.getByRole('textbox', { name: 'Name' }).fill('Docs');
  await form.getByRole('button', { name: 'Save tag', exact: true }).click();
  await expect(form).toHaveCount(0);
  const docs = panel.getByRole('checkbox', { name: 'Docs', exact: true });
  await expect(docs).toBeChecked();
  await expect(docs).toBeInViewport({ ratio: 1 });
  if (!isMobile) await expect(secondaryNewTag).toBeFocused();
  await page.screenshot({ path: test.info().outputPath('tags-new-tag.png') });
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(
    controls(page).getByRole('button', { name: 'Tags: Video, Docs. Change', exact: true }),
  ).toBeVisible();
  await expect(pane.getByRole('region', { name: 'Task tags' })).toContainText('Docs');

  await expect
    .poll(async () => {
      const tags = await shapeRows(page.request, 'tags', account.headers);
      const id = (name: string) => tags.find((row) => row.name === name)?.id;
      const row = await taskRow(page, account);
      const assignments = await shapeRows(page.request, 'task-tags', account.headers);
      return [
        tags.find((row) => row.name === 'Roadmap')?.color,
        tags.find((row) => row.name === 'Video')?.parent_id,
        row?.primary_tag_id === id('Video'),
        assignments.map((assignment) => assignment.tag_id).includes(id('Docs')),
      ];
    })
    .toEqual(['orange', launch, true, true]);
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

test("a subtask lands in its card in the parent with the card's face and edge", async ({
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
  const { pane } = await fixture(page);
  await pane.getByRole('button', { name: 'Add subtask', exact: true }).click();
  await page.keyboard.type('Sharpen the shears');
  await page.getByRole('button', { name: 'Back to TASK-1' }).click();
  const card = pane.getByRole('article', { name: 'TASK-2 Sharpen the shears' });
  await expect(card).toBeVisible();
  await card.click();
  const subtask = page.getByLabel('Task', { exact: true });
  await expect(subtask.getByRole('textbox', { name: 'Task title' })).toHaveValue(
    'Sharpen the shears',
  );
  // The last frame of the surface, before the card is shown again in its place.
  const last = page.evaluate(
    () =>
      new Promise<{ status: DOMRect; edge: number } | null>((resolve) => {
        let seen: { status: DOMRect; edge: number } | null = null;
        const start = performance.now();
        const frame = () => {
          const surface = document.querySelector('[aria-label="Closing task"] [data-task-surface]');
          if (!surface && seen) return resolve(seen);
          if (surface) {
            const edge = surface.querySelector('[data-task-edge]');
            seen = {
              status: surface.querySelector('[data-task-face] .truncate')!.getBoundingClientRect(),
              edge: edge ? Number(getComputedStyle(edge).opacity) : 0,
            };
          }
          if (performance.now() - start > 5000) return resolve(null);
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
  );
  await page.getByRole('button', { name: 'Back to TASK-1' }).click();
  const landed = (await last)!;
  const status = (await card.getByText('backlog').boundingBox())!;
  expect(Math.abs(landed.status.x - status.x)).toBeLessThan(1);
  expect(Math.abs(landed.status.y - status.y)).toBeLessThan(1);
  expect(landed.edge).toBeGreaterThan(0.95);
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
  await controls(page).getByRole('button', { name: 'Tags: none. Change', exact: true }).click();
  const tagsPanel = page.getByRole('region', { name: 'Tags', exact: true });
  let room = await columnRoom(page, () =>
    tagsPanel.getByRole('button', { name: 'Amber: Launch', exact: true }).click(),
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
  if (await tagsPanel.count()) await page.keyboard.press('Escape');
  await expect(tagsPanel).toHaveCount(0);

  // Removing the last tag springs it shut, and the slot comes back inline.
  await controls(page).getByRole('button', { name: 'Tags: Launch. Change', exact: true }).click();
  room = await columnRoom(page, () =>
    tagsPanel.getByRole('button', { name: 'No color tag', exact: true }).click(),
  );
  await expect(column).toHaveCount(0);
  await expect.poll(width).toBe(full);
  expect(sprung(room)).toBeGreaterThanOrEqual(3);
  if (await tagsPanel.count()) await page.keyboard.press('Escape');
  await expect(tagsPanel).toHaveCount(0);
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

test('task size picker and optional card badge work on both boards', async ({ page, isMobile }) => {
  const account = await fixture(page);
  await newTag(page.request, account, account.projectId, { name: 'Design', color: 'teal' });
  const dock = controls(page);
  await expect(dock.getByRole('button', { name: 'Tags: none. Change' })).toBeVisible();
  await expect(dock.getByRole('button')).toHaveCount(5);
  const sizeButton = (size: string) => dock.getByRole('button', { name: `Size: ${size}. Change` });
  const picker = page.getByRole('radiogroup', { name: 'Size', exact: true });
  const sizeOption = (size: string) => picker.getByRole('radio', { name: size, exact: true });
  if (isMobile) {
    const target = await sizeButton('none').boundingBox();
    expect(target?.width).toBeGreaterThanOrEqual(56);
    expect(target?.height).toBeGreaterThanOrEqual(44);
  }
  await sizeButton('none').click();
  await expect(sizeOption('None')).toBeChecked();
  if (isMobile) {
    const target = await sizeOption('M').boundingBox();
    expect(target?.width).toBeGreaterThanOrEqual(44);
    expect(target?.height).toBeGreaterThanOrEqual(44);
  }
  await sizeOption('M').click();
  await expect.poll(async () => (await taskRow(page, account))?.size).toBe('3');

  await sizeButton('M').click();
  await expect(sizeOption('M')).toBeChecked();
  await sizeOption('M').click();
  await expect.poll(async () => (await taskRow(page, account))?.size).toBeNull();
  await sizeButton('none').click();
  await sizeOption('XL').click();
  await expect.poll(async () => (await taskRow(page, account))?.size).toBe('5');

  await closeTask(account.pane);
  const card = page.locator(`[data-card-id="${account.taskId}"]`);
  const badge = card.getByText('Size XL', { exact: true });
  await expect(badge).toHaveCount(0);
  const toggleSizeOnCards = async (expectedChecked: boolean) => {
    if (isMobile) {
      await page.getByRole('button', { name: 'Switch project or workspace', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
    } else await page.getByRole('link', { name: 'Settings', exact: true }).click();
    const setting = page.getByRole('switch', { name: 'Size on cards', exact: true });
    if (expectedChecked) await expect(setting).not.toBeChecked();
    else await expect(setting).toBeChecked();
    await setting.click();
    if (expectedChecked) await expect(setting).toBeChecked();
    else await expect(setting).not.toBeChecked();
    await page.goBack();
  };
  await toggleSizeOnCards(true);
  await expect(badge).toBeVisible();

  await page.goto(`/w/${account.workspaceId}/board`);
  await expect(badge).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await toggleSizeOnCards(false);
  await expect(badge).toHaveCount(0);

  await page.goto(`${account.path}&task=${account.taskId}`);
  await sizeButton('XL').click();
  await sizeOption('None').click();
  await expect.poll(async () => (await taskRow(page, account))?.size).toBeNull();
});

test('task size stays unavailable on older servers while other task edits sync', async ({
  page,
}) => {
  await page.route('**/api/compatibility', (route) => route.fulfill({ json: { min: 1, max: 1 } }));
  await page.route('**/api/shapes/tasks?**', async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const headers = response.headers();
    if (headers['electric-schema']) {
      const schema = JSON.parse(headers['electric-schema']);
      delete schema.size;
      headers['electric-schema'] = JSON.stringify(schema);
    }
    const changes = await response.json();
    for (const change of changes) if (change.value) delete change.value.size;
    await route.fulfill({ response, headers, json: changes });
  });

  const account = await fixture(page);
  await expect(controls(page).getByRole('button', { name: /^Size:/ })).toHaveCount(0);
  const title = account.pane.getByRole('textbox', { name: 'Task title' });
  await title.fill('Edited on the preview server');
  await title.press('Enter');
  await expect
    .poll(async () => (await taskRow(page, account))?.title)
    .toBe('Edited on the preview server');
});

test('description code blocks dedent pasted code, highlight it and export the source', async ({
  page,
  isMobile,
  browser,
  browserName,
}, testInfo) => {
  testInfo.annotations.push({ type: 'browser version', description: browser.version() });
  if (browserName === 'chromium') {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  }
  const { pane } = await fixture(page, { followWorkspaceHome: true });
  const editor = pane
    .getByRole('region', { name: 'Description', exact: true })
    .locator('.bn-editor');
  await editor.click();
  await page.keyboard.type('``` ');
  const block = editor.locator('[data-content-type="codeBlock"]');
  const code = block.locator('pre > code');
  await expect(block.getByRole('button', { name: 'Code language: Plain text' })).toBeVisible();

  // The dev server has no service worker. Allow locally bundled modules while the API is offline.
  await page.route('**/api/**', (route) => route.abort());
  const source = 'def greet(name):\n    print("Hello", name)';
  await code.evaluate((node, value) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', value);
    // Firefox ignores constructor-supplied clipboard data on synthetic paste events.
    const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: clipboardData });
    node.dispatchEvent(paste);
  }, '    def greet(name):\r\n        print("Hello", name)');
  await expect(code).toHaveJSProperty('textContent', source);
  const python = block.getByRole('button', { name: 'Code language: Python', exact: true });
  await expect(python).toBeVisible();
  const keyword = code.locator('span[style*="--code-token-keyword"]').filter({ hasText: 'def' });
  await expect(keyword).toBeVisible();
  const light = await keyword.evaluate((node) => getComputedStyle(node).color);
  await page.evaluate(() => {
    document.documentElement.style.colorScheme = 'dark';
  });
  await expect.poll(() => keyword.evaluate((node) => getComputedStyle(node).color)).not.toBe(light);

  if (isMobile) {
    await python.locator('.code-language-icon').tap();
  } else {
    await python.focus();
  }
  const copy = block.getByRole('button', { name: 'Copy snippet', exact: true });
  await expect(copy).toBeVisible();
  await expect
    .poll(() =>
      copy.locator('svg').evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return [Math.round(rect.width), Math.round(rect.height)];
      }),
    )
    .toEqual([16, 16]);
  if (isMobile) await copy.tap();
  else await copy.press('Enter');
  await expect(page.getByText('Snippet copied', { exact: true })).toBeVisible();
  if (browserName === 'chromium') {
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(source);
  }
  const download = page.waitForEvent('download');
  await block.getByRole('button', { name: 'Download snippet', exact: true }).click();
  const snippet = await download;
  expect(snippet.suggestedFilename()).toBe('snippet.py');
  const chunks: Buffer[] = [];
  for await (const chunk of await snippet.createReadStream()) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString('utf8')).toBe(source);

  if (isMobile) await python.locator('.code-language-icon').tap();
  else await python.press('Enter');
  await page.getByRole('combobox', { name: 'Search languages' }).fill('ts');
  await page.getByRole('option', { name: 'TypeScript', exact: true }).click();
  await expect(
    block.getByRole('button', { name: 'Code language: TypeScript', exact: true }),
  ).toBeVisible();
  await expect(code).toHaveJSProperty('textContent', source);

  // Inline code uses Catch's rounded tinted chip styling.
  await editor.locator('.bn-trailing-block').click();
  await page.keyboard.type('Use `inline_code` here');
  const inlineCode = editor.locator('.bn-inline-content code', { hasText: 'inline_code' });
  await expect(inlineCode).toBeVisible();
  const inlineStyle = await inlineCode.evaluate((node) => {
    const s = getComputedStyle(node);
    return { bg: s.backgroundColor, radius: Number.parseFloat(s.borderTopLeftRadius) };
  });
  expect(inlineStyle.bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(inlineStyle.radius).toBeGreaterThan(2);
});

test('trashing a task or subtask closes the task view with an Undo toast', async ({
  page,
  isMobile,
}) => {
  const { headers, workspaceId, projectId, taskId, status, pane } = await fixture(page);
  const subtaskId = randomUUID();
  expect(
    (
      await page.request.post('/api/tasks', {
        headers,
        data: {
          id: subtaskId,
          projectId,
          title: 'Trim the rollout checklist',
          statusId: status('active'),
          priority: 3,
          position: 'a0',
          parentId: taskId,
          description: null,
          descriptionVersion: null,
        },
      })
    ).status(),
  ).toBe(201);

  // 1. Trashing a subtask opened from its parent returns to the parent and Undo restores it.
  const subtaskCard = pane.getByRole('article', {
    name: /^TASK-\d+ Trim the rollout checklist$/,
  });
  await expect(subtaskCard).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await subtaskCard.click();
  await expect(pane.getByRole('textbox', { name: 'Task title' })).toHaveValue(
    'Trim the rollout checklist',
  );
  if (isMobile) await expect(page.getByLabel('Task beneath', { exact: true })).toHaveCount(1);
  await pane.getByRole('button', { name: 'Move to trash' }).click();
  await expect(pane.getByRole('textbox', { name: 'Task title' })).toHaveValue(
    'Write the launch plan',
  );
  await expect(page.locator('[data-task-screen]')).toHaveCount(isMobile ? 1 : 0);
  await expect(subtaskCard).toHaveCount(0);
  const subtaskToast = page.locator('[data-sonner-toast]', {
    hasText: 'TASK-2 moved to the trash',
  });
  await expect(subtaskToast).toBeVisible();
  await subtaskToast.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(subtaskCard).toBeVisible();

  // 2. Trashing a subtask opened directly by URL returns to the board.
  await page.goto(`/w/${workspaceId}/p/${projectId}?view=board&task=${subtaskId}`);
  await expect(pane.getByRole('textbox', { name: 'Task title' })).toHaveValue(
    'Trim the rollout checklist',
    { timeout: APP_LOAD_TIMEOUT },
  );
  await pane.getByRole('button', { name: 'Move to trash' }).click();
  await expect(pane).toHaveCount(0);
  await expect(page.locator('[data-task-screen]')).toHaveCount(0);

  // 3. Opening a trashed task directly still allows restoring it from the toolbar.
  await page.goto(`/w/${workspaceId}/p/${projectId}?view=board&task=${subtaskId}`);
  await expect(pane).toContainText('This task is in the trash.', { timeout: APP_LOAD_TIMEOUT });
  await pane.getByRole('button', { name: 'Restore task' }).click();
  await expect(pane).not.toContainText('This task is in the trash.');
  await closeTask(pane);

  // 4. Trashing a top-level task closes the view, removes the card, and Undo brings it back.
  const topCard = page.getByRole('article', { name: 'TASK-1 Write the launch plan', exact: true });
  await topCard.click();
  await expect(pane).toBeVisible();
  await pane.getByRole('button', { name: 'Move to trash' }).click();
  await expect(pane).toHaveCount(0);
  await expect(page.locator('[data-task-screen]')).toHaveCount(0);
  await expect(topCard).toHaveCount(0);
  const topToast = page.locator('[data-sonner-toast]', { hasText: 'TASK-1 moved to the trash' });
  await expect(topToast).toBeVisible();
  await topToast.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(topCard).toBeVisible();
});

test('desktop task split-pane width persists across projects, workspace board, and reload', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'The split pane is the desktop board’s');
  await page.setViewportSize({ width: 1440, height: 900 });
  const { headers, workspaceId, projectId, pane } = await fixture(page);

  // Create a second project with its own task to verify width carries across projects and the
  // cross-project workspace board.
  const otherProjectId = randomUUID();
  const otherStatusId = randomUUID();
  const otherTaskId = randomUUID();
  expect(
    (
      await page.request.post('/api/projects', {
        headers,
        data: {
          id: otherProjectId,
          workspaceId,
          name: 'Second project',
          key: 'SEC',
          color: 'orange',
          icon: null,
          position: 'a1',
          statuses: [
            {
              id: randomUUID(),
              name: 'Backlog',
              category: 'backlog',
              position: 'a0',
              isDefault: true,
            },
            {
              id: otherStatusId,
              name: 'Working',
              category: 'active',
              position: 'a0',
              isDefault: true,
            },
            { id: randomUUID(), name: 'Done', category: 'done', position: 'a0', isDefault: true },
            {
              id: randomUUID(),
              name: 'Cancelled',
              category: 'cancelled',
              position: 'a0',
              isDefault: true,
            },
          ],
        },
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await page.request.post('/api/tasks', {
        headers,
        data: {
          id: otherTaskId,
          projectId: otherProjectId,
          title: 'Second project task',
          statusId: otherStatusId,
          priority: 3,
          position: 'a0',
          parentId: null,
          description: null,
          descriptionVersion: null,
        },
      })
    ).status(),
  ).toBe(201);

  const handle = page.getByRole('separator', { name: 'Resize task' });
  await expect(handle).toHaveAttribute('aria-valuenow', '440');

  // Drag the split handle left by 160px to widen the pane to 600px.
  const grip = (await handle.boundingBox())!;
  const x = grip.x + grip.width / 2;
  const y = grip.y + grip.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 160, y, { steps: 6 });
  await expect(handle).toHaveAttribute('aria-valuenow', '600');
  // Dragging does not write to localStorage until release.
  expect(await page.evaluate(() => localStorage.getItem('throw-task-pane-width'))).toBeNull();
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('throw-task-pane-width')))
    .toBe('600');
  await expect.poll(async () => Math.round((await pane.boundingBox())!.width)).toBe(600);

  // Switching to another project keeps the resized width.
  await page.goto(`/w/${workspaceId}/p/${otherProjectId}?view=board`);
  const secondCard = page.getByRole('article', {
    name: 'SEC-1 Second project task',
    exact: true,
  });
  await expect(secondCard).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await secondCard.click();
  await expect(pane).toBeVisible();
  await expect(handle).toHaveAttribute('aria-valuenow', '600');
  await expect.poll(async () => Math.round((await pane.boundingBox())!.width)).toBe(600);

  // Switching to the cross-project workspace board shares the same persisted width.
  await page.goto(`/w/${workspaceId}/board`);
  const workspaceCard = page.getByRole('article', {
    name: 'TASK-1 Write the launch plan',
    exact: true,
  });
  await expect(workspaceCard).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await workspaceCard.click();
  await expect(pane).toBeVisible();
  await expect(handle).toHaveAttribute('aria-valuenow', '600');

  // Reloading preserves the persisted width.
  await page.goto(`/w/${workspaceId}/p/${projectId}?view=board`);
  await page.reload();
  const reloadedCard = page.getByRole('article', {
    name: 'TASK-1 Write the launch plan',
    exact: true,
  });
  await expect(reloadedCard).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await reloadedCard.click();
  await expect(pane).toBeVisible();
  await expect(handle).toHaveAttribute('aria-valuenow', '600');

  // Narrowing the viewport clamps the rendered width without clobbering the stored preference.
  await page.setViewportSize({ width: 900, height: 900 });
  await expect
    .poll(async () => Number(await handle.getAttribute('aria-valuenow')))
    .toBeLessThan(600);
  expect(await page.evaluate(() => localStorage.getItem('throw-task-pane-width'))).toBe('600');

  // Widening restores the stored width.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(handle).toHaveAttribute('aria-valuenow', '600');
  await expect.poll(async () => Math.round((await pane.boundingBox())!.width)).toBe(600);
});
