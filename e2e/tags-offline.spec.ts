import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { APP_LOAD_TIMEOUT, shapeRows, signUp } from './helpers';
import { tagTaskUpdate } from './tag-helpers';

test('offline tag creation and assignments survive reload and sync beside another device', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(150_000);
  test.skip(isMobile, 'The same outbox is exercised by the UI test in both layouts.');
  const account = await signUp(page);
  const [workspace] = await shapeRows(page.request, 'workspaces', account.headers);
  const projectId: string = await page.evaluate(async (workspaceId) => {
    const { createProject } = await import(/* @vite-ignore */ '/src/lib/projects.ts');
    return createProject(workspaceId, 'Offline tags');
  }, String(workspace?.id));
  await expect
    .poll(async () => (await shapeRows(page.request, 'statuses', account.headers)).length)
    .toBe(4);
  const online = await page.evaluate(async (projectId) => {
    const tags = await import(/* @vite-ignore */ '/src/lib/tags.ts');
    const { createTask } = await import(/* @vite-ignore */ '/src/lib/tasks.ts');
    const a: string = tags.createTag(projectId, { name: 'Already here', color: 'teal' });
    const b: string = tags.createTag(projectId, { name: 'Other device', color: 'amber' });
    const taskId: string = createTask(projectId, { title: 'Shared' });
    return { a, b, taskId };
  }, projectId);
  await expect
    .poll(async () => (await shapeRows(page.request, 'tags', account.headers)).length)
    .toBe(2);
  await expect
    .poll(async () => (await shapeRows(page.request, 'tasks', account.headers)).length)
    .toBe(1);
  // Even without a tag screen open, both shapes are running and available before offline.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const c = await import(/* @vite-ignore */ '/src/lib/collections.ts');
        return (
          c.tagsCollection.isReady() &&
          c.taskTagsCollection.isReady() &&
          c.tasksCollection.isReady()
        );
      }),
    )
    .toBe(true);
  await page.route('**/api/**', (route) => route.abort('connectionfailed'));
  const offline = await page.evaluate(
    async ({ projectId, online }) => {
      const tags = await import(/* @vite-ignore */ '/src/lib/tags.ts');
      const { createTask } = await import(/* @vite-ignore */ '/src/lib/tasks.ts');
      const root: string = tags.createTag(projectId, { name: 'Offline root', color: 'blue' });
      const child: string = tags.createTag(projectId, { name: 'Offline child', parentId: root });
      const taskId: string = createTask(projectId, {
        title: 'Made offline',
        primaryTagId: child,
        secondaryTagIds: [root, online.a],
      });
      tags.setPrimaryTag(online.taskId, child);
      tags.setSecondaryTag(online.taskId, online.a, true);
      return { root, child, taskId };
    },
    { projectId, online },
  );
  await expect(page.getByRole('status')).toContainText('unsaved', { timeout: 40_000 });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Offline tags', {
    timeout: APP_LOAD_TIMEOUT,
  });
  await expect
    .poll(() =>
      page.evaluate(async ({ child, taskId }) => {
        const c = await import(/* @vite-ignore */ '/src/lib/collections.ts');
        return {
          tag: c.tagsCollection.get(child)?.name,
          primary: c.tasksCollection.get(taskId)?.primaryTagId,
          secondary: [...c.taskTagsCollection.values()].filter(
            (row: { taskId: string }) => row.taskId === taskId,
          ).length,
        };
      }, offline),
    )
    .toEqual({ tag: 'Offline child', primary: offline.child, secondary: 2 });
  // Another device has assigned a different secondary and primary while this one was offline.
  await tagTaskUpdate(
    page.request,
    account,
    online.taskId,
    {
      primaryTagId: { before: null, after: online.b },
      secondaryTags: [{ tagId: online.b, present: true }],
    },
    randomUUID(),
  );
  await page.unroute('**/api/**');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect
    .poll(async () => (await shapeRows(page.request, 'tags', account.headers)).length, {
      timeout: 90_000,
    })
    .toBe(4);
  await expect
    .poll(
      async () =>
        (await shapeRows(page.request, 'tasks', account.headers)).find(
          (row) => row.id === offline.taskId,
        ),
      { timeout: 90_000 },
    )
    .toMatchObject({ primary_tag_id: offline.child, number: '2' });
  await expect
    .poll(
      async () =>
        (await shapeRows(page.request, 'task-tags', account.headers))
          .filter((row) => row.task_id === online.taskId)
          .map((row) => row.tag_id)
          .sort(),
      { timeout: 90_000 },
    )
    .toEqual([online.a, online.b].sort());
  await expect
    .poll(async () =>
      (await shapeRows(page.request, 'task-tags', account.headers))
        .filter((row) => row.task_id === offline.taskId)
        .map((row) => row.tag_id)
        .sort(),
    )
    .toEqual([offline.root, online.a].sort());
  await expect
    .poll(
      () =>
        page.evaluate(async ({ taskId, b }) => {
          const c = await import(/* @vite-ignore */ '/src/lib/collections.ts');
          return (
            c.tasksCollection.get(taskId)?.primaryTagId === b &&
            [...c.taskTagsCollection.values()].filter(
              (row: { taskId: string }) => row.taskId === taskId,
            ).length === 2
          );
        }, online),
      { timeout: 40_000 },
    )
    .toBe(true);
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 40_000 });
});
