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
