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
  await expect(pane.getByRole('button', { name: 'Edit description' })).toBeVisible();
  return { ...account, projectId, taskId, workspaceId, statuses, status, path, pane };
}

async function editDescription(pane: Locator, text: string) {
  await pane.getByRole('button', { name: 'Edit description' }).click();
  const editor = pane.locator('.bn-editor[contenteditable="true"]');
  await expect(editor).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await editor.fill(text);
  return editor;
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
  if (isMobile) expect(box.width).toBe(page.viewportSize()!.width);
  else {
    expect(box.width).toBeLessThan(page.viewportSize()!.width * 0.65);
    const handle = page.getByRole('separator', { name: 'Resize task' });
    const before = Number(await handle.getAttribute('aria-valuenow'));
    await handle.focus();
    await handle.press('ArrowLeft');
    await expect(handle).toHaveAttribute('aria-valuenow', String(before + 32));
  }
  await pane.getByRole('textbox', { name: 'Task title' }).fill('A plan ready to share');
  await pane.getByRole('textbox', { name: 'Task title' }).press('Enter');
  await pane.getByRole('button', { name: 'Status: Working. Change', exact: true }).click();
  await page.getByRole('menuitem', { name: 'backlog', exact: true }).click();
  await pane.getByRole('button', { name: 'Priority: Default. Change' }).click();
  await page.getByRole('menuitemradio', { name: 'Urgent', exact: true }).click();
  await editDescription(pane, 'Prepare the launch checklist.');
  await pane.getByRole('button', { name: 'Bold', exact: true }).click();
  await pane.getByRole('button', { name: 'Save description' }).click();
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

  await pane.getByRole('button', { name: 'Add subtask', exact: true }).click();
  await pane.getByRole('textbox', { name: 'Subtask title' }).fill('Draft the announcement');
  await pane.getByRole('button', { name: 'Add subtask', exact: true }).click();
  await pane
    .getByRole('button', { name: 'Status of Draft the announcement: backlog. Change' })
    .click();
  await page.getByRole('menuitem', { name: 'Working', exact: true }).click();
  await pane.getByRole('button', { name: /^Draft the announcement.*Working/ }).click();
  await expect(pane.getByRole('textbox', { name: 'Task title' })).toHaveValue(
    'Draft the announcement',
  );
  await expect(pane.getByRole('button', { name: 'Add subtask', exact: true })).toHaveCount(0);
  await pane.getByRole('button', { name: 'TASK-1 A plan ready to share' }).click();

  await pane.getByRole('button', { name: 'Task actions' }).click();
  await page.getByRole('menuitem', { name: 'Close task', exact: true }).click();
  await expect(
    pane.getByRole('button', { name: 'Status: done. Change', exact: true }),
  ).toBeVisible();
  await pane.getByRole('button', { name: 'Task actions' }).click();
  await page.getByRole('menuitem', { name: 'Reopen task', exact: true }).click();
  await expect(
    pane.getByRole('button', { name: 'Status: backlog. Change', exact: true }),
  ).toBeVisible();
  await pane.getByRole('button', { name: 'Task actions' }).click();
  await page.getByRole('menuitem', { name: 'Move to trash' }).click();
  await expect(pane).toContainText('This task is in the trash.');
  await pane.getByRole('button', { name: 'Task actions' }).click();
  await page.getByRole('menuitem', { name: 'Restore task' }).click();
  await expect(pane).not.toContainText('This task is in the trash.');

  // HTTP on a LAN and denied clipboard permission both need a selectable fallback.
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }),
  );
  await pane.getByRole('button', { name: 'Task actions' }).click();
  await page.getByRole('menuitem', { name: 'Copy task link' }).click();
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
  await expect(pane.getByRole('button', { name: 'Task actions' })).toBeFocused();
  await page.goto(href);
  await expect(pane.getByRole('textbox', { name: 'Task title' })).toHaveValue(
    'A plan ready to share',
    { timeout: APP_LOAD_TIMEOUT },
  );
  await page.keyboard.press('Escape');
  await expect(pane).toHaveCount(0);
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
  await pane.getByRole('button', { name: 'Priority: Default. Change' }).click();
  await page.getByRole('menuitemradio', { name: 'Someday', exact: true }).click();
  await pane.getByRole('button', { name: 'Status: Working. Change', exact: true }).click();
  await page.getByRole('menuitem', { name: 'backlog', exact: true }).click();
  await pane.getByRole('button', { name: 'Save description' }).click();
  await expect(pane).toContainText('Queued for sync');
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
  await expect(pane).not.toContainText('Queued for sync');
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
    await otherPane.getByRole('button', { name: 'Save description' }).click();
    await expect(pane).toContainText('The description changed on another device.');
    await expect(pane.locator('.bn-editor[contenteditable="true"]')).toContainText(
      'My unsaved launch details.',
    );
    await expect(pane.getByRole('button', { name: 'Save description' })).toBeDisabled();
    await pane.getByRole('button', { name: 'Review latest description' }).click();
    await expect(pane).toContainText('A description from the other device.');
    await pane.getByRole('button', { name: 'Apply my version' }).click();
    await expect
      .poll(async () => String((await taskRow(page, account))?.description))
      .toContain('My unsaved launch details.');
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
    await pane.getByRole('button', { name: 'Save description' }).click();
    await expect(pane).toContainText('Queued for sync');
    await page.keyboard.press('Escape');
    await expect(pane).toHaveCount(0);
    await editDescription(otherPane, 'The server keeps this version.');
    await otherPane.getByRole('button', { name: 'Save description' }).click();
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

test('reduced motion keeps the pane, keyboard controls and an unsaved draft usable in both themes', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { pane } = await fixture(page);
  await editDescription(pane, 'A focused plan for the launch, with room for the details.');
  await pane.getByRole('button', { name: 'Priority: Default. Change' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pane).toBeVisible();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(pane).toHaveCount(0);
  await page.getByRole('article', { name: 'TASK-1 Write the launch plan', exact: true }).click();
  await expect(pane.locator('.bn-editor[contenteditable="true"]')).toContainText(
    'A focused plan for the launch',
  );
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    const path = testInfo.outputPath(`task-pane-${colorScheme}-reduced.png`);
    await page.screenshot({ path });
    await testInfo.attach(`${colorScheme} with reduced motion`, { path, contentType: 'image/png' });
  }
});
