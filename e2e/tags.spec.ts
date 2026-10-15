import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { z } from 'zod';
import { API_PROTOCOL_HEADER, API_PROTOCOL_VERSION } from '../packages/shared/src';
import { createAccount, shapeRows } from './helpers';
import { newTag, taggedTask, tagProject, tagTaskUpdate } from './tag-helpers';

test('tags and assignments isolate membership and project references @api', async ({
  request,
  playwright,
  baseURL,
}) => {
  const anonymous = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { [API_PROTOCOL_HEADER]: String(API_PROTOCOL_VERSION) },
  });
  const owner = await createAccount(request);
  const stranger = await createAccount(request);
  const project = await tagProject(request, owner);
  const other = await tagProject(request, owner);
  const tag = await newTag(request, owner, project.id, { name: 'Private', color: 'teal' });
  const task = await taggedTask(request, owner, project.id, {
    primaryTagId: tag.id,
    secondaryTagIds: [tag.id],
  });
  for (const shape of ['tags', 'task-tags']) {
    await expect.poll(async () => (await shapeRows(request, shape, owner.headers)).length).toBe(1);
    expect(await shapeRows(request, shape, stranger.headers)).toEqual([]);
    const forged = await request.get(`/api/shapes/${shape}`, {
      params: { offset: '-1', where: 'true', 'params[1]': owner.user.id, columns: '*' },
      headers: stranger.headers,
    });
    expect(forged.status()).toBe(200);
    const messages = z
      .array(z.object({ value: z.unknown().optional() }))
      .parse(await forged.json());
    expect(messages.filter((message) => message.value !== undefined)).toEqual([]);
    expect((await anonymous.get(`/api/shapes/${shape}?offset=-1`)).status()).toBe(401);
  }
  await anonymous.dispose();
  expect(
    (
      await request.post('/api/tags', {
        headers: stranger.headers,
        data: { ...tag, id: randomUUID() },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.patch(`/api/tags/${tag.id}`, {
        headers: stranger.headers,
        data: { name: 'Stolen' },
      })
    ).status(),
  ).toBe(404);
  expect(
    await (await request.delete(`/api/tags/${tag.id}`, { headers: stranger.headers })).json(),
  ).toEqual({ txid: null });
  expect(
    (
      await request.patch(`/api/tasks/${task.id}`, {
        headers: stranger.headers,
        data: {
          changeId: randomUUID(),
          changes: { secondaryTags: [{ tagId: tag.id, present: false }] },
        },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post('/api/tags', {
        headers: owner.headers,
        data: { ...tag, id: randomUUID(), projectId: other.id, parentId: tag.id, color: null },
      })
    ).status(),
  ).toBe(409);
  const foreign = await newTag(request, owner, other.id, { color: 'teal' });
  expect(
    await tagTaskUpdate(request, owner, task.id, {
      primaryTagId: { before: tag.id, after: foreign.id },
      secondaryTags: [{ tagId: foreign.id, present: true }],
    }),
  ).toMatchObject({
    txid: null,
    refused: [
      { field: 'primaryTagId', reason: 'invalid' },
      { field: 'secondaryTags', tagId: foreign.id, reason: 'invalid' },
    ],
  });
  const row = (await shapeRows(request, 'tags', owner.headers)).find((row) => row.id === tag.id)!;
  expect(Object.keys(row).sort()).toEqual(
    ['id', 'workspace_id', 'project_id', 'name', 'parent_id', 'icon', 'color'].sort(),
  );
  expect(Object.keys((await shapeRows(request, 'task-tags', owner.headers))[0]!).sort()).toEqual(
    ['task_id', 'tag_id', 'workspace_id', 'project_id'].sort(),
  );
});

test('tag writes preserve Catch tree rules, ordering inputs and replay semantics @api', async ({
  request,
}) => {
  const owner = await createAccount(request);
  const project = await tagProject(request, owner);
  const root = await newTag(request, owner, project.id, {
    name: 'Product',
    color: 'teal',
    icon: 'rocket',
  });
  const child = await newTag(request, owner, project.id, { name: 'Mobile', parentId: root.id });
  const leaf = await newTag(request, owner, project.id, { parentId: child.id });
  expect(
    await (await request.post('/api/tags', { headers: owner.headers, data: root })).json(),
  ).toEqual({ txid: null });
  const patch = (id: string, data: Record<string, unknown>) =>
    request.patch(`/api/tags/${id}`, { headers: owner.headers, data });
  expect((await patch(root.id, { parentId: leaf.id, color: null, icon: null })).status()).toBe(409);
  expect((await patch(child.id, { parentId: child.id })).status()).toBe(409);
  expect((await patch(child.id, { color: 'red' })).status()).toBe(409);
  expect((await patch(child.id, { parentId: randomUUID() })).status()).toBe(409);
  expect((await patch(child.id, { projectId: randomUUID() })).status()).toBe(400);
  expect((await patch(child.id, { name: ' ' })).status()).toBe(400);
  expect(
    (
      await request.post('/api/tags', {
        headers: owner.headers,
        data: { ...root, id: randomUUID(), name: 'Other' },
      })
    ).status(),
  ).toBe(409);
  // Equal names are allowed. Concurrent field-only edits both survive.
  await newTag(request, owner, project.id, { name: root.name });
  expect((await patch(root.id, { name: 'Renamed' })).status()).toBe(200);
  expect((await patch(root.id, { color: 'amber' })).status()).toBe(200);
  expect(await (await patch(root.id, { color: 'amber' })).json()).toEqual({ txid: null });
  expect((await patch(leaf.id, { parentId: null, icon: 'heart', color: 'red' })).status()).toBe(
    200,
  );
  expect((await patch(root.id, { parentId: leaf.id })).status()).toBe(409);
  expect((await patch(root.id, { parentId: leaf.id, color: null, icon: null })).status()).toBe(200);
  await expect
    .poll(async () =>
      (await shapeRows(request, 'tags', owner.headers)).find((row) => row.id === root.id),
    )
    .toMatchObject({ name: 'Renamed', parent_id: leaf.id, color: null, icon: null });
});

test('concurrent opposing moves cannot create a cycle and competing colors cannot duplicate @api', async ({
  request,
}) => {
  const owner = await createAccount(request);
  const project = await tagProject(request, owner);
  const a = await newTag(request, owner, project.id);
  const b = await newTag(request, owner, project.id);
  const moves = await Promise.all([
    request.patch(`/api/tags/${a.id}`, { headers: owner.headers, data: { parentId: b.id } }),
    request.patch(`/api/tags/${b.id}`, { headers: owner.headers, data: { parentId: a.id } }),
  ]);
  expect(moves.map((response) => response.status()).sort()).toEqual([200, 409]);
  const colors = await Promise.all(
    [1, 2].map(() =>
      request.post('/api/tags', {
        headers: owner.headers,
        data: { ...a, id: randomUUID(), color: 'teal' },
      }),
    ),
  );
  expect(colors.map((response) => response.status()).sort()).toEqual([201, 409]);
});

test('task creates omit deleted/foreign tags and primary updates follow the per-field conflict rule @api', async ({
  request,
}) => {
  const owner = await createAccount(request);
  const project = await tagProject(request, owner);
  const a = await newTag(request, owner, project.id, { name: 'A' });
  const b = await newTag(request, owner, project.id, { name: 'B' });
  const gone = await newTag(request, owner, project.id);
  await request.delete(`/api/tags/${gone.id}`, { headers: owner.headers });
  const created = await taggedTask(request, owner, project.id, {
    primaryTagId: gone.id,
    secondaryTagIds: [gone.id, a.id, a.id],
  });
  await expect
    .poll(
      async () =>
        (await shapeRows(request, 'tasks', owner.headers)).find((row) => row.id === created.id)
          ?.primary_tag_id,
    )
    .toBeNull();
  await expect
    .poll(async () =>
      (await shapeRows(request, 'task-tags', owner.headers)).map((row) => row.tag_id),
    )
    .toEqual([a.id]);
  expect(
    await tagTaskUpdate(request, owner, created.id, {
      primaryTagId: { before: null, after: a.id },
    }),
  ).toMatchObject({ refused: [] });
  expect(
    await tagTaskUpdate(request, owner, created.id, {
      primaryTagId: { before: null, after: b.id },
      title: { before: 'Task', after: 'Fresh title' },
    }),
  ).toMatchObject({
    txid: expect.any(Number),
    refused: [{ field: 'primaryTagId', reason: 'stale' }],
  });
  expect(
    await tagTaskUpdate(request, owner, created.id, {
      primaryTagId: { before: a.id, after: gone.id },
    }),
  ).toMatchObject({ txid: null, refused: [{ field: 'primaryTagId', reason: 'invalid' }] });
  const changeId = randomUUID();
  const update = { primaryTagId: { before: a.id, after: b.id } };
  await tagTaskUpdate(request, owner, created.id, update, changeId);
  await tagTaskUpdate(request, owner, created.id, { primaryTagId: { before: b.id, after: a.id } });
  expect(await tagTaskUpdate(request, owner, created.id, update, changeId)).toEqual({
    txid: null,
    refused: [],
  });
  await expect
    .poll(async () =>
      (await shapeRows(request, 'tasks', owner.headers)).find((row) => row.id === created.id),
    )
    .toMatchObject({ primary_tag_id: a.id, title: 'Fresh title' });
  expect(
    await tagTaskUpdate(request, owner, created.id, {
      primaryTagId: { before: gone.id, after: a.id },
    }),
  ).toEqual({ txid: null, refused: [] });
  await tagTaskUpdate(request, owner, created.id, { primaryTagId: { before: a.id, after: null } });
});

test('two devices add different secondary tags; per-tag removals, primary independence and lost-response replay @api', async ({
  request,
}) => {
  const owner = await createAccount(request);
  const project = await tagProject(request, owner);
  const a = await newTag(request, owner, project.id);
  const b = await newTag(request, owner, project.id, { parentId: a.id });
  const task = await taggedTask(request, owner, project.id);
  const addId = randomUUID();
  const aChange = { secondaryTags: [{ tagId: a.id, present: true }] };
  const results = await Promise.all([
    tagTaskUpdate(request, owner, task.id, aChange, addId),
    tagTaskUpdate(request, owner, task.id, { secondaryTags: [{ tagId: b.id, present: true }] }),
  ]);
  for (const response of results)
    expect(response).toEqual({ txid: null, secondaryTagsTxid: expect.any(Number), refused: [] });
  const assigned = async () =>
    (await shapeRows(request, 'task-tags', owner.headers)).map((row) => row.tag_id).sort();
  await expect.poll(assigned).toEqual([a.id, b.id].sort());
  expect(await tagTaskUpdate(request, owner, task.id, aChange)).toEqual({
    txid: null,
    refused: [],
  });
  await tagTaskUpdate(request, owner, task.id, { primaryTagId: { before: null, after: b.id } });
  await expect.poll(assigned).toEqual([a.id, b.id].sort());
  await tagTaskUpdate(request, owner, task.id, {
    secondaryTags: [{ tagId: a.id, present: false }],
  });
  expect(await tagTaskUpdate(request, owner, task.id, aChange, addId)).toEqual({
    txid: null,
    refused: [],
  });
  await expect.poll(assigned).toEqual([b.id]);
  await request.patch(`/api/tags/${b.id}`, { headers: owner.headers, data: { parentId: null } });
  await expect.poll(assigned).toEqual([b.id]);
  const missing = randomUUID();
  expect(
    await tagTaskUpdate(request, owner, task.id, {
      secondaryTags: [{ tagId: missing, present: false }],
    }),
  ).toEqual({
    txid: null,
    refused: [{ field: 'secondaryTags', tagId: missing, reason: 'invalid' }],
  });
});

test('deleting the current branch clears primary and secondary roles without touching tasks or unrelated tags @api', async ({
  request,
}) => {
  const owner = await createAccount(request);
  const project = await tagProject(request, owner);
  const root = await newTag(request, owner, project.id);
  const child = await newTag(request, owner, project.id, { parentId: root.id });
  const unrelated = await newTag(request, owner, project.id);
  const task = await taggedTask(request, owner, project.id, {
    primaryTagId: child.id,
    secondaryTagIds: [root.id, child.id, unrelated.id],
  });
  await tagTaskUpdate(request, owner, task.id, { trashed: { before: false, after: true } });
  const remove = await request.delete(`/api/tags/${root.id}`, { headers: owner.headers });
  expect(await remove.json()).toEqual({
    txid: expect.any(Number),
    tasksTxid: expect.any(Number),
    secondaryTagsTxid: expect.any(Number),
  });
  expect(
    await (await request.delete(`/api/tags/${root.id}`, { headers: owner.headers })).json(),
  ).toEqual({ txid: null });
  await expect
    .poll(async () =>
      (await shapeRows(request, 'tasks', owner.headers)).find((row) => row.id === task.id),
    )
    .toMatchObject({ primary_tag_id: null, title: 'Task', deleted_at: expect.any(String) });
  await expect
    .poll(async () =>
      (await shapeRows(request, 'task-tags', owner.headers)).map((row) => row.tag_id),
    )
    .toEqual([unrelated.id]);
  await expect
    .poll(async () => (await shapeRows(request, 'tags', owner.headers)).map((row) => row.id))
    .toEqual([unrelated.id]);
  expect(
    await tagTaskUpdate(request, owner, task.id, {
      primaryTagId: { before: child.id, after: unrelated.id },
    }),
  ).toMatchObject({ refused: [{ field: 'primaryTagId', reason: 'stale' }] });
  await request.delete(`/api/tasks/${task.id}`, { headers: owner.headers });
  await expect.poll(async () => shapeRows(request, 'task-tags', owner.headers)).toEqual([]);
  await request.patch(`/api/projects/${project.id}`, {
    headers: owner.headers,
    data: { trashed: true },
  });
  await request.delete(`/api/projects/${project.id}`, { headers: owner.headers });
  await expect.poll(async () => shapeRows(request, 'tags', owner.headers)).toEqual([]);
});
