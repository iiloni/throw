import { expect, test } from '@playwright/test';
import { z } from 'zod';
import { createAccount, shapeRows } from './helpers';

const json = { 'Content-Type': 'application/json' };

test('a project is visible and writable only to members of its workspace @api', async ({
  request,
}) => {
  const owner = await createAccount(request);
  const stranger = await createAccount(request);
  const [workspace] = await shapeRows(request, 'workspaces', owner.headers);
  expect(workspace).toMatchObject({ name: 'Personal' });
  const project = {
    id: crypto.randomUUID(),
    workspaceId: workspace?.id,
    name: 'Private',
    color: 'teal',
    icon: null,
    position: 'a0',
  };

  // Nobody can put a project in a workspace they do not belong to.
  const intrusion = await request.post('/api/projects', {
    headers: { ...json, ...stranger.headers },
    data: project,
  });
  expect(intrusion.status()).toBe(404);

  const created = await request.post('/api/projects', {
    headers: { ...json, ...owner.headers },
    data: project,
  });
  expect(created.status()).toBe(201);
  expect((await created.json()).txid).toEqual(expect.any(Number));

  // A queued write that already reached the server is replayed without a second change.
  const replayed = await request.post('/api/projects', {
    headers: { ...json, ...owner.headers },
    data: project,
  });
  expect(replayed.status()).toBe(200);
  expect(await replayed.json()).toEqual({ txid: null });

  expect(await shapeRows(request, 'projects', owner.headers)).toEqual([
    expect.objectContaining({ id: project.id, name: 'Private' }),
  ]);
  expect(await shapeRows(request, 'projects', stranger.headers)).toEqual([]);
  expect(
    (await shapeRows(request, 'workspaces', stranger.headers)).map((row) => row.id),
  ).not.toContain(workspace?.id);

  const rename = await request.patch(`/api/projects/${project.id}`, {
    headers: { ...json, ...stranger.headers },
    data: { name: 'Taken over' },
  });
  expect(rename.status()).toBe(404);
  const removal = await request.delete(`/api/projects/${project.id}`, {
    headers: stranger.headers,
  });
  expect(await removal.json()).toEqual({ txid: null });
  expect(await shapeRows(request, 'projects', owner.headers)).toEqual([
    expect.objectContaining({ name: 'Private' }),
  ]);
});

test('a shape request cannot choose its own rows or columns @api', async ({ request }) => {
  const owner = await createAccount(request);
  const stranger = await createAccount(request);
  const response = await request.get(
    '/api/shapes/workspaces?offset=-1&where=true&columns=id,name,created_at&table=user',
    { headers: stranger.headers },
  );
  expect(response.ok()).toBeTruthy();
  const rows = z
    .array(z.object({ value: z.record(z.string(), z.unknown()).optional() }))
    .parse(await response.json())
    .flatMap((message) => (message.value ? [message.value] : []));
  expect(rows).toEqual([
    { id: expect.any(String), name: 'Personal', position: expect.any(String) },
  ]);
  const [own] = await shapeRows(request, 'workspaces', owner.headers);
  expect(rows[0]?.id).not.toBe(own?.id);
});
