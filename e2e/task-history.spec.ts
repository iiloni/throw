import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import {
  APP_LOAD_TIMEOUT,
  createAccount,
  shapeRows,
  signUp,
  waitForCachedProject,
} from './helpers';

const body = (text: string) => [{ type: 'paragraph', content: [{ type: 'text', text }] }];
async function fixture(page: Page) {
  const account = await signUp(page);
  const [workspace] = await shapeRows(page.request, 'workspaces', account.headers);
  const workspaceId = String(workspace!.id);
  const projectId = randomUUID();
  const taskId = randomUUID();
  const statuses = ['backlog', 'active', 'done', 'cancelled'].map((category) => ({
    id: randomUUID(),
    name: category === 'active' ? 'Doing' : category,
    category,
    position: 'a0',
    isDefault: true,
  }));
  expect(
    (
      await page.request.post('/api/projects', {
        headers: account.headers,
        data: {
          id: projectId,
          workspaceId,
          name: 'History project',
          key: 'LOG',
          color: 'teal',
          icon: null,
          position: 'a0',
          statuses,
        },
      })
    ).status(),
  ).toBe(201);
  const createTask = async (id: string, title: string) => {
    expect(
      (
        await page.request.post('/api/tasks', {
          headers: account.headers,
          data: {
            id,
            projectId,
            title,
            statusId: statuses[0]!.id,
            priority: 3,
            parentId: null,
            position: 'a0',
            description: null,
            descriptionVersion: null,
          },
        })
      ).status(),
    ).toBe(201);
  };
  await createTask(taskId, 'Prepare the release');
  const path = `/w/${workspaceId}/p/${projectId}?view=board&task=${taskId}`;
  await page.goto(path);
  const pane = page.getByLabel('Task', { exact: true });
  const history = pane.getByRole('region', { name: 'Task history', exact: true });
  await expect(history).toContainText('Created the task “Prepare the release” in “backlog”.', {
    timeout: APP_LOAD_TIMEOUT,
  });
  const update = async (changes: Record<string, unknown>) => {
    const id = randomUUID();
    expect(
      (
        await page.request.patch(`/api/tasks/${taskId}`, {
          headers: account.headers,
          data: { changeId: id, changes },
        })
      ).ok(),
    ).toBe(true);
    return id;
  };
  const comment = async (text: string) => {
    const id = randomUUID();
    expect(
      (
        await page.request.post('/api/comments', {
          headers: account.headers,
          data: { id, taskId, body: body(text) },
        })
      ).status(),
    ).toBe(201);
    return id;
  };
  return {
    ...account,
    workspaceId,
    projectId,
    taskId,
    statuses,
    pane,
    history,
    path,
    update,
    comment,
    createTask,
  };
}
const editor = (page: Page) =>
  page
    .getByRole('region', { name: 'Comment editor', exact: true })
    .locator('.bn-editor[contenteditable="true"]');
async function compose(page: Page, text: string) {
  await page.getByRole('button', { name: 'Write a comment…', exact: true }).click();
  await expect(editor(page)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await editor(page).fill(text);
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
}

test('history words every field in server order, preserving comments between writes', async ({
  page,
}) => {
  const f = await fixture(page);
  await f.update({
    title: { before: 'Prepare the release', after: 'Ship the release' },
    priority: { before: 3, after: 1 },
  });
  await expect(f.history).toContainText(
    'Renamed from “Prepare the release” to “Ship the release”. Changed priority from “Default” to “Critical”.',
  );
  await f.comment('Ready for the final checks.');
  await expect(f.history).toContainText('Ready for the final checks.');
  await f.update({ statusId: { before: f.statuses[0]!.id, after: f.statuses[1]!.id } });
  await expect(f.history).toContainText('Changed status from “backlog” to “Doing”.');
  const version = randomUUID();
  await f.update({
    description: { before: null, after: { version, document: body('Private description text') } },
  });
  await expect(f.history).toContainText('Changed the description.');
  await expect(f.history).not.toContainText('Private description text');
  const parentId = randomUUID();
  await f.createTask(parentId, 'Parent');
  await f.update({ parentId: { before: null, after: parentId } });
  await expect(f.history).toContainText('Moved under LOG-2.');
  await f.update({ parentId: { before: parentId, after: null } });
  await expect(f.history).toContainText('Removed parent LOG-2.');
  const tagId = randomUUID();
  expect(
    (
      await page.request.post('/api/tags', {
        headers: f.headers,
        data: {
          id: tagId,
          projectId: f.projectId,
          name: 'Release',
          parentId: null,
          color: 'amber',
          icon: null,
        },
      })
    ).status(),
  ).toBe(201);
  await f.update({
    primaryTagId: { before: null, after: tagId },
    secondaryTags: [{ tagId, present: true }],
  });
  await expect(f.history).toContainText('Set primary tag to “Release”. Added tag “Release”.');
  await f.update({
    primaryTagId: { before: tagId, after: null },
    secondaryTags: [{ tagId, present: false }],
  });
  await expect(f.history).toContainText('Removed primary tag “Release”. Removed tag “Release”.');
  await f.update({ trashed: { before: false, after: true } });
  await expect(f.history).toContainText('Moved to the trash.');
  await f.update({ trashed: { before: true, after: false } });
  await expect(f.history).toContainText('Restored from the trash.');
  const rows = await f.history.locator('ol > li').allTextContents();
  expect(rows.findIndex((text) => text.includes('Ready for the final checks.'))).toBe(2);
  expect(rows[3]).toContain('Changed status');
});

test('comments add, edit and delete; another workspace member has no editing controls', async ({
  page,
}) => {
  const f = await fixture(page);
  await compose(page, 'My first comment');
  const own = f.history.getByRole('article', { name: 'You commented' });
  await expect(own).not.toContainText('Pending sync');
  await own.getByRole('button', { name: 'Edit comment', exact: true }).click();
  await editor(page).fill('My revised comment');
  await page.getByRole('button', { name: 'Save comment', exact: true }).click();
  await expect(own).toContainText('My revised comment');
  await expect(own).toContainText('Edited');
  const member = await createAccount(page.request);
  // Sharing has no UI yet. Add a real membership in this worktree's database only.
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  execFileSync('./scripts/dev.sh', [
    'psql',
    '-c',
    `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${literal(f.workspaceId)}, ${literal(member.user.id)}, 'member')`,
  ]);
  expect(
    (
      await page.request.post('/api/comments', {
        headers: member.headers,
        data: { id: randomUUID(), taskId: f.taskId, body: body('A second member’s comment') },
      })
    ).status(),
  ).toBe(201);
  const other = f.history.getByRole('article', { name: 'Another member commented' });
  await expect(other).toContainText('A second member’s comment');
  await expect(other.getByRole('button')).toHaveCount(0);
  await expect(other.locator('[contenteditable="true"]')).toHaveCount(0);
  await own.getByRole('button', { name: 'Delete comment', exact: true }).click();
  await own.getByRole('button', { name: 'Keep comment', exact: true }).click();
  await expect(own).toBeVisible();
  await own.getByRole('button', { name: 'Delete comment', exact: true }).click();
  await own.getByRole('button', { name: 'Delete comment', exact: true }).click();
  await expect(own).toHaveCount(0);
});

test('offline comments survive reload, sync in server order, and refused changes have a quiet exact-entry notice on both devices', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const f = await fixture(page);
  const editId = await f.comment('Edit offline');
  const deleteId = await f.comment('Delete offline');
  await expect(f.history).toContainText('Delete offline');
  await waitForCachedProject(
    page,
    f.projectId,
    f.statuses.map((row) => row.id),
  );
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  try {
    const otherPage = await context.newPage();
    await otherPage.goto(f.path);
    await expect(otherPage.getByRole('region', { name: 'Task history' })).toContainText(
      'Delete offline',
      { timeout: APP_LOAD_TIMEOUT },
    );
    await page.route('**/api/**', (route) => route.abort('connectionfailed'));
    await compose(page, 'Written offline');
    const pending = f.history.getByRole('article').filter({ hasText: 'Written offline' });
    await expect(pending).toContainText('Pending sync');
    await pending.getByRole('button', { name: 'Edit comment', exact: true }).click();
    await editor(page).fill('Written and edited offline');
    await page.getByRole('button', { name: 'Save comment', exact: true }).click();
    const old = f.history.getByRole('article').filter({ hasText: 'Edit offline' });
    await old.getByRole('button', { name: 'Edit comment', exact: true }).click();
    await editor(page).fill('Existing comment edited offline');
    await page.getByRole('button', { name: 'Save comment', exact: true }).click();
    const deleted = f.history.getByRole('article').filter({ hasText: 'Delete offline' });
    await deleted.getByRole('button', { name: 'Delete comment', exact: true }).click();
    await deleted.getByRole('button', { name: 'Delete comment', exact: true }).click();
    await compose(page, 'Discard before sync');
    const discarded = f.history.getByRole('article').filter({ hasText: 'Discard before sync' });
    await discarded.getByRole('button', { name: 'Delete comment', exact: true }).click();
    await discarded.getByRole('button', { name: 'Delete comment', exact: true }).click();
    const title = f.pane.getByRole('textbox', { name: 'Task title' });
    await title.fill('Offline title');
    await title.press('Enter');
    await f.update({ title: { before: 'Prepare the release', after: 'Server title' } });
    await page.reload();
    await expect(f.history).toContainText('Written and edited offline', {
      timeout: APP_LOAD_TIMEOUT,
    });
    await expect(f.history).toContainText('Pending sync');
    await expect(f.history).not.toContainText('Delete offline');
    await page.unroute('**/api/**');
    await expect(f.history).toContainText(
      'Title not applied: wanted “Offline title”; kept “Server title” because it changed before this update synced.',
      { timeout: 60_000 },
    );
    await expect(f.history).not.toContainText('Pending sync');
    const notice = page.getByRole('complementary', { name: 'Unapplied changes' });
    await notice.getByRole('button', { name: 'Review in history' }).click();
    const focused = f.history.locator('li:focus');
    await expect(focused).toContainText('Title not applied');
    await expect(otherPage.getByRole('complementary', { name: 'Unapplied changes' })).toBeVisible();
    await notice.getByRole('button', { name: 'Dismiss notice' }).click();
    await page.reload();
    await expect(f.history).toContainText('Title not applied', { timeout: APP_LOAD_TIMEOUT });
    await expect(notice).toHaveCount(0);
    await expect(otherPage.getByRole('complementary', { name: 'Unapplied changes' })).toBeVisible();
    await f.update({ title: { before: 'Prepare the release', after: 'Another refused title' } });
    await expect(notice).toHaveCount(1);
    await expect(f.history).toContainText('Another refused title');
    const rows = (await shapeRows(page.request, 'comments', f.headers)).filter(
      (row) => row.task_id === f.taskId,
    );
    expect(rows).toHaveLength(2);
    expect(rows.some((row) => row.id === deleteId)).toBe(false);
    expect(rows.find((row) => row.id === editId)?.body).toContain(
      'Existing comment edited offline',
    );
    expect(rows.every((row) => row.created_at !== null)).toBe(true);
  } finally {
    await context.close();
  }
});

test('refused descriptions recover through the existing controls on a device without a local draft', async ({
  page,
}) => {
  const f = await fixture(page);
  const version = randomUUID();
  await f.update({
    description: { before: null, after: { version, document: body('Current description') } },
  });
  await f.update({
    description: {
      before: null,
      after: { version: randomUUID(), document: body('Recover this description') },
    },
  });
  await expect(f.history).toContainText('Description not applied');
  await expect(f.history).not.toContainText('Recover this description');
  await f.history.getByRole('button', { name: 'Recover description' }).click();
  const description = f.pane.getByRole('region', { name: 'Description', exact: true });
  await expect(description).toContainText('Your description was not applied.');
  await expect(description.locator('[contenteditable="true"]')).toContainText(
    'Recover this description',
  );
  await description.getByRole('button', { name: 'Review latest description' }).click();
  await expect(description).toContainText('Current description');
  await description.getByRole('button', { name: 'Use latest description' }).click();
  await expect(description).not.toContainText('Recover this description');
  await f.update({ priority: { before: 3, after: 2 } });
  await expect(f.history).toContainText('Changed priority');
  await expect(description).not.toContainText('Recover this description');
  await description.locator('[contenteditable="true"]').fill('My current draft');
  await f.history.getByRole('button', { name: 'Recover description' }).click();
  await expect(description).toContainText('Your current draft is kept.');
  await expect(description.locator('[contenteditable="true"]')).toContainText('My current draft');
});

test('comment composition stays clear of the phone keyboard and dock in both themes', async ({
  page,
  isMobile,
  browserName,
}, testInfo) => {
  if (browserName === 'firefox') await page.setViewportSize({ width: 412, height: 915 });
  const phone = isMobile || browserName === 'firefox';
  const f = await fixture(page);
  await f.history.getByRole('button', { name: 'Write a comment…' }).click();
  await expect(editor(page)).toBeFocused({ timeout: APP_LOAD_TIMEOUT });
  await page.evaluate(() => document.documentElement.style.setProperty('--keyboard', '300px'));
  await editor(page).fill('Comment line 1');
  for (let line = 2; line <= 24; line++) {
    await editor(page).press('Enter');
    await page.keyboard.insertText(`Comment line ${line}`);
  }
  await editor(page).press('Control+End');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const selection = getSelection();
        if (!selection?.rangeCount) return false;
        const node = selection.focusNode;
        const element = node instanceof Element ? node : node?.parentElement;
        const caret = element?.closest('[data-content-type]')?.getBoundingClientRect();
        const dock = document.querySelector('[data-task-drawer]')?.getBoundingClientRect();
        return !!caret && !!dock && caret.bottom > 0 && caret.bottom <= dock.top;
      }),
    )
    .toBe(true);
  const post = page.getByRole('button', { name: 'Post comment', exact: true });
  if (phone) {
    await expect
      .poll(async () => {
        const button = (await post.boundingBox())!;
        const dock = (await page.locator('[data-task-drawer]').boundingBox())!;
        return button.y >= 0 && button.y + button.height <= dock.y;
      })
      .toBe(true);
  }
  await post.scrollIntoViewIfNeeded();
  if (phone)
    expect((await post.boundingBox())!.y + (await post.boundingBox())!.height).toBeLessThan(
      page.viewportSize()!.height - 300,
    );
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    const path = testInfo.outputPath(`history-keyboard-${colorScheme}.png`);
    await page.screenshot({ path });
    await testInfo.attach(colorScheme, { path, contentType: 'image/png' });
  }
  await post.click();
  await expect(f.history).toContainText('Comment line 24');
});
