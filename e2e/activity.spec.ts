import { randomUUID } from 'node:crypto';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { createAccount, shapeRows } from './helpers';

// The activity log and comments through their routes and shapes, without a browser
// (docs/data-model.md, "Activity entry" and "Comment").

const json = { 'Content-Type': 'application/json' };
type Account = Awaited<ReturnType<typeof createAccount>>;

const CATEGORIES = ['backlog', 'active', 'done', 'cancelled'] as const;
/** A `jsonb` value from a raw shape message, which holds it as a JSON string. */
const parsed = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value);
const text = (value: string) => [{ type: 'paragraph', content: [{ type: 'text', text: value }] }];

async function createProject(request: APIRequestContext, account: Account) {
  const [workspace] = await shapeRows(request, 'workspaces', account.headers);
  const statuses = Object.fromEntries(CATEGORIES.map((category) => [category, randomUUID()]));
  const project = {
    id: randomUUID(),
    workspaceId: String(workspace?.id),
    name: 'Project',
    color: 'teal',
    icon: null,
    position: 'a0',
    key: 'LOG',
    statuses: CATEGORIES.map((category) => ({
      id: statuses[category],
      name: { backlog: 'Backlog', active: 'Doing', done: 'Done', cancelled: 'Dropped' }[category],
      category,
      position: 'a0',
      isDefault: true,
    })),
  };
  const response = await request.post('/api/projects', {
    headers: { ...json, ...account.headers },
    data: project,
  });
  expect(response.status()).toBe(201);
  return { ...project, statuses: statuses as Record<(typeof CATEGORIES)[number], string> };
}

async function createTask(
  request: APIRequestContext,
  account: Account,
  task: { projectId: string } & Record<string, unknown>,
) {
  const id = randomUUID();
  const response = await request.post('/api/tasks', {
    headers: { ...json, ...account.headers },
    data: {
      id,
      title: 'Task',
      description: null,
      descriptionVersion: null,
      position: 'a0',
      parentId: null,
      ...task,
    },
  });
  expect(response.status()).toBe(201);
  return id;
}

async function updateTask(
  request: APIRequestContext,
  account: Account,
  id: string,
  changes: Record<string, unknown>,
  changeId: string = randomUUID(),
) {
  const response = await request.patch(`/api/tasks/${id}`, {
    headers: { ...json, ...account.headers },
    data: { changeId, changes },
  });
  expect(response.status()).toBe(200);
  return changeId;
}

const comment = (request: APIRequestContext, account: Account) => ({
  create: (data: { id: string; taskId: string; body: unknown }) =>
    request.post('/api/comments', { headers: { ...json, ...account.headers }, data }),
  edit: (id: string, body: unknown) =>
    request.patch(`/api/comments/${id}`, {
      headers: { ...json, ...account.headers },
      data: { body },
    }),
  remove: (id: string) => request.delete(`/api/comments/${id}`, { headers: account.headers }),
});

/** A task's entries as the shape holds them, oldest first, with `changes` parsed. */
async function entries(request: APIRequestContext, account: Account, taskId: string) {
  return (await shapeRows(request, 'task_activity', account.headers))
    .filter((row) => row.task_id === taskId)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      changes: parsed(row.changes),
    }));
}

test('the log and comments are visible and writable only to members of their workspace @api', async ({
  request,
}) => {
  const owner = await createAccount(request);
  const stranger = await createAccount(request);
  const project = await createProject(request, owner);
  const taskId = await createTask(request, owner, { projectId: project.id, title: 'Private' });
  const commentId = randomUUID();
  expect(
    (await comment(request, owner).create({ id: commentId, taskId, body: text('Mine') })).status(),
  ).toBe(201);

  const theirs = comment(request, stranger);
  expect(
    (await theirs.create({ id: randomUUID(), taskId, body: text('Intruding') })).status(),
    'a comment on a task the user cannot reach',
  ).toBe(404);
  expect((await theirs.edit(commentId, text('Taken over'))).status()).toBe(404);
  expect(await (await theirs.remove(commentId)).json()).toEqual({ txid: null });
  // A comment id another workspace uses cannot be taken.
  const strangerProject = await createProject(request, stranger);
  const strangerTask = await createTask(request, stranger, { projectId: strangerProject.id });
  expect(
    (await theirs.create({ id: commentId, taskId: strangerTask, body: text('Clash') })).status(),
  ).toBe(409);

  const strangerEntries = await shapeRows(request, 'task_activity', stranger.headers);
  expect(strangerEntries.map((row) => row.task_id)).toEqual([strangerTask]);
  await expect.poll(async () => await shapeRows(request, 'comments', stranger.headers)).toEqual([]);

  const [entry] = await shapeRows(request, 'task_activity', owner.headers);
  expect(Object.keys(entry ?? {}).sort()).toEqual(
    [
      'changes',
      'created_at',
      'id',
      'kind',
      'project_id',
      'task_id',
      'user_id',
      'workspace_id',
    ].sort(),
  );
  expect(entry).toMatchObject({ id: taskId, user_id: owner.user.id, kind: 'created' });
  await expect
    .poll(async () =>
      (await shapeRows(request, 'comments', owner.headers)).map((row) => ({
        ...row,
        body: parsed(row.body),
      })),
    )
    .toEqual([
      {
        id: commentId,
        workspace_id: project.workspaceId,
        project_id: project.id,
        task_id: taskId,
        user_id: owner.user.id,
        body: text('Mine'),
        created_at: expect.any(String),
        edited_at: null,
      },
    ]);
});

test('comments are created, edited and deleted once, however often a write is resent @api', async ({
  request,
}) => {
  const owner = await createAccount(request);
  const project = await createProject(request, owner);
  const taskId = await createTask(request, owner, { projectId: project.id });
  const comments = comment(request, owner);
  const id = randomUUID();
  const row = async () =>
    (await shapeRows(request, 'comments', owner.headers)).find((row) => row.id === id);

  const created = await comments.create({ id, taskId, body: text('First') });
  expect(created.status()).toBe(201);
  expect((await created.json()).txid).toEqual(expect.any(Number));
  const replay = await comments.create({ id, taskId, body: text('First') });
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toEqual({ txid: null });
  await expect.poll(async () => (await row())?.edited_at).toBeNull();

  const edit = await comments.edit(id, text('Second'));
  expect((await edit.json()).txid).toEqual(expect.any(Number));
  await expect.poll(async () => parsed((await row())?.body)).toEqual(text('Second'));
  const editedAt = (await row())?.edited_at;
  expect(editedAt).toEqual(expect.any(String));
  // A resent edit changes nothing, so there is nothing for the client to wait for.
  expect(await (await comments.edit(id, text('Second'))).json()).toEqual({ txid: null });
  // Edits apply in the order they arrive.
  await comments.edit(id, text('Third'));
  await comments.edit(id, text('Fourth'));
  await expect.poll(async () => parsed((await row())?.body)).toEqual(text('Fourth'));
  expect((await comments.edit(id, [])).status(), 'an empty document').toBe(400);

  const removal = await comments.remove(id);
  expect((await removal.json()).txid).toEqual(expect.any(Number));
  expect(await (await comments.remove(id)).json()).toEqual({ txid: null });
  await expect.poll(async () => await row()).toBeUndefined();
  expect((await comments.edit(id, text('Late'))).status(), 'an edit after a delete').toBe(404);

  // A comment queued for a task purged meanwhile is dropped; purging takes a task's comments.
  const kept = randomUUID();
  await comments.create({ id: kept, taskId, body: text('Kept until the purge') });
  await updateTask(request, owner, taskId, { trashed: { before: false, after: true } });
  expect(
    (await comments.create({ id: randomUUID(), taskId, body: text('On a trashed task') })).status(),
    'a task in the trash takes comments',
  ).toBe(201);
  const purge = await request.delete(`/api/tasks/${taskId}`, { headers: owner.headers });
  expect((await purge.json()).txid).toEqual(expect.any(Number));
  expect((await comments.create({ id: randomUUID(), taskId, body: text('Late') })).status()).toBe(
    404,
  );
  await expect.poll(async () => await shapeRows(request, 'comments', owner.headers)).toEqual([]);
  await expect
    .poll(async () => await shapeRows(request, 'task_activity', owner.headers))
    .toEqual([]);
});

test('each kind of task write produces its entry, and reorders stay on the server @api', async ({
  request,
}) => {
  const owner = await createAccount(request);
  const project = await createProject(request, owner);
  const { backlog, active, done } = project.statuses;

  // A create whose status was deleted lands in the backlog default, and says so.
  const id = await createTask(request, owner, {
    projectId: project.id,
    title: 'Logged',
    statusId: randomUUID(),
    description: text('Start'),
    descriptionVersion: randomUUID(),
  });
  const parent = await createTask(request, owner, { projectId: project.id, title: 'Parent' });

  const applied = await updateTask(request, owner, id, {
    title: { before: 'Logged', after: 'Renamed' },
    statusId: { before: backlog, after: active },
    priority: { before: 3, after: 1 },
    position: { after: 'a5', statusId: active, priority: 1, parentId: null },
  });
  const stale = await updateTask(request, owner, id, {
    title: { before: 'Logged', after: 'Stale' },
    statusId: { before: active, after: randomUUID() },
    description: { before: randomUUID(), after: { version: randomUUID(), document: text('Lost') } },
  });
  // Only a reorder: kept for its change id, so a resend arriving after a later reorder is
  // recognised and does not move the task back.
  const reorder = { position: { after: 'a7', statusId: active, priority: 1, parentId: null } };
  const reorderId = await updateTask(request, owner, id, reorder);
  await updateTask(request, owner, id, {
    position: { after: 'a9', statusId: active, priority: 1, parentId: null },
  });
  const resent = await request.patch(`/api/tasks/${id}`, {
    headers: { ...json, ...owner.headers },
    data: { changeId: reorderId, changes: reorder },
  });
  expect(await resent.json()).toEqual({ txid: null, refused: [] });
  await expect
    .poll(async () =>
      (await shapeRows(request, 'tasks', owner.headers)).find((row) => row.id === id),
    )
    .toMatchObject({ position: 'a9' });
  const moves = await updateTask(request, owner, id, {
    parentId: { before: null, after: parent },
    statusId: { before: active, after: done },
  });
  const trashed = await updateTask(request, owner, id, { trashed: { before: false, after: true } });
  const restored = await updateTask(request, owner, id, {
    trashed: { before: true, after: false },
  });

  await expect.poll(async () => (await entries(request, owner, id)).length).toBe(6);
  expect(await entries(request, owner, id)).toEqual([
    {
      id,
      kind: 'created',
      changes: [
        { field: 'title', previous: null, requested: 'Logged', applied: true },
        {
          field: 'statusId',
          previous: null,
          requested: backlog,
          requestedName: 'Backlog',
          applied: true,
          reason: 'replaced',
        },
        { field: 'priority', previous: null, requested: 3, applied: true },
        { field: 'description', previous: null, requested: expect.any(String), applied: true },
      ],
    },
    {
      id: applied,
      kind: 'updated',
      changes: [
        { field: 'title', previous: 'Logged', requested: 'Renamed', applied: true },
        {
          field: 'statusId',
          previous: backlog,
          requested: active,
          previousName: 'Backlog',
          requestedName: 'Doing',
          applied: true,
        },
        { field: 'priority', previous: 3, requested: 1, applied: true },
      ],
    },
    {
      id: stale,
      kind: 'updated',
      changes: [
        {
          field: 'title',
          previous: 'Renamed',
          requested: 'Stale',
          applied: false,
          reason: 'stale',
        },
        {
          field: 'description',
          previous: expect.any(String),
          requested: expect.any(String),
          applied: false,
          reason: 'stale',
          rejectedDocument: text('Lost'),
        },
        {
          field: 'statusId',
          previous: active,
          requested: expect.any(String),
          previousName: 'Doing',
          requestedName: null,
          applied: false,
          reason: 'invalid',
        },
      ],
    },
    {
      id: moves,
      kind: 'updated',
      changes: [
        {
          field: 'statusId',
          previous: active,
          requested: done,
          previousName: 'Doing',
          requestedName: 'Done',
          applied: true,
        },
        { field: 'parentId', previous: null, requested: parent, applied: true },
      ],
    },
    {
      id: trashed,
      kind: 'updated',
      changes: [{ field: 'trashed', previous: false, requested: true, applied: true }],
    },
    {
      id: restored,
      kind: 'updated',
      changes: [{ field: 'trashed', previous: true, requested: false, applied: true }],
    },
  ]);
  // A project in the trash takes its tasks with it without writing to them, or to their log.
  for (const trashed of [true, false]) {
    const response = await request.patch(`/api/projects/${project.id}`, {
      headers: { ...json, ...owner.headers },
      data: { trashed },
    });
    expect(response.status()).toBe(200);
  }
  await expect
    .poll(async () => (await entries(request, owner, parent)).map((entry) => entry.kind))
    .toEqual(['created']);
  expect(await entries(request, owner, id)).toHaveLength(6);
});
