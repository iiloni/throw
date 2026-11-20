import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { type McpOutput, type McpToolName, mcpTools } from '../packages/shared/src/mcp';
import {
  createMcpTokenResponseSchema,
  mcpTokensResponseSchema,
} from '../packages/shared/src/mcpTokens';
import { STARTER_STATUSES } from '../packages/shared/src/statuses';
import { createAccount, shapeRows } from './helpers';

const endpoint = () => new URL('/api/mcp', test.info().project.use.baseURL);
type Account = Awaited<ReturnType<typeof createAccount>>;

async function makeToken(request: APIRequestContext, account: Account, workspaceId?: string) {
  if (!workspaceId) {
    const list = await request.get('/api/mcp-tokens', { headers: account.headers });
    expect(list.status()).toBe(200);
    workspaceId = mcpTokensResponseSchema.parse(await list.json()).workspaces[0]!.id;
  }
  const response = await request.post('/api/mcp-tokens', {
    headers: account.headers,
    data: { name: 'Queue agent', workspaceId },
  });
  expect(response.status()).toBe(201);
  expect(response.headers()['cache-control']).toBe('no-store');
  return createMcpTokenResponseSchema.parse(await response.json());
}

async function makeProject(request: APIRequestContext, account: Account, workspaceId: string) {
  const project = {
    id: randomUUID(),
    workspaceId,
    name: 'Agent work',
    key: 'THR',
    color: 'teal',
    icon: null,
    position: 'a0',
    statuses: STARTER_STATUSES.map((status) => ({
      ...status,
      id: randomUUID(),
      position: 'a0',
      isDefault: true,
    })),
  };
  expect(
    (await request.post('/api/projects', { data: project, headers: account.headers })).status(),
  ).toBe(201);
  return project;
}

async function connect(token: string) {
  const client = new Client({ name: 'Throw test agent', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(endpoint(), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

async function call<T extends McpToolName>(
  client: Client,
  name: T,
  args: Record<string, unknown> = {},
): Promise<McpOutput<T>> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  return mcpTools[name].output.parse(result.structuredContent) as McpOutput<T>;
}

test('MCP authenticates only its own tokens and revocation applies to an initialized client @api', async ({
  request,
}) => {
  const account = await createAccount(request);
  const item = await makeToken(request, account);
  const headers = { Authorization: `Bearer ${item.token}` };

  for (const credentials of [{}, account.headers, { Authorization: 'Bearer invalid' }]) {
    const response = await fetch(endpoint(), { method: 'POST', headers: credentials });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Bearer');
  }
  expect(
    (
      await fetch(endpoint(), {
        method: 'POST',
        headers: { ...headers, Origin: 'https://example.com' },
      })
    ).status,
  ).toBe(403);
  const preflight = await fetch(endpoint(), {
    method: 'OPTIONS',
    headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'POST' },
  });
  expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
  const unsupportedMethod = await fetch(endpoint(), { method: 'GET', headers });
  expect(unsupportedMethod.status).toBe(405);
  expect(unsupportedMethod.headers.get('allow')).toBe('POST');
  const payload = new Uint8Array(1024 * 1024 + 1);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(payload);
      controller.close();
    },
  });
  const chunked: RequestInit & { duplex: 'half' } = {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: stream,
    duplex: 'half',
  };
  expect((await fetch(endpoint(), { ...chunked, body: payload })).status).toBe(413);
  expect((await fetch(endpoint(), chunked)).status).toBe(413);

  expect(
    (
      await fetch(new URL('/api/mcp-tokens', endpoint()), {
        headers: { ...headers, 'X-Throw-Protocol': '1' },
      })
    ).status,
  ).toBe(401);
  const listed = await request.get('/api/mcp-tokens', { headers: account.headers });
  const text = await listed.text();
  expect(text).not.toContain(item.token);
  expect(text).not.toContain('digest');
  expect(mcpTokensResponseSchema.parse(JSON.parse(text)).tokens).toEqual([item.metadata]);

  const client = await connect(item.token);
  try {
    expect((await call(client, 'list_workspaces')).items).toEqual([
      { id: item.metadata.workspaceId, name: 'Personal' },
    ]);
    const revoked = await request.delete(`/api/mcp-tokens/${item.metadata.id}`, {
      headers: account.headers,
    });
    expect(revoked.status()).toBe(204);
    await expect(client.listTools()).rejects.toMatchObject({ code: 401 });
  } finally {
    await client.close();
  }
});

test('an MCP token is limited to one workspace, including against UUIDs from another user @api', async ({
  request,
}) => {
  const owner = await createAccount(request);
  const stranger = await createAccount(request);
  const credential = await makeToken(request, owner);
  const strangerCredential = await makeToken(request, stranger);
  const own = await makeProject(request, owner, credential.metadata.workspaceId);
  const foreign = await makeProject(request, stranger, strangerCredential.metadata.workspaceId);

  const extraId = randomUUID();
  expect(
    (
      await request.post('/api/workspaces', {
        headers: owner.headers,
        data: { id: extraId, name: 'Private work', position: 'a1' },
      })
    ).status(),
  ).toBe(201);
  const extra = await makeProject(request, owner, extraId);
  const invalidToken = await request.post('/api/mcp-tokens', {
    headers: owner.headers,
    data: { name: 'Foreign', workspaceId: strangerCredential.metadata.workspaceId },
  });
  expect(invalidToken.status()).toBe(404);
  expect(
    (
      await request.delete(`/api/mcp-tokens/${strangerCredential.metadata.id}`, {
        headers: owner.headers,
      })
    ).status(),
  ).toBe(204);

  const client = await connect(credential.token);
  const other = await connect(strangerCredential.token);
  try {
    const foreignTask = await call(other, 'create_task', {
      projectId: foreign.id,
      title: 'Private task',
    });
    const ownTask = await call(client, 'create_task', { projectId: own.id, title: 'Scoped task' });
    expect((await call(client, 'list_projects')).items.map(({ id }) => id)).toEqual([own.id]);
    expect((await call(client, 'list_tasks')).items.map(({ id }) => id)).toEqual([ownTask.task.id]);
    expect((await call(client, 'get_task', { task: foreignTask.task.key })).task.id).toBe(
      ownTask.task.id,
    );
    for (const [name, args] of [
      ['get_task', { task: foreignTask.task.id }],
      ['list_statuses', { projectId: foreign.id }],
      ['create_task', { projectId: foreign.id, title: 'No access' }],
      ['create_task', { projectId: extra.id, title: 'Outside token scope' }],
      ['add_comment', { task: foreignTask.task.id, body: 'No access' }],
    ] as const) {
      expect((await client.callTool({ name, arguments: args })).isError).toBe(true);
    }
  } finally {
    await Promise.all([client.close(), other.close()]);
  }
});

test('MCP task writes use project numbering, conflict rules and live attributed shapes @api', async ({
  request,
}) => {
  const account = await createAccount(request);
  const credential = await makeToken(request, account);
  const project = await makeProject(request, account, credential.metadata.workspaceId);
  const client = await connect(credential.token);

  try {
    expect((await client.listTools()).tools.map(({ name }) => name).sort()).toEqual(
      Object.keys(mcpTools).sort(),
    );
    expect(await shapeRows(request, 'tasks', account.headers)).toEqual([]);
    const args = {
      projectId: project.id,
      title: 'Route the work',
      description: '## Queue\n\n[Review](https://example.com/pull/1) after **delivery**.',
    };
    const created = await call(client, 'create_task', args);
    const replay = await call(client, 'create_task', { ...args, operationId: created.operationId });
    expect(replay).toEqual(created);
    expect(created.task.key).toBe('THR-1');
    await expect
      .poll(async () =>
        (await shapeRows(request, 'tasks', account.headers)).find(
          ({ id }) => id === created.task.id,
        ),
      )
      .toMatchObject({ title: 'Route the work', number: '1' });
    await expect
      .poll(async () =>
        (await shapeRows(request, 'task_activity', account.headers)).find(
          ({ task_id }) => task_id === created.task.id,
        ),
      )
      .toMatchObject({ kind: 'created', via_token_name: 'Queue agent', user_id: account.user.id });

    const sibling = await call(client, 'create_task', {
      projectId: project.id,
      title: 'Position anchor',
    });
    const subtask = await call(client, 'create_task', {
      projectId: project.id,
      parent: created.task.key,
      title: 'Follow up',
    });
    expect(subtask.task.key).toBe('THR-3');
    const statusPage = await call(client, 'list_statuses', { projectId: project.id, limit: 2 });
    expect(statusPage.nextCursor).toBeTruthy();
    expect(
      (
        await call(client, 'list_statuses', {
          projectId: project.id,
          cursor: statusPage.nextCursor,
          limit: 2,
        })
      ).items,
    ).toHaveLength(2);
    const parent = await call(client, 'get_task', { task: created.task.key });
    expect(parent.task.description).toEqual({
      markdown: expect.stringContaining('https://example.com/pull/1'),
      lossy: false,
    });
    expect(parent.subtasks.items.map(({ id }) => id)).toEqual([subtask.task.id]);
    expect(
      (await call(client, 'list_tasks', { query: 'delivery' })).items.map(({ id }) => id),
    ).toEqual([created.task.id]);

    const rootTagId = randomUUID();
    const nestedTagId = randomUUID();
    for (const data of [
      { id: rootTagId, parentId: null, name: 'Team' },
      { id: nestedTagId, parentId: rootTagId, name: 'Queue' },
    ]) {
      const response = await request.post('/api/tags', {
        headers: account.headers,
        data: { ...data, projectId: project.id, color: null, icon: null },
      });
      expect(response.status()).toBe(201);
    }
    expect(
      (await call(client, 'list_tags', { projectId: project.id })).items.find(
        ({ id }) => id === nestedTagId,
      )?.path,
    ).toEqual(['Team', 'Queue']);
    await call(client, 'set_task_tags', {
      task: created.task.id,
      primaryTagId: { before: null, after: nestedTagId },
      secondaryTags: [{ tagId: rootTagId, present: true }],
    });
    expect(
      (await call(client, 'list_tasks', { tagId: rootTagId })).items.map(({ id }) => id),
    ).toEqual([created.task.id]);

    const update = await call(client, 'update_task', {
      task: created.task.key,
      changes: {
        title: { before: 'Out of date', after: 'Refused' },
        description: { before: parent.task.descriptionVersion, after: 'Revised **queue**' },
      },
    });
    expect(update.changes).toEqual([
      expect.objectContaining({ field: 'title', reason: 'stale', applied: false }),
      expect.objectContaining({ field: 'description', applied: true }),
    ]);
    const reordered = await call(client, 'move_task', {
      task: created.task.key,
      before: { statusId: parent.task.statusId, priority: parent.task.priority, parentId: null },
      placement: { side: 'before', neighbor: sibling.task.key },
    });
    expect(reordered.changes).toEqual([
      expect.objectContaining({ field: 'position', applied: true }),
    ]);
    const active = project.statuses.find(({ category }) => category === 'active')!;
    const moved = await call(client, 'move_task', {
      task: created.task.key,
      before: { statusId: parent.task.statusId, priority: parent.task.priority, parentId: null },
      statusId: active.id,
    });
    expect(moved.changes[0]).toMatchObject({
      field: 'statusId',
      applied: true,
      requested: active.id,
    });

    const posted = await call(client, 'add_comment', {
      task: created.task.id,
      body: 'Ready for **review**.',
    });
    await expect
      .poll(async () =>
        (await shapeRows(request, 'comments', account.headers)).find(
          ({ id }) => id === posted.commentId,
        ),
      )
      .toMatchObject({ via_token_name: 'Queue agent' });
    const details = await call(client, 'get_task', {
      task: created.task.key,
      history: { limit: 1 },
    });
    expect(details.task).toMatchObject({
      title: 'Route the work',
      statusId: active.id,
      secondaryTagIds: [rootTagId],
    });
    expect(details.comments.items[0]).toMatchObject({
      id: posted.commentId,
      viaTokenName: 'Queue agent',
    });
    const next = await call(client, 'get_task', {
      task: created.task.key,
      history: { cursor: details.history.nextCursor, limit: 1 },
    });
    expect(next.history.items[0]).toMatchObject({
      viaTokenName: 'Queue agent',
      changes: reordered.changes,
    });

    await call(client, 'update_task', {
      task: created.task.id,
      changes: { trashed: { before: false, after: true } },
    });
    expect(
      (await call(client, 'list_tasks', { projectId: project.id })).items.map(({ id }) => id),
    ).toEqual([sibling.task.id]);
    expect(
      (await call(client, 'list_tasks', { trash: 'trashed' })).items.map(({ id }) => id),
    ).toEqual(expect.arrayContaining([created.task.id, subtask.task.id]));
    await call(client, 'update_task', {
      task: created.task.id,
      changes: { trashed: { before: true, after: false } },
    });
    expect((await call(client, 'get_task', { task: created.task.id })).task.trashed).toBe(false);
  } finally {
    await client.close();
  }
});
