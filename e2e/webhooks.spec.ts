import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { createMcpTokenResponseSchema } from '../packages/shared/src/mcpTokens';
import { STARTER_STATUSES } from '../packages/shared/src/statuses';
import {
  webhookResponseSchema,
  webhookSecretResponseSchema,
  webhooksResponseSchema,
  webhookTestResponseSchema,
} from '../packages/shared/src/webhooks';
import { createAccount } from './helpers';
import { expectSigned, startReceiver } from './webhook-helpers';

type Account = Awaited<ReturnType<typeof createAccount>>;

async function inventory(request: APIRequestContext, account: Account) {
  const response = await request.get('/api/webhooks', { headers: account.headers });
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  return webhooksResponseSchema.parse(await response.json());
}

async function makeProject(request: APIRequestContext, account: Account, workspaceId: string) {
  const statuses = STARTER_STATUSES.map((status) => ({
    ...status,
    id: randomUUID(),
    position: 'a0',
    isDefault: true,
  }));
  const project = {
    id: randomUUID(),
    workspaceId,
    name: 'Hooked',
    key: 'HOOK',
    color: 'teal',
    icon: null,
    position: 'a0',
    statuses,
  };
  expect(
    (await request.post('/api/projects', { data: project, headers: account.headers })).status(),
  ).toBe(201);
  return project;
}

async function createWebhook(
  request: APIRequestContext,
  account: Account,
  data: Record<string, unknown>,
) {
  const response = await request.post('/api/webhooks', { headers: account.headers, data });
  expect(response.status(), await response.text()).toBe(201);
  expect(response.headers()['cache-control']).toBe('no-store');
  return webhookSecretResponseSchema.parse(await response.json());
}

const paragraph = (text: string) => [{ type: 'paragraph', content: [{ type: 'text', text }] }];

test('webhooks are private to their owner, reveal the secret once and refuse unsafe URLs @api', async ({
  request,
}) => {
  const owner = await createAccount(request);
  const stranger = await createAccount(request);
  const { workspaces } = await inventory(request, owner);
  const workspaceId = workspaces[0]!.id;
  const project = await makeProject(request, owner, workspaceId);
  const strangerWorkspace = (await inventory(request, stranger)).workspaces[0]!.id;
  const strangerProject = await makeProject(request, stranger, strangerWorkspace);

  for (const url of [
    'http://hooks.example.com/throw',
    'https://10.0.0.1/hook',
    'https://169.254.169.254/latest/meta-data',
    // The dev stack allows loopback for the test receiver, so these stay off it.
    'https://[::ffff:10.0.0.1]/hook',
    'https://[::ffff:a9fe:a9fe]/hook',
    'https://printer.local/hook',
    'https://100.100.1.2/hook',
    'https://user:pass@hooks.example.com/',
  ]) {
    const refused = await request.post('/api/webhooks', {
      headers: owner.headers,
      data: { workspaceId, name: 'Unsafe', url },
    });
    expect(refused.status(), url).toBe(400);
  }
  expect(
    (
      await request.post('/api/webhooks', {
        headers: stranger.headers,
        data: { workspaceId, name: 'Not mine', url: 'https://hooks.example.com/' },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post('/api/webhooks', {
        headers: owner.headers,
        data: {
          workspaceId,
          projectId: strangerProject.id,
          name: 'Other project',
          url: 'https://hooks.example.com/',
        },
      })
    ).status(),
  ).toBe(404);

  const created = await createWebhook(request, owner, {
    workspaceId,
    projectId: project.id,
    name: '  Agent wake-up  ',
    url: 'https://hooks.example.com/throw',
  });
  expect(created.secret).toMatch(/^throw_whsec_[\w-]{43}$/);
  expect(created.webhook).toMatchObject({
    name: 'Agent wake-up',
    projectId: project.id,
    ignoreTokenWrites: true,
    enabled: true,
    lastDeliveryAt: null,
  });

  const listed = await inventory(request, owner);
  expect(listed.webhooks).toEqual([created.webhook]);
  expect(JSON.stringify(listed)).not.toContain(created.secret);
  expect(listed.workspaces[0]?.projects).toContainEqual({
    id: project.id,
    name: 'Hooked',
    key: 'HOOK',
  });
  expect((await inventory(request, stranger)).webhooks).toEqual([]);

  const id = created.webhook.id;
  for (const attempt of [
    request.patch(`/api/webhooks/${id}`, { headers: stranger.headers, data: { enabled: false } }),
    request.post(`/api/webhooks/${id}/test`, { headers: stranger.headers }),
    request.post(`/api/webhooks/${id}/secret`, { headers: stranger.headers }),
  ])
    expect((await attempt).status()).toBe(404);
  expect(
    (await request.delete(`/api/webhooks/${id}`, { headers: stranger.headers })).status(),
  ).toBe(204);

  const patched = await request.patch(`/api/webhooks/${id}`, {
    headers: owner.headers,
    data: { name: 'Renamed', enabled: false, projectId: null, ignoreTokenWrites: false },
  });
  expect(patched.status()).toBe(200);
  expect(webhookResponseSchema.parse(await patched.json()).webhook).toMatchObject({
    name: 'Renamed',
    enabled: false,
    projectId: null,
    ignoreTokenWrites: false,
  });
  expect(
    (
      await request.patch(`/api/webhooks/${id}`, {
        headers: owner.headers,
        data: { url: 'https://192.168.1.10/' },
      })
    ).status(),
  ).toBe(400);

  const rotated = await request.post(`/api/webhooks/${id}/secret`, { headers: owner.headers });
  expect(rotated.status()).toBe(200);
  const { secret } = webhookSecretResponseSchema.parse(await rotated.json());
  expect(secret).not.toBe(created.secret);

  expect((await request.delete(`/api/webhooks/${id}`, { headers: owner.headers })).status()).toBe(
    204,
  );
  expect((await inventory(request, owner)).webhooks).toEqual([]);
});

test('webhooks deliver signed thin pokes for task, comment and structure writes @api', async ({
  request,
}) => {
  const account = await createAccount(request);
  const workspaceId = (await inventory(request, account)).workspaces[0]!.id;
  const project = await makeProject(request, account, workspaceId);
  const receiver = await startReceiver();
  try {
    const { secret, webhook } = await createWebhook(request, account, {
      workspaceId,
      projectId: project.id,
      name: 'Agent wake-up',
      url: receiver.url(),
    });

    const test_ = await request.post(`/api/webhooks/${webhook.id}/test`, {
      headers: account.headers,
    });
    expect(test_.status()).toBe(200);
    const tested = webhookTestResponseSchema.parse(await test_.json());
    expect(tested).toMatchObject({ ok: true, responseStatus: 204, error: null });
    expect(tested.webhook).toMatchObject({ lastDeliveryStatus: 'ok', lastResponseStatus: 204 });
    const ping = await receiver.next(({ payload }) => payload.event === 'webhook.test');
    expectSigned(ping, secret);
    expect(ping.payload).toMatchObject({
      deliveryId: tested.deliveryId,
      workspaceId,
      projectId: project.id,
      projectKey: 'HOOK',
      entityType: 'webhook',
      kind: 'test',
      actor: { kind: 'user' },
    });

    const backlog = project.statuses.find((status) => status.category === 'backlog')!;
    const done = project.statuses.find((status) => status.category === 'done')!;
    const taskId = randomUUID();
    expect(
      (
        await request.post('/api/tasks', {
          headers: account.headers,
          data: {
            id: taskId,
            projectId: project.id,
            title: 'Wake the agent',
            description: null,
            descriptionVersion: null,
            position: 'a0',
            parentId: null,
            statusId: backlog.id,
          },
        })
      ).status(),
    ).toBe(201);
    const created = await receiver.next(({ payload }) => payload.event === 'task.created');
    expectSigned(created, secret);
    expect(created.payload).toMatchObject({
      entityType: 'task',
      kind: 'created',
      taskId,
      taskKey: 'HOOK-1',
      projectKey: 'HOOK',
      statusTo: { id: backlog.id, category: 'backlog' },
    });
    // Thin: the title and description stay behind list_changes.
    expect(created.body).not.toContain('Wake the agent');

    // A device's reorder alone announces nothing; the move after it does.
    const before = receiver.received.length;
    const reorder = await request.patch(`/api/tasks/${taskId}`, {
      headers: account.headers,
      data: {
        changeId: randomUUID(),
        changes: {
          position: { after: 'a1', statusId: backlog.id, priority: 2, parentId: null },
        },
      },
    });
    expect(reorder.status(), await reorder.text()).toBe(200);
    expect(
      (
        await request.patch(`/api/tasks/${taskId}`, {
          headers: account.headers,
          data: {
            changeId: randomUUID(),
            changes: { statusId: { before: backlog.id, after: done.id } },
          },
        })
      ).status(),
    ).toBe(200);
    const moved = await receiver.next(({ payload }) => payload.event === 'task.updated', before);
    expect(receiver.received.slice(before)[0]).toBe(moved);
    expectSigned(moved, secret);
    expect(moved.payload).toMatchObject({
      kind: 'updated',
      taskKey: 'HOOK-1',
      changedFields: ['statusId'],
      statusTo: { id: done.id, name: done.name, category: 'done' },
      actor: { kind: 'user', viaTokenName: null },
    });

    const commentId = randomUUID();
    expect(
      (
        await request.post('/api/comments', {
          headers: account.headers,
          data: { id: commentId, taskId, body: paragraph('Private note') },
        })
      ).status(),
    ).toBe(201);
    const commented = await receiver.next(({ payload }) => payload.event === 'comment.created');
    expectSigned(commented, secret);
    expect(commented.payload).toMatchObject({ entityType: 'comment', taskKey: 'HOOK-1' });
    expect(commented.body).not.toContain('Private note');

    expect(
      (
        await request.patch(`/api/projects/${project.id}`, {
          headers: account.headers,
          data: { name: 'Hooked again' },
        })
      ).status(),
    ).toBe(200);
    const structure = await receiver.next(({ payload }) => payload.event === 'structure.updated');
    expectSigned(structure, secret);
    expect(structure.payload).toMatchObject({
      entityType: 'project',
      kind: 'updated',
      projectId: project.id,
      changedFields: ['project.name'],
    });

    // MCP writes are skipped while the webhook ignores token writes.
    const tokenResponse = await request.post('/api/mcp-tokens', {
      headers: account.headers,
      data: { name: 'Queue agent', workspaceId },
    });
    const { token } = createMcpTokenResponseSchema.parse(await tokenResponse.json());
    const client = new Client({ name: 'Throw webhook test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('/api/mcp', test.info().project.use.baseURL), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    try {
      const skipped = receiver.received.length;
      const ignored = await client.callTool({
        name: 'add_comment',
        arguments: { task: 'HOOK-1', body: 'From the agent' },
      });
      expect(ignored.isError).not.toBe(true);
      // The next device write is announced first, so the agent's was never queued.
      expect(
        (
          await request.post('/api/comments', {
            headers: account.headers,
            data: { id: randomUUID(), taskId, body: paragraph('Second note') },
          })
        ).status(),
      ).toBe(201);
      const next = await receiver.next(() => true, skipped);
      expect(next.payload.actor.kind).toBe('user');

      expect(
        (
          await request.patch(`/api/webhooks/${webhook.id}`, {
            headers: account.headers,
            data: { ignoreTokenWrites: false },
          })
        ).status(),
      ).toBe(200);
      const followed = await client.callTool({
        name: 'add_comment',
        arguments: { task: 'HOOK-1', body: 'Agent again' },
      });
      expect(followed.isError).not.toBe(true);
      const agent = await receiver.next(
        ({ payload }) => payload.event === 'comment.created' && payload.actor.kind === 'token',
      );
      expectSigned(agent, secret);
      expect(agent.payload.actor).toEqual({ kind: 'token', viaTokenName: 'Queue agent' });
    } finally {
      await client.close();
    }

    // Purging a parent announces its subtasks, which go with it.
    const subtaskId = randomUUID();
    expect(
      (
        await request.post('/api/tasks', {
          headers: account.headers,
          data: {
            id: subtaskId,
            projectId: project.id,
            title: 'Follow up',
            description: null,
            descriptionVersion: null,
            position: 'a0',
            parentId: taskId,
          },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await request.patch(`/api/tasks/${taskId}`, {
          headers: account.headers,
          data: { changeId: randomUUID(), changes: { trashed: { before: false, after: true } } },
        })
      ).status(),
    ).toBe(200);
    const purging = receiver.received.length;
    expect(
      (await request.delete(`/api/tasks/${taskId}`, { headers: account.headers })).status(),
    ).toBe(200);
    for (const id of [taskId, subtaskId])
      expect(
        (
          await receiver.next(
            ({ payload }) => payload.event === 'task.deleted' && payload.taskId === id,
            purging,
          )
        ).payload.kind,
      ).toBe('deleted');

    // A project webhook ignores the rest of the workspace.
    const other = await makeProject(request, account, workspaceId);
    const quiet = receiver.received.length;
    await request.patch(`/api/projects/${other.id}`, {
      headers: account.headers,
      data: { name: 'Elsewhere' },
    });
    await request.patch(`/api/projects/${project.id}`, {
      headers: account.headers,
      data: { name: 'Hooked once more' },
    });
    const after = await receiver.next(() => true, quiet);
    expect(after.payload.projectId).toBe(project.id);
  } finally {
    await receiver.close();
  }
});

test('a quiet window folds a burst into one notice and drops what was undone @api', async ({
  request,
}) => {
  const account = await createAccount(request);
  const listed = await inventory(request, account);
  expect(listed.quietWindow).toBe(true);
  const workspaceId = listed.workspaces[0]!.id;
  const project = await makeProject(request, account, workspaceId);
  const backlog = project.statuses.find((status) => status.category === 'backlog')!;
  const done = project.statuses.find((status) => status.category === 'done')!;
  const receiver = await startReceiver();
  const window = 2;
  const createTask = async (title: string) => {
    const id = randomUUID();
    const response = await request.post('/api/tasks', {
      headers: account.headers,
      data: {
        id,
        projectId: project.id,
        title,
        description: null,
        descriptionVersion: null,
        position: 'a0',
        parentId: null,
        statusId: backlog.id,
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    return id;
  };
  const change = async (id: string, changes: Record<string, unknown>) => {
    const response = await request.patch(`/api/tasks/${id}`, {
      headers: account.headers,
      data: { changeId: randomUUID(), changes },
    });
    expect(response.status(), await response.text()).toBe(200);
  };
  /**
   * Waits for a task created now, with the same window, to be announced. The worker claims
   * deliveries in the order they fall due and sends each batch before claiming the next, so
   * by then anything queued earlier that was going to be sent has been.
   */
  const sentinel = async () => {
    const id = await createTask('Sentinel');
    await receiver.next(({ payload }) => payload.event === 'task.created' && payload.taskId === id);
  };
  const about = (taskId: string) =>
    receiver.received.filter((hook) => hook.payload.taskId === taskId);
  try {
    expect(
      (
        await request.post('/api/webhooks', {
          headers: account.headers,
          data: { workspaceId, name: 'Too slow', url: receiver.url(), quietWindowSeconds: 601 },
        })
      ).status(),
    ).toBe(400);
    const { secret, webhook } = await createWebhook(request, account, {
      workspaceId,
      projectId: project.id,
      name: 'Patient agent',
      url: receiver.url(),
      quietWindowSeconds: window,
    });
    expect(webhook.quietWindowSeconds).toBe(window);
    expect((await inventory(request, account)).webhooks[0]!.quietWindowSeconds).toBe(window);

    // A burst of edits to a new task is one `task.created`, sent once it goes quiet.
    const started = Date.now();
    const named = await createTask('Wake the agent');
    await change(named, { title: { before: 'Wake the agent', after: 'Wake the agent gently' } });
    await change(named, { priority: { before: 3, after: 2 } });
    // A blank `+` stays quiet until someone names it, and one made by mistake never speaks.
    const blank = await createTask('New task');
    const mistake = await createTask('Oops');
    await change(mistake, { trashed: { before: false, after: true } });
    const created = await receiver.next(
      ({ payload }) => payload.event === 'task.created' && payload.taskId === named,
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(window * 1000);
    expectSigned(created, secret);
    expect(created.payload).toMatchObject({
      kind: 'created',
      changedFields: ['title', 'statusId', 'priority'],
      statusTo: { id: backlog.id },
    });
    expect(created.body).not.toContain('Wake the agent');
    await sentinel();
    expect(about(named)).toHaveLength(1);
    expect(about(blank)).toHaveLength(0);
    expect(about(mistake)).toHaveLength(0);

    // Purging the mistake has nothing left to announce. Naming the blank task announces it.
    expect(
      (await request.delete(`/api/tasks/${mistake}`, { headers: account.headers })).status(),
    ).toBe(200);
    await change(blank, { title: { before: 'New task', after: 'Write the notes' } });
    // Done by mistake and moved back sends nothing; the priority change beside it stands.
    await change(named, { statusId: { before: backlog.id, after: done.id } });
    await change(named, { priority: { before: 2, after: 1 } });
    await change(named, { statusId: { before: done.id, after: backlog.id } });
    const announced = await receiver.next(
      ({ payload }) => payload.event === 'task.created' && payload.taskId === blank,
    );
    expect(announced.payload.changedFields).toEqual(['title', 'statusId', 'priority']);
    const updated = await receiver.next(
      ({ payload }) => payload.event === 'task.updated' && payload.taskId === named,
    );
    expect(updated.payload).toMatchObject({ kind: 'updated', changedFields: ['priority'] });
    expect(updated.payload).not.toHaveProperty('statusTo');
    await sentinel();
    expect(about(mistake)).toHaveLength(0);
    expect(about(named)).toHaveLength(2);

    await change(named, { statusId: { before: backlog.id, after: done.id } });
    await change(named, { statusId: { before: done.id, after: backlog.id } });
    await sentinel();
    expect(about(named)).toHaveLength(2);

    // A comment is sent at once, ahead of the edit still waiting out its window.
    const before = receiver.received.length;
    await change(named, { title: { before: 'Wake the agent gently', after: 'Wake it' } });
    expect(
      (
        await request.post('/api/comments', {
          headers: account.headers,
          data: { id: randomUUID(), taskId: named, body: paragraph('Ready for you') },
        })
      ).status(),
    ).toBe(201);
    const first = await receiver.next(() => true, before);
    expect(first.payload.event).toBe('comment.created');
    expect(
      (await receiver.next(({ payload }) => payload.event === 'task.updated', before)).payload
        .changedFields,
    ).toEqual(['title']);

    // Shortening the window applies to a delivery already waiting.
    const patched = await request.patch(`/api/webhooks/${webhook.id}`, {
      headers: account.headers,
      data: { quietWindowSeconds: 600 },
    });
    expect(webhookResponseSchema.parse(await patched.json()).webhook.quietWindowSeconds).toBe(600);
    const waiting = receiver.received.length;
    await change(named, { title: { before: 'Wake it', after: 'Wake it now' } });
    // A comment is sent at once: by the time it arrives, an edit sent at once would have too.
    expect(
      (
        await request.post('/api/comments', {
          headers: account.headers,
          data: { id: randomUUID(), taskId: named, body: paragraph('Still there?') },
        })
      ).status(),
    ).toBe(201);
    await receiver.next(({ payload }) => payload.event === 'comment.created', waiting);
    expect(receiver.received.slice(waiting).map(({ payload }) => payload.event)).toEqual([
      'comment.created',
    ]);
    expect(
      (
        await request.patch(`/api/webhooks/${webhook.id}`, {
          headers: account.headers,
          data: { quietWindowSeconds: 0 },
        })
      ).status(),
    ).toBe(200);
    const flushed = await receiver.next(({ payload }) => payload.event === 'task.updated', waiting);
    expect(flushed.payload.changedFields).toEqual(['title']);
  } finally {
    await receiver.close();
  }
});

test('a failing receiver is retried, reported and stops when the owner leaves @api', async ({
  request,
}) => {
  const account = await createAccount(request);
  const workspaceId = (await inventory(request, account)).workspaces[0]!.id;
  const receiver = await startReceiver();
  try {
    const { webhook } = await createWebhook(request, account, {
      workspaceId,
      name: 'Flaky',
      url: receiver.url('/status/500'),
    });
    const response = await request.post(`/api/webhooks/${webhook.id}/test`, {
      headers: account.headers,
    });
    expect(webhookTestResponseSchema.parse(await response.json())).toMatchObject({
      ok: false,
      responseStatus: 500,
      error: 'The receiver answered HTTP 500',
      webhook: { lastDeliveryStatus: 'error', lastError: 'The receiver answered HTTP 500' },
    });

    await makeProject(request, account, workspaceId);
    const first = await receiver.next(({ payload }) => payload.event === 'structure.updated');
    // The project and its starter statuses are one announcement.
    expect(first.payload.changedFields).toEqual(
      expect.arrayContaining(['project.name', 'status.name']),
    );
    await expect
      .poll(async () => (await inventory(request, account)).webhooks[0]?.lastResponseStatus, {
        timeout: 20_000,
      })
      .toBe(500);
    // Retried after its back-off with the same delivery id.
    const retried = await receiver.next(
      ({ payload }) => payload.deliveryId === first.payload.deliveryId,
      receiver.received.indexOf(first) + 1,
    );
    expect(retried.body).toBe(first.body);
  } finally {
    await receiver.close();
  }
});
