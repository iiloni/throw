import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { APP_LOAD_TIMEOUT, shapeRows, signUp } from './helpers';

// As in `tasks-offline.spec.ts`, this drives the app's own actions in the page: the timeline
// view is not built yet. The dev server serves each module at its source path, so `import()`
// returns the modules the app runs, with the same collections and outbox.

const json = { 'Content-Type': 'application/json' };
const text = (value: string) => [{ type: 'paragraph', content: [{ type: 'text', text: value }] }];

interface Item {
  type: 'entry' | 'comment';
  id: string;
  pending?: boolean;
  comment?: { body: unknown; createdAt: string | null; editedAt: string | null };
  entry?: { kind: string; changes: { field: string; applied: boolean; reason?: string }[] };
}

/** The task's timeline as this device holds it. */
const localTimeline = (page: Page, taskId: string) =>
  page.evaluate(async (taskId) => {
    const { readTaskTimeline } = await import(/* @vite-ignore */ '/src/lib/collections.ts');
    return readTaskTimeline(taskId) as Item[];
  }, taskId);

/** What the timeline shows: each item's id, and a comment's text or an entry's fields. */
const summary = (items: Item[]) =>
  items.map((item) =>
    item.type === 'comment'
      ? { id: item.id, pending: item.pending, body: item.comment?.body }
      : {
          id: item.id,
          fields: item.entry?.changes.map(
            (change) => `${change.field}:${change.applied ? 'applied' : change.reason}`,
          ),
        },
  );

test('comments and task edits made offline join the timeline in the server’s order', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(120_000);
  test.skip(isMobile, 'The outbox does not depend on the layout.');
  const account = await signUp(page);
  const [workspace] = await shapeRows(page.request, 'workspaces', account.headers);
  const workspaceId = String(workspace?.id);

  const projectId = await page.evaluate(
    async ({ workspaceId }) => {
      const { createProject } = await import(/* @vite-ignore */ '/src/lib/projects.ts');
      return createProject(workspaceId, 'Timeline', undefined, 'TL') as string;
    },
    { workspaceId },
  );
  await expect
    .poll(async () => (await shapeRows(page.request, 'statuses', account.headers)).length)
    .toBe(4);

  // Online: a task with two comments, all on the device before it goes offline.
  const taskId = await page.evaluate(
    async ({ projectId }) => {
      const { createTask } = await import(/* @vite-ignore */ '/src/lib/tasks.ts');
      return createTask(projectId, { title: 'Shared' }) as string;
    },
    { projectId },
  );
  const [kept, removed] = await page.evaluate(
    async ({ taskId, first, second }) => {
      const { addComment } = await import(/* @vite-ignore */ '/src/lib/comments.ts');
      return [addComment(taskId, first), addComment(taskId, second)] as string[];
    },
    { taskId, first: text('Kept'), second: text('Removed offline') },
  );
  await expect
    .poll(async () => summary(await localTimeline(page, taskId)), { timeout: 30_000 })
    .toEqual([
      { id: taskId, fields: ['title:applied', 'statusId:applied', 'priority:applied'] },
      { id: kept, pending: false, body: text('Kept') },
      { id: removed, pending: false, body: text('Removed offline') },
    ]);

  await page.route('**/api/**', (route) => route.abort('connectionfailed'));
  const offline = await page.evaluate(
    async ({ taskId, kept, removed, bodies }) => {
      const comments = await import(/* @vite-ignore */ '/src/lib/comments.ts');
      const tasks = await import(/* @vite-ignore */ '/src/lib/tasks.ts');
      const first = comments.addComment(taskId, bodies.first);
      tasks.updateTask(taskId, { title: 'Offline title', priority: 1 });
      comments.editComment(kept, bodies.keptEdited);
      const second = comments.addComment(taskId, bodies.draft);
      comments.editComment(second, bodies.second);
      comments.deleteComment(removed);
      const discarded = comments.addComment(taskId, bodies.discarded);
      comments.deleteComment(discarded);
      return { first, second } as { first: string; second: string };
    },
    {
      taskId,
      kept,
      removed,
      bodies: {
        first: text('Written offline'),
        keptEdited: text('Kept, edited offline'),
        draft: text('Draft'),
        second: text('Written and edited offline'),
        discarded: text('Gone before it was sent'),
      },
    },
  );
  // Until they sync, offline comments come last, in the order they were written, and the
  // offline task edit has no entry yet: the server writes entries.
  const whileOffline = [
    { id: taskId, fields: ['title:applied', 'statusId:applied', 'priority:applied'] },
    { id: kept, pending: false, body: text('Kept, edited offline') },
    { id: offline.first, pending: true, body: text('Written offline') },
    { id: offline.second, pending: true, body: text('Written and edited offline') },
  ];
  expect(summary(await localTimeline(page, taskId))).toEqual(whileOffline);
  await expect(page.getByRole('status')).toContainText('unsaved', { timeout: 40_000 });

  // The queue and the timeline outlive a reload.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Timeline', {
    timeout: APP_LOAD_TIMEOUT,
  });
  await expect.poll(async () => summary(await localTimeline(page, taskId))).toEqual(whileOffline);

  // Meanwhile another device renames the task, comments, and edits the comment this device
  // edited offline.
  const renamed = randomUUID();
  const rename = await page.request.patch(`/api/tasks/${taskId}`, {
    headers: { ...json, ...account.headers },
    data: {
      changeId: renamed,
      changes: { title: { before: 'Shared', after: 'Renamed elsewhere' } },
    },
  });
  expect(rename.ok()).toBeTruthy();
  const elsewhere = randomUUID();
  const otherComment = await page.request.post('/api/comments', {
    headers: { ...json, ...account.headers },
    data: { id: elsewhere, taskId, body: text('From another device') },
  });
  expect(otherComment.status()).toBe(201);
  const otherEdit = await page.request.patch(`/api/comments/${kept}`, {
    headers: { ...json, ...account.headers },
    data: { body: text('Kept, edited elsewhere') },
  });
  expect(otherEdit.ok()).toBeTruthy();

  await page.evaluate(async () => {
    const { onRefusedChanges } = await import(/* @vite-ignore */ '/src/lib/refusedChanges.ts');
    const heard: string[] = [];
    Object.assign(window, { refusedChangeIds: heard });
    onRefusedChanges((_taskId: string, _refused: unknown, changeId: string) =>
      heard.push(changeId),
    );
  });
  await page.unroute('**/api/**');

  // The server dates everything this device sent after the other device's writes. The offline
  // title loses to the rename and the priority applies; the comment edit that arrived last
  // stands; the comment deleted offline is gone; the one written and deleted offline never
  // shows.
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { refusedChangeIds: string[] }).refusedChangeIds),
    )
    .toHaveLength(1);
  // A refusal names the entry that records it.
  const [refusal] = await page.evaluate(
    () => (window as unknown as { refusedChangeIds: string[] }).refusedChangeIds,
  );
  const synced = [
    { id: taskId, fields: ['title:applied', 'statusId:applied', 'priority:applied'] },
    { id: kept, pending: false, body: text('Kept, edited offline') },
    { id: renamed, fields: ['title:applied'] },
    { id: elsewhere, pending: false, body: text('From another device') },
    { id: offline.first, pending: false, body: text('Written offline') },
    { id: refusal, fields: ['title:stale', 'priority:applied'] },
    { id: offline.second, pending: false, body: text('Written and edited offline') },
  ];
  await expect
    .poll(async () => summary(await localTimeline(page, taskId)), { timeout: 60_000 })
    .toEqual(synced);
  await expect(page.getByRole('status')).toHaveCount(0);

  // The device ends with the server's rows and times.
  const serverComments = await shapeRows(page.request, 'comments', account.headers);
  const serverEntries = await shapeRows(page.request, 'task_activity', account.headers);
  expect(serverComments.map((row) => row.id).sort()).toEqual(
    [kept, elsewhere, offline.first, offline.second].sort(),
  );
  expect(serverEntries).toHaveLength(3);
  const timeline = await localTimeline(page, taskId);
  for (const item of timeline) {
    if (item.type === 'comment') expect(item.comment?.createdAt).toEqual(expect.any(String));
  }
  expect(timeline.find((item) => item.id === offline.second)?.comment?.editedAt).toEqual(
    expect.any(String),
  );
});
