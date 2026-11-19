import { expect, test } from '@playwright/test';
import { z } from 'zod';
import { createAccount, shapeRows } from './helpers';

const json = { 'Content-Type': 'application/json' };

test('a workspace patch that changes nothing is a no-op, for members only @api', async ({
  request,
}) => {
  const owner = await createAccount(request);
  const stranger = await createAccount(request);
  const [workspace] = await shapeRows(request, 'workspaces', owner.headers);
  const path = `/api/workspaces/${workspace?.id}`;

  const empty = await request.patch(path, { headers: owner.headers, data: {} });
  expect(empty.status()).toBe(200);
  expect(await empty.json()).toEqual({ txid: null });
  // Resending the current values changes nothing either, so nothing is written or streamed.
  const same = await request.patch(path, {
    headers: owner.headers,
    data: { name: workspace?.name, position: workspace?.position },
  });
  expect(await same.json()).toEqual({ txid: null });
  const renamed = await request.patch(path, { headers: owner.headers, data: { name: 'Renamed' } });
  expect((await renamed.json()).txid).toEqual(expect.any(Number));
  const missing = await request.patch(path, { headers: stranger.headers, data: {} });
  expect(missing.status()).toBe(404);
});

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
    key: 'PRV',
    statuses: (['backlog', 'active', 'done', 'cancelled'] as const).map((category) => ({
      id: crypto.randomUUID(),
      name: category,
      category,
      position: 'a0',
      isDefault: true,
    })),
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

test('no shape response may be cached @api', async ({ request }) => {
  // A cached snapshot would restart a reload from old rows that count as caught up.
  const { headers } = await createAccount(request);
  const snapshot = await request.get('/api/shapes/projects?offset=-1', { headers });
  expect(snapshot.ok()).toBeTruthy();
  const query = new URLSearchParams({
    offset: snapshot.headers()['electric-offset']!,
    handle: snapshot.headers()['electric-handle']!,
  });
  const caughtUp = await request.get(`/api/shapes/projects?${query}`, { headers });
  const unknown = await request.get('/api/shapes/users?offset=-1', { headers });
  expect(unknown.status()).toBe(404);
  for (const response of [snapshot, caughtUp, unknown]) {
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(response.headers().vary).toContain('authorization');
  }
});
