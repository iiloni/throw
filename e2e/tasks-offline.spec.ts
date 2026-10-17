import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { APP_LOAD_TIMEOUT, shapeRows, signUp } from './helpers';

// This exercises chained conflicts through the app's own actions; board.spec.ts covers UI
// creation offline. The dev server serves each module at its source path, which the app imported too,
// so `import()` here returns the same module, with the same collections and outbox.

const json = { 'Content-Type': 'application/json' };

/** The task as this device holds it, or null. */
const localTask = (page: Page, id: string) =>
  page.evaluate(async (id) => {
    const { tasksCollection } = await import(/* @vite-ignore */ '/src/lib/collections.ts');
    return (tasksCollection.get(id) ?? null) as {
      number: number | null;
      title: string;
      statusId: string;
      priority: number;
    } | null;
  }, id);

test('a task created and edited offline syncs correctly beside another device’s change', async ({
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
      return createProject(workspaceId, 'Offline work', undefined, 'OFF') as string;
    },
    { workspaceId },
  );
  await expect
    .poll(async () => (await shapeRows(page.request, 'projects', account.headers))[0]?.key)
    .toBe('OFF');
  await expect
    .poll(async () => (await shapeRows(page.request, 'statuses', account.headers)).length)
    .toBe(4);

  // A task made online, which both devices then change.
  const shared = await page.evaluate(
    async ({ projectId }) => {
      const { createTask } = await import(/* @vite-ignore */ '/src/lib/tasks.ts');
      return createTask(projectId, { title: 'Shared' }) as string;
    },
    { projectId },
  );
  await expect.poll(async () => (await localTask(page, shared))?.number).toBe(1);

  await page.route('**/api/**', (route) => route.abort('connectionfailed'));
  const active = await page.evaluate(
    async ({ projectId }) => {
      const { statusesCollection } = await import(/* @vite-ignore */ '/src/lib/collections.ts');
      return [...statusesCollection.values()].find(
        (status: { projectId: string; category: string }) =>
          status.projectId === projectId && status.category === 'active',
      ).id as string;
    },
    { projectId },
  );
  const document = [{ type: 'paragraph', content: [{ type: 'text', text: 'Written offline' }] }];
  const created = await page.evaluate(
    async ({ projectId, shared, active, document }) => {
      const tasks = await import(/* @vite-ignore */ '/src/lib/tasks.ts');
      const id: string = tasks.createTask(projectId, { title: 'Made offline' });
      tasks.updateTask(id, { title: 'Made and renamed offline' });
      tasks.moveTask(id, { statusId: active, priority: 1, position: 'a5' });
      tasks.updateTask(shared, { title: 'Offline title', priority: 2 });
      tasks.saveDescription(shared, document);
      return id;
    },
    { projectId, shared, active, document },
  );
  // Until it syncs, a task made offline has no number and so no identifier.
  expect(await localTask(page, created)).toMatchObject({
    number: null,
    title: 'Made and renamed offline',
  });
  await expect(page.getByRole('status')).toContainText('unsaved', { timeout: 40_000 });

  // The queue outlives a reload.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Offline work', {
    timeout: APP_LOAD_TIMEOUT,
  });
  await expect
    .poll(() => localTask(page, created))
    .toMatchObject({ title: 'Made and renamed offline', statusId: active, priority: 1 });

  // Meanwhile another device renames the shared task.
  const other = await page.request.patch(`/api/tasks/${shared}`, {
    headers: { ...json, ...account.headers },
    data: {
      changeId: randomUUID(),
      changes: { title: { before: 'Shared', after: 'Renamed on another device' } },
    },
  });
  expect(other.ok()).toBeTruthy();

  await page.evaluate(async () => {
    const { onRefusedChanges } = await import(/* @vite-ignore */ '/src/lib/refusedChanges.ts');
    const heard: unknown[] = [];
    Object.assign(window, { heardRefusals: heard });
    onRefusedChanges((taskId: string, refused: unknown) => heard.push({ taskId, refused }));
  });
  await page.unroute('**/api/**');

  // The other device's title stands; this device's priority and description, which nobody else
  // changed, are applied; the task made offline arrives whole, with the next number.
  await expect
    .poll(
      async () =>
        (await shapeRows(page.request, 'tasks', account.headers))
          .map((row) => ({
            id: row.id,
            number: row.number,
            title: row.title,
            status: row.status_id,
            priority: row.priority,
            position: row.position,
            description: row.description === null ? null : JSON.parse(String(row.description)),
          }))
          .sort((a, b) => Number(a.number) - Number(b.number)),
      { timeout: 60_000 },
    )
    .toEqual([
      {
        id: shared,
        number: '1',
        title: 'Renamed on another device',
        status: expect.any(String),
        priority: '2',
        position: expect.any(String),
        description: document,
      },
      {
        id: created,
        number: '2',
        title: 'Made and renamed offline',
        status: active,
        priority: '1',
        position: 'a5',
        description: null,
      },
    ]);
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { heardRefusals: unknown[] }).heardRefusals),
    )
    .toEqual([{ taskId: shared, refused: [{ field: 'title', reason: 'stale' }] }]);
  // The device ends with the server's rows.
  await expect
    .poll(async () => {
      const [a, b] = [await localTask(page, shared), await localTask(page, created)];
      return [a?.title, b?.number];
    })
    .toEqual(['Renamed on another device', 2]);
  await expect(page.getByRole('status')).toHaveCount(0);
});
