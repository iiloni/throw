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
  await expect(page.getByRole('status').filter({ hasText: 'unsaved' })).toBeVisible({
    timeout: 40_000,
  });
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

for (const mode of ['update', 'create'] as const) {
  test(`late secondary ${mode} after another device deletes the tag leaves no optimistic assignment`, async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Sync behavior is independent of layout; the workshop covers touch.');
    test.setTimeout(120_000);
    const account = await signUp(page);
    const { newTag, taggedTask, tagProject } = await import('./tag-helpers');
    const project = await tagProject(page.request, account);
    const gone = await newTag(page.request, account, project.id, { name: 'Deleted elsewhere' });
    const kept = await newTag(page.request, account, project.id, { name: 'Keep' });
    const task = await taggedTask(page.request, account, project.id);
    await expect
      .poll(() =>
        page.evaluate(
          async ({ taskId, projectId, goneId, keptId }) => {
            const c = await import(/* @vite-ignore */ '/src/lib/collections.ts');
            // The offline create reads the project and its statuses, which stream separately.
            return (
              c.projectsCollection.has(projectId) &&
              [...c.statusesCollection.values()].some(
                (status) =>
                  status.projectId === projectId &&
                  status.category === 'backlog' &&
                  status.isDefault,
              ) &&
              c.tasksCollection.has(taskId) &&
              c.tagsCollection.has(goneId) &&
              c.tagsCollection.has(keptId) &&
              c.taskTagsCollection.isReady()
            );
          },
          { taskId: task.id, projectId: project.id, goneId: gone.id, keptId: kept.id },
        ),
      )
      .toBe(true);
    await page.evaluate(async () => {
      await import(/* @vite-ignore */ '/src/lib/tags.ts');
      await import(/* @vite-ignore */ '/src/lib/tasks.ts');
    });
    await page.route('**/api/**', (route) => route.abort('connectionfailed'));
    const createdId = await page.evaluate(
      async ({ taskId, projectId, goneId, keptId, mode }) => {
        const { setSecondaryTag } = await import(/* @vite-ignore */ '/src/lib/tags.ts');
        const { createTask } = await import(/* @vite-ignore */ '/src/lib/tasks.ts');
        if (mode === 'update') {
          setSecondaryTag(taskId, goneId, true);
          return taskId;
        }
        return createTask(projectId, { title: 'Keep the task', secondaryTagIds: [goneId, keptId] });
      },
      { taskId: task.id, projectId: project.id, goneId: gone.id, keptId: kept.id, mode },
    );
    await expect(page.getByRole('status').filter({ hasText: 'unsaved' })).toBeVisible({
      timeout: 40_000,
    });
    expect(
      (await page.request.delete(`/api/tags/${gone.id}`, { headers: account.headers })).status(),
    ).toBe(200);
    const sent = page.waitForResponse((response) =>
      mode === 'update'
        ? response.request().method() === 'PATCH' &&
          response.url().endsWith(`/api/tasks/${task.id}`)
        : response.request().method() === 'POST' && response.url().endsWith('/api/tasks'),
    );
    await page.unroute('**/api/**');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    const response = await sent;
    expect(response.status()).toBe(mode === 'update' ? 200 : 201);
    if (mode === 'update')
      expect(await response.json()).toEqual({
        txid: null,
        refused: [{ field: 'secondaryTags', tagId: gone.id, reason: 'invalid' }],
      });
    await expect
      .poll(
        async () =>
          (await shapeRows(page.request, 'tasks', account.headers)).some(
            (row) => row.id === createdId,
          ),
        { timeout: 90_000 },
      )
      .toBe(true);
    await expect(page.getByRole('status')).toHaveCount(0, { timeout: 40_000 });
    const expected = mode === 'create' ? [{ taskId: createdId, tagId: kept.id }] : [];
    const localAssignments = () =>
      page.evaluate(async () => {
        const c = await import(/* @vite-ignore */ '/src/lib/collections.ts');
        return [...c.taskTagsCollection.values()].map(
          ({ taskId, tagId }: { taskId: string; tagId: string }) => ({ taskId, tagId }),
        );
      });
    await expect.poll(localAssignments).toEqual(expected);
    await page.reload();
    await expect.poll(localAssignments, { timeout: APP_LOAD_TIMEOUT }).toEqual(expected);
  });
}

for (const scope of ['task', 'project'] as const) {
  test(`${scope} purge waits for delayed tag shapes before handing off optimistic deletes`, async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Shape hand-over is independent of layout.');
    const account = await signUp(page);
    const { newTag, taggedTask, tagProject } = await import('./tag-helpers');
    const project = await tagProject(page.request, account);
    const tag = await newTag(page.request, account, project.id);
    const task = await taggedTask(page.request, account, project.id, { secondaryTagIds: [tag.id] });
    await expect
      .poll(() =>
        page.evaluate(
          async ({ taskId, tagId }) => {
            const c = await import(/* @vite-ignore */ '/src/lib/collections.ts');
            return (
              c.tagsCollection.has(tagId) &&
              c.tasksCollection.has(taskId) &&
              c.taskTagsCollection.has(`${taskId}/${tagId}`)
            );
          },
          { taskId: task.id, tagId: tag.id },
        ),
      )
      .toBe(true);
    const path = scope === 'project' ? `/api/projects/${project.id}` : `/api/tasks/${task.id}`;
    const data =
      scope === 'project'
        ? { trashed: true }
        : {
            changeId: randomUUID(),
            changes: { trashed: { before: false, after: true } },
          };
    expect((await page.request.patch(path, { headers: account.headers, data })).status()).toBe(200);
    await expect
      .poll(() =>
        page.evaluate(
          async ({ scope, projectId, taskId }) => {
            const c = await import(/* @vite-ignore */ '/src/lib/collections.ts');
            return (
              (scope === 'project'
                ? c.projectsCollection.get(projectId)
                : c.tasksCollection.get(taskId)
              )?.deletedAt != null
            );
          },
          { scope, projectId: project.id, taskId: task.id },
        ),
      )
      .toBe(true);
    let releaseAssignments = () => {};
    const assignmentsGate = new Promise<void>((resolve) => {
      releaseAssignments = resolve;
    });
    let releaseTags = () => {};
    const tagsGate = new Promise<void>((resolve) => {
      releaseTags = resolve;
    });
    const blocked = new Set<string>();
    await page.route('**/api/shapes/task-tags?**', async (route) => {
      blocked.add('assignments');
      await assignmentsGate;
      await route.continue();
    });
    if (scope === 'project')
      await page.route('**/api/shapes/tags?**', async (route) => {
        blocked.add('tags');
        await tagsGate;
        await route.continue();
      });
    await expect.poll(() => blocked.size).toBe(scope === 'project' ? 2 : 1);
    try {
      const responsePromise = page.waitForResponse(
        (response) => response.request().method() === 'DELETE' && response.url().endsWith(path),
      );
      const transactionId = await page.evaluate(
        async ({ scope, projectId, taskId }) => {
          const c = await import(/* @vite-ignore */ '/src/lib/collections.ts');
          const p = await import(/* @vite-ignore */ '/src/lib/projects.ts');
          return c.write(() =>
            scope === 'project' ? p.deleteProjectRows(projectId) : p.deleteTaskRows(taskId),
          ).id;
        },
        { scope, projectId: project.id, taskId: task.id },
      );
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      const { txid } = await response.json();
      await page.evaluate(async (txid) => {
        const c = await import(/* @vite-ignore */ '/src/lib/collections.ts');
        await c.tasksCollection.utils.awaitTxId(txid);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, txid);
      const handoverState = () =>
        page.evaluate(async (transactionId) => {
          const c = await import(/* @vite-ignore */ '/src/lib/collections.ts');
          return c.taskTagsCollection._state.transactions.get(transactionId)?.state;
        }, transactionId);
      expect(await handoverState()).toBe('persisting');
      if (scope === 'project') {
        releaseTags();
        await page.evaluate(async (txid) => {
          const c = await import(/* @vite-ignore */ '/src/lib/collections.ts');
          await c.tagsCollection.utils.awaitTxId(txid);
        }, txid);
        expect(await handoverState()).toBe('persisting');
      }
      releaseAssignments();
      await expect.poll(handoverState).toBeUndefined();
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const c = await import(/* @vite-ignore */ '/src/lib/collections.ts');
            return c.taskTagsCollection.size;
          }),
        )
        .toBe(0);
    } finally {
      releaseTags();
      releaseAssignments();
    }
  });
}
