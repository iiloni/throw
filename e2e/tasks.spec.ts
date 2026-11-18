import { randomUUID } from 'node:crypto';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { z } from 'zod';
import { createAccount, shapeRows } from './helpers';

// The task model through its routes and shapes, without a browser (docs/data-model.md).

const json = { 'Content-Type': 'application/json' };
type Account = Awaited<ReturnType<typeof createAccount>>;

/** A boolean as a raw shape message has it: `true` in a snapshot, `t` in a later change. */
const isTrue = (value: unknown) => value === 'true' || value === 't';

const CATEGORIES = ['backlog', 'active', 'done', 'cancelled'] as const;
type Category = (typeof CATEGORIES)[number];

/** A project made through the API with one default status per category. */
async function createProject(request: APIRequestContext, account: Account, key = 'CAT') {
  const [workspace] = await shapeRows(request, 'workspaces', account.headers);
  const statuses = Object.fromEntries(
    CATEGORIES.map((category) => [category, randomUUID()]),
  ) as Record<Category, string>;
  const project = {
    id: randomUUID(),
    workspaceId: String(workspace?.id),
    name: 'Project',
    color: 'teal',
    icon: null,
    position: 'a0',
    key,
    statuses: CATEGORIES.map((category) => ({
      id: statuses[category],
      name: category,
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
  return { ...project, statuses };
}

function createTask(
  request: APIRequestContext,
  account: Account,
  task: { projectId: string } & Record<string, unknown>,
) {
  return request.post('/api/tasks', {
    headers: { ...json, ...account.headers },
    data: {
      id: randomUUID(),
      title: 'Task',
      description: null,
      descriptionVersion: null,
      position: 'a0',
      parentId: null,
      ...task,
    },
  });
}

async function newTask(
  request: APIRequestContext,
  account: Account,
  task: { projectId: string } & Record<string, unknown>,
) {
  const id = randomUUID();
  const response = await createTask(request, account, { id, ...task });
  expect(response.status()).toBe(201);
  return id;
}

const updateResponse = z.object({
  txid: z.number().nullable(),
  refused: z.array(z.object({ field: z.string(), reason: z.string() })),
});

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
  return updateResponse.parse(await response.json());
}

async function taskRow(request: APIRequestContext, account: Account, id: string) {
  const rows = await shapeRows(request, 'tasks', account.headers);
  return rows.find((row) => row.id === id);
}

test('statuses and tasks are visible and writable only to members of their workspace @api', async ({
  request,
}) => {
  const owner = await createAccount(request);
  const stranger = await createAccount(request);
  const project = await createProject(request, owner);
  const taskId = await newTask(request, owner, { projectId: project.id, title: 'Private' });

  expect(
    (await createTask(request, stranger, { projectId: project.id })).status(),
    'a task in a project the user cannot reach',
  ).toBe(404);
  const strangerStatus = await request.post('/api/statuses', {
    headers: { ...json, ...stranger.headers },
    data: {
      id: randomUUID(),
      projectId: project.id,
      name: 'Mine',
      category: 'active',
      position: 'a1',
      isDefault: false,
    },
  });
  expect(strangerStatus.status()).toBe(404);
  const rename = await request.patch(`/api/statuses/${project.statuses.active}`, {
    headers: { ...json, ...stranger.headers },
    data: { name: 'Taken over' },
  });
  expect(rename.status()).toBe(404);
  const statusRemoval = await request.delete(`/api/statuses/${project.statuses.active}`, {
    headers: stranger.headers,
  });
  expect(await statusRemoval.json()).toEqual({ txid: null });
  const edit = await request.patch(`/api/tasks/${taskId}`, {
    headers: { ...json, ...stranger.headers },
    data: { changeId: randomUUID(), changes: { title: { before: 'Private', after: 'Mine' } } },
  });
  expect(edit.status()).toBe(404);
  // A stranger's project trash or purge reaches nothing.
  const trash = await request.patch(`/api/projects/${project.id}`, {
    headers: { ...json, ...stranger.headers },
    data: { trashed: true },
  });
  expect(trash.status()).toBe(404);
  const purge = await request.delete(`/api/tasks/${taskId}`, { headers: stranger.headers });
  expect(await purge.json()).toEqual({ txid: null });
  // A task id another workspace uses cannot be taken.
  const strangerProject = await createProject(request, stranger);
  const clash = await createTask(request, stranger, { id: taskId, projectId: strangerProject.id });
  expect(clash.status()).toBe(409);

  await expect.poll(async () => await shapeRows(request, 'tasks', stranger.headers)).toEqual([]);
  await expect
    .poll(async () =>
      (await shapeRows(request, 'statuses', stranger.headers)).map((row) => row.project_id),
    )
    .not.toContain(project.id);
  const statuses = await shapeRows(request, 'statuses', owner.headers);
  expect(statuses.map((row) => row.name).sort()).toEqual([...CATEGORIES].sort());
  const [task] = await shapeRows(request, 'tasks', owner.headers);
  expect(task).toEqual({
    id: taskId,
    workspace_id: project.workspaceId,
    project_id: project.id,
    number: '1',
    title: 'Private',
    description: null,
    description_version: null,
    status_id: project.statuses.backlog,
    priority: '3',
    position: 'a0',
    parent_id: null,
    primary_tag_id: null,
    closed_at: null,
    deleted_at: null,
    created_at: expect.any(String),
  });
  // The counter that hands out numbers is the server's.
  const [projectRow] = await shapeRows(request, 'projects', owner.headers);
  expect(Object.keys(projectRow ?? {}).sort()).toEqual(
    [
      'color',
      'deleted_at',
      'icon',
      'id',
      'key',
      'name',
      'position',
      'priority_names',
      'workspace_id',
    ].sort(),
  );
});

test('concurrent creates take consecutive numbers; replays and purges take none @api', async ({
  request,
}) => {
  const owner = await createAccount(request);
  const project = await createProject(request, owner);
  const ids = Array.from({ length: 12 }, () => randomUUID());
  const responses = await Promise.all(
    ids.map((id) => createTask(request, owner, { id, projectId: project.id })),
  );
  expect(responses.map((response) => response.status())).toEqual(ids.map(() => 201));
  // The same creates again, as an outbox resends them after losing the responses.
  const replays = await Promise.all(
    ids.map((id) => createTask(request, owner, { id, projectId: project.id })),
  );
  for (const replay of replays) expect(await replay.json()).toEqual({ txid: null });

  const numbers = async () =>
    (await shapeRows(request, 'tasks', owner.headers)).map((row) => Number(row.number));
  await expect
    .poll(async () => (await numbers()).sort((a, b) => a - b))
    .toEqual(ids.map((_, index) => index + 1));

  // A purged task leaves a gap that is never filled.
  const last = (await shapeRows(request, 'tasks', owner.headers)).find(
    (row) => row.number === '12',
  );
  await updateTask(request, owner, String(last?.id), { trashed: { before: false, after: true } });
  const purge = await request.delete(`/api/tasks/${last?.id}`, { headers: owner.headers });
  expect((await purge.json()).txid).toEqual(expect.any(Number));
  const next = await newTask(request, owner, { projectId: project.id });
  await expect.poll(async () => (await taskRow(request, owner, next))?.number).toBe('13');
  // Another project counts from 1.
  const other = await createProject(request, owner, 'DOG');
  const first = await newTask(request, owner, { projectId: other.id });
  await expect.poll(async () => (await taskRow(request, owner, first))?.number).toBe('1');
});

test('the server settles clashing project keys and refuses a taken one later @api', async ({
  request,
}) => {
  const owner = await createAccount(request);
  // Two devices propose the same key at once.
  const [a, b] = await Promise.all([
    createProject(request, owner, 'CAT'),
    createProject(request, owner, 'CAT'),
  ]);
  const keys = async () =>
    Object.fromEntries(
      (await shapeRows(request, 'projects', owner.headers)).map((row) => [row.id, row.key]),
    );
  await expect.poll(async () => Object.values(await keys()).sort()).toEqual(['CAT', 'CAT2']);
  // Projects in the trash keep their keys.
  const trashed = (await keys())[a.id] === 'CAT' ? a : b;
  const trash = await request.patch(`/api/projects/${trashed.id}`, {
    headers: { ...json, ...owner.headers },
    data: { trashed: true },
  });
  expect(trash.status()).toBe(200);
  const c = await createProject(request, owner, 'CAT');
  await expect.poll(async () => (await keys())[c.id]).toBe('CAT3');

  const change = (id: string, key: string) =>
    request.patch(`/api/projects/${id}`, {
      headers: { ...json, ...owner.headers },
      data: { key },
    });
  expect((await change(c.id, 'CAT')).status()).toBe(409);
  expect((await change(c.id, 'KIT')).status()).toBe(200);
  await expect.poll(async () => (await keys())[c.id]).toBe('KIT');
  expect((await change(c.id, 'KIT')).status(), 'keeping its own key').toBe(200);
  // Keys are unique within a workspace, not across them.
  const stranger = await createAccount(request);
  const theirs = await createProject(request, stranger, 'CAT');
  await expect
    .poll(async () => (await shapeRows(request, 'projects', stranger.headers))[0])
    .toMatchObject({
      id: theirs.id,
      key: 'CAT',
    });
});

test('an update applies fresh fields, refuses stale ones and is recognised when resent @api', async ({
  request,
}) => {
  const owner = await createAccount(request);
  const project = await createProject(request, owner);
  const id = await newTask(request, owner, { projectId: project.id, title: 'Original' });

  // Another device renames the task first.
  const other = await updateTask(request, owner, id, {
    title: { before: 'Original', after: 'From the other device' },
  });
  expect(other).toEqual({ txid: expect.any(Number), refused: [] });

  // This device, offline, saw "Original" and changed the title and the priority.
  const changeId = randomUUID();
  const changes = {
    title: { before: 'Original', after: 'Offline title' },
    priority: { before: 3, after: 1 },
  };
  const result = await updateTask(request, owner, id, changes, changeId);
  expect(result).toEqual({
    txid: expect.any(Number),
    refused: [{ field: 'title', reason: 'stale' }],
  });
  await expect
    .poll(async () => await taskRow(request, owner, id))
    .toMatchObject({
      title: 'From the other device',
      priority: '1',
    });

  // The response was lost and the outbox sends the change again: nothing happens twice.
  const resent = await updateTask(request, owner, id, changes, changeId);
  expect(resent).toEqual({ txid: null, refused: [{ field: 'title', reason: 'stale' }] });

  // A resend must not undo a change made after it was first applied.
  const applied = randomUUID();
  const lower = { priority: { before: 1, after: 2 } };
  await updateTask(request, owner, id, lower, applied);
  await updateTask(request, owner, id, { priority: { before: 2, after: 1 } });
  expect(await updateTask(request, owner, id, lower, applied)).toEqual({ txid: null, refused: [] });
  await expect.poll(async () => (await taskRow(request, owner, id))?.priority).toBe('1');

  // A write whose fields were all refused changes no row, so it has no transaction to wait for.
  expect(
    await updateTask(request, owner, id, { title: { before: 'Something old', after: 'x' } }),
  ).toEqual({ txid: null, refused: [{ field: 'title', reason: 'stale' }] });

  // A change id is the user's to use once.
  const reuse = await request.patch(
    `/api/tasks/${await newTask(request, owner, { projectId: project.id })}`,
    {
      headers: { ...json, ...owner.headers },
      data: { changeId, changes: { priority: { before: 3, after: 2 } } },
    },
  );
  expect(reuse.status()).toBe(409);
});

test('statuses, parents and positions follow the conflict rule @api', async ({ request }) => {
  const owner = await createAccount(request);
  const project = await createProject(request, owner);
  const { backlog, active, done, cancelled } = project.statuses;
  const id = await newTask(request, owner, { projectId: project.id });

  // A status deleted meanwhile is refused, not substituted.
  const testing = randomUUID();
  const created = await request.post('/api/statuses', {
    headers: { ...json, ...owner.headers },
    data: {
      id: testing,
      projectId: project.id,
      name: 'Testing',
      category: 'active',
      position: 'a1',
      isDefault: false,
    },
  });
  expect(created.status()).toBe(201);
  const removed = await request.delete(`/api/statuses/${testing}`, { headers: owner.headers });
  expect((await removed.json()).txid).toEqual(expect.any(Number));
  expect(
    await updateTask(request, owner, id, {
      statusId: { before: backlog, after: testing },
      position: { after: 'a3', statusId: testing, priority: 3, parentId: null },
    }),
  ).toEqual({ txid: null, refused: [{ field: 'statusId', reason: 'invalid' }] });
  await expect
    .poll(async () => await taskRow(request, owner, id))
    .toMatchObject({ status_id: backlog, position: 'a0' });

  // A drop: status, priority and position in one write.
  expect(
    await updateTask(request, owner, id, {
      statusId: { before: backlog, after: active },
      priority: { before: 3, after: 2 },
      position: { after: 'a5', statusId: active, priority: 2, parentId: null },
    }),
  ).toMatchObject({ refused: [] });
  await expect
    .poll(async () => await taskRow(request, owner, id))
    .toMatchObject({
      status_id: active,
      priority: '2',
      position: 'a5',
    });
  // A reorder computed in a column the task has since left is ignored, and not reported.
  expect(
    await updateTask(request, owner, id, {
      position: { after: 'a9', statusId: backlog, priority: 2, parentId: null },
    }),
  ).toEqual({ txid: null, refused: [] });

  // Closing stamps closedAt; moving between closed statuses keeps it; reopening clears it.
  await updateTask(request, owner, id, { statusId: { before: active, after: done } });
  await expect
    .poll(async () => (await taskRow(request, owner, id))?.closed_at)
    .toEqual(expect.any(String));
  const closedAt = (await taskRow(request, owner, id))?.closed_at;
  await updateTask(request, owner, id, { statusId: { before: done, after: cancelled } });
  await expect.poll(async () => (await taskRow(request, owner, id))?.closed_at).toBe(closedAt);
  await updateTask(request, owner, id, { statusId: { before: cancelled, after: backlog } });
  await expect.poll(async () => (await taskRow(request, owner, id))?.closed_at).toBeNull();

  // Subtasks are one level deep.
  const parent = await newTask(request, owner, { projectId: project.id, title: 'Parent' });
  expect(
    await updateTask(request, owner, id, { parentId: { before: null, after: parent } }),
  ).toMatchObject({ refused: [] });
  const grandchild = await newTask(request, owner, { projectId: project.id });
  expect(
    await updateTask(request, owner, grandchild, { parentId: { before: null, after: id } }),
  ).toEqual({ txid: null, refused: [{ field: 'parentId', reason: 'invalid' }] });
  expect(
    await updateTask(request, owner, parent, { parentId: { before: null, after: grandchild } }),
    'a task with subtasks cannot become one',
  ).toEqual({ txid: null, refused: [{ field: 'parentId', reason: 'invalid' }] });
  expect((await createTask(request, owner, { projectId: project.id, parentId: id })).status()).toBe(
    409,
  );
});

test('a create is never dropped for a deleted status; a purged parent or project drops it @api', async ({
  request,
}) => {
  const owner = await createAccount(request);
  const project = await createProject(request, owner);
  const gone = randomUUID();
  const id = await newTask(request, owner, { projectId: project.id, statusId: gone });
  await expect
    .poll(async () => (await taskRow(request, owner, id))?.status_id)
    .toBe(project.statuses.backlog);
  const closed = await newTask(request, owner, {
    projectId: project.id,
    statusId: project.statuses.done,
  });
  await expect
    .poll(async () => (await taskRow(request, owner, closed))?.closed_at)
    .toEqual(expect.any(String));

  // A subtask of a trashed parent is created, and counts as trashed through it.
  await updateTask(request, owner, id, { trashed: { before: false, after: true } });
  const child = await newTask(request, owner, { projectId: project.id, parentId: id });
  await expect.poll(async () => (await taskRow(request, owner, child))?.deleted_at).toBeNull();

  // Purging the parent takes its subtasks with it; a subtask queued for it afterwards is dropped.
  const purge = await request.delete(`/api/tasks/${id}`, { headers: owner.headers });
  expect((await purge.json()).txid).toEqual(expect.any(Number));
  await expect.poll(async () => await taskRow(request, owner, child)).toBeUndefined();
  expect((await createTask(request, owner, { projectId: project.id, parentId: id })).status()).toBe(
    404,
  );
  const lateEdit = await request.patch(`/api/tasks/${child}`, {
    headers: { ...json, ...owner.headers },
    data: { changeId: randomUUID(), changes: { title: { before: 'Task', after: 'Late' } } },
  });
  expect(lateEdit.status()).toBe(404);

  const project2 = await createProject(request, owner, 'DOG');
  await request.patch(`/api/projects/${project2.id}`, {
    headers: { ...json, ...owner.headers },
    data: { trashed: true },
  });
  // A task created in a trashed project is created, and counts as trashed through it.
  await newTask(request, owner, { projectId: project2.id });
  const purgeProject = await request.delete(`/api/projects/${project2.id}`, {
    headers: owner.headers,
  });
  expect((await purgeProject.json()).txid).toEqual(expect.any(Number));
  expect((await createTask(request, owner, { projectId: project2.id })).status()).toBe(404);
  await expect
    .poll(async () =>
      (await shapeRows(request, 'statuses', owner.headers)).map((row) => row.project_id),
    )
    .not.toContain(project2.id);
});

test('the trash: restore, subtasks, and purges that only take what is still trashed @api', async ({
  request,
}) => {
  const owner = await createAccount(request);
  const project = await createProject(request, owner);
  const parent = await newTask(request, owner, { projectId: project.id, title: 'Parent' });
  const alone = await newTask(request, owner, { projectId: project.id, parentId: parent });
  const along = await newTask(request, owner, { projectId: project.id, parentId: parent });

  // A subtask trashed on its own stays trashed when its parent is restored.
  await updateTask(request, owner, alone, { trashed: { before: false, after: true } });
  await updateTask(request, owner, parent, { trashed: { before: false, after: true } });
  await expect
    .poll(async () => (await taskRow(request, owner, along))?.deleted_at, {
      message: 'nothing is written to it',
    })
    .toBeNull();
  await updateTask(request, owner, parent, { trashed: { before: true, after: false } });
  await expect
    .poll(async () => (await taskRow(request, owner, alone))?.deleted_at)
    .toEqual(expect.any(String));
  await expect.poll(async () => (await taskRow(request, owner, parent))?.deleted_at).toBeNull();

  // A purge of something no longer in the trash, restored on another device, does nothing.
  const notTrashed = await request.delete(`/api/tasks/${along}`, { headers: owner.headers });
  expect(await notTrashed.json()).toEqual({ txid: null });
  await expect.poll(async () => await taskRow(request, owner, along)).toBeDefined();

  // A trashed or closed task takes updates like any other.
  expect(
    await updateTask(request, owner, alone, { title: { before: 'Task', after: 'Still editable' } }),
  ).toMatchObject({ refused: [] });

  const purged = await request.delete(`/api/tasks/${alone}`, { headers: owner.headers });
  expect((await purged.json()).txid).toEqual(expect.any(Number));
  const replay = await request.delete(`/api/tasks/${alone}`, { headers: owner.headers });
  expect(await replay.json()).toEqual({ txid: null });

  // A project in the trash takes its tasks with it without writing to them, and is purged only
  // while it is still there.
  const trash = (trashed: boolean) =>
    request.patch(`/api/projects/${project.id}`, {
      headers: { ...json, ...owner.headers },
      data: { trashed },
    });
  await trash(true);
  await expect.poll(async () => (await taskRow(request, owner, parent))?.deleted_at).toBeNull();
  const purgeTaskInProject = await request.delete(`/api/tasks/${along}`, {
    headers: owner.headers,
  });
  expect((await purgeTaskInProject.json()).txid, 'it counts as trashed').toEqual(
    expect.any(Number),
  );
  await trash(false);
  const restored = await request.delete(`/api/projects/${project.id}`, { headers: owner.headers });
  expect(await restored.json()).toEqual({ txid: null });
  await expect
    .poll(async () => (await shapeRows(request, 'projects', owner.headers))[0])
    .toMatchObject({
      id: project.id,
      deleted_at: null,
    });
  await trash(true);
  await expect
    .poll(async () => (await shapeRows(request, 'projects', owner.headers))[0]?.deleted_at)
    .toEqual(expect.any(String));
  const deletedAt = (await shapeRows(request, 'projects', owner.headers))[0]?.deleted_at;
  await trash(true);
  await expect
    .poll(async () => (await shapeRows(request, 'projects', owner.headers))[0]?.deleted_at, {
      message: 'kept',
    })
    .toBe(deletedAt);
  const gone = await request.delete(`/api/projects/${project.id}`, { headers: owner.headers });
  expect((await gone.json()).txid).toEqual(expect.any(Number));
  await expect.poll(async () => await shapeRows(request, 'tasks', owner.headers)).toEqual([]);
  await expect.poll(async () => await shapeRows(request, 'projects', owner.headers)).toEqual([]);
});

test('a project keeps a default status in every category @api', async ({ request }) => {
  const owner = await createAccount(request);
  const project = await createProject(request, owner);
  const remove = (id: string) => request.delete(`/api/statuses/${id}`, { headers: owner.headers });

  expect((await remove(project.statuses.done)).status(), 'the default and the last').toBe(409);

  const shipped = randomUUID();
  const status = {
    id: shipped,
    projectId: project.id,
    name: 'Shipped',
    category: 'done',
    position: 'a1',
    isDefault: true,
  };
  const create = () =>
    request.post('/api/statuses', { headers: { ...json, ...owner.headers }, data: status });
  expect((await create()).status()).toBe(201);
  expect(await (await create()).json(), 'a replay').toEqual({ txid: null });
  const defaults = async () =>
    (await shapeRows(request, 'statuses', owner.headers))
      .filter((row) => row.category === 'done' && isTrue(row.is_default))
      .map((row) => row.id);
  await expect
    .poll(async () => await defaults(), { message: 'a new default replaces the old' })
    .toEqual([shipped]);

  // Back again, by making the first one the default.
  const makeDefault = await request.patch(`/api/statuses/${project.statuses.done}`, {
    headers: { ...json, ...owner.headers },
    data: { isDefault: true, name: 'Done!' },
  });
  expect(makeDefault.status()).toBe(200);
  await expect.poll(async () => await defaults()).toEqual([project.statuses.done]);
  const unset = await request.patch(`/api/statuses/${shipped}`, {
    headers: { ...json, ...owner.headers },
    data: { isDefault: false },
  });
  expect(unset.status(), 'a category is never left without one').toBe(400);

  // A status that tasks use, counting the trash, cannot be deleted.
  const task = await newTask(request, owner, { projectId: project.id, statusId: shipped });
  await updateTask(request, owner, task, { trashed: { before: false, after: true } });
  expect((await remove(shipped)).status()).toBe(409);
  await updateTask(request, owner, task, {
    statusId: { before: shipped, after: project.statuses.done },
  });
  expect((await (await remove(shipped)).json()).txid).toEqual(expect.any(Number));
  expect(await (await remove(shipped)).json(), 'a replay').toEqual({ txid: null });
});

test('deleting a workspace removes its projects, statuses and tasks @api', async ({ request }) => {
  const owner = await createAccount(request);
  const project = await createProject(request, owner);
  const parent = await newTask(request, owner, { projectId: project.id });
  await newTask(request, owner, { projectId: project.id, parentId: parent });
  await updateTask(request, owner, parent, { title: { before: 'Task', after: 'Logged' } });
  const removal = await request.delete(`/api/workspaces/${project.workspaceId}`, {
    headers: owner.headers,
  });
  expect((await removal.json()).txid).toEqual(expect.any(Number));
  await expect.poll(async () => await shapeRows(request, 'tasks', owner.headers)).toEqual([]);
  await expect.poll(async () => await shapeRows(request, 'statuses', owner.headers)).toEqual([]);
});
