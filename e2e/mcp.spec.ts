import { execFileSync, spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type APIRequestContext, expect, type Route, test } from '@playwright/test';
import {
  changeCursorErrorSchema,
  type McpOutput,
  type McpToolName,
  mcpTools,
} from '../packages/shared/src/mcp';
import {
  createMcpTokenResponseSchema,
  mcpTokensResponseSchema,
} from '../packages/shared/src/mcpTokens';
import { STARTER_STATUSES } from '../packages/shared/src/statuses';
import { APP_LOAD_TIMEOUT, createAccount, shapeRows, signUp } from './helpers';

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
      // All test accounts share the runner's IP. The server rejects a 429 before dispatch.
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        const seconds = Number(response.headers.get('Retry-After'));
        if (response.status !== 429 || !(seconds > 0 && seconds <= 60)) return response;
        await response.body?.cancel();
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
        return fetch(input, init);
      },
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

test('MCP checks membership again when a credential still exists @api', async ({ request }) => {
  const account = await createAccount(request);
  const { token, metadata } = await makeToken(request, account);
  const client = await connect(token);
  try {
    expect((await call(client, 'list_workspaces')).items[0]?.id).toBe(metadata.workspaceId);
    // Membership management has no API yet. Remove it in this isolated worktree's database.
    const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
    execFileSync('./scripts/dev.sh', [
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `DELETE FROM workspace_members WHERE workspace_id = ${literal(metadata.workspaceId)} AND user_id = ${literal(account.user.id)}`,
    ]);
    await expect(client.listTools()).rejects.toMatchObject({ code: 401 });
    const inventory = await request.get('/api/mcp-tokens', { headers: account.headers });
    expect(mcpTokensResponseSchema.parse(await inventory.json()).tokens).toContainEqual(metadata);
  } finally {
    await client.close();
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

function structureId() {
  const time = Date.now().toString(16).padStart(12, '0');
  return `${time.slice(0, 8)}-${time.slice(8)}-7${randomUUID().slice(15)}`;
}

async function expectToolError(
  client: Client,
  name: McpToolName,
  args: Record<string, unknown>,
  message: string,
) {
  const result = await client.callTool({
    name,
    arguments: { operationId: structureId(), ...args },
  });
  expect(result.isError, JSON.stringify(result.content)).toBe(true);
  expect(JSON.stringify(result.content)).toContain(message);
}

test('MCP creates, edits and orders projects and replays concurrent or delayed requests @api', async ({
  request,
}) => {
  const account = await createAccount(request);
  const credential = await makeToken(request, account);
  const client = await connect(credential.token);
  try {
    const args = { operationId: structureId(), name: 'Roadmap', key: 'ROAD', color: 'teal' };
    const [first, retry] = await Promise.all([
      call(client, 'create_project', args),
      call(client, 'create_project', args),
    ]);
    expect(retry).toEqual(first);
    const project = first.current;
    const other = (
      await call(client, 'create_project', {
        operationId: structureId(),
        name: 'Other',
        key: 'ROAD',
      })
    ).current;
    expect(other.key).toBe('ROAD2');
    expect(project.position < other.position).toBe(true);

    const projectId = project.id;
    const starters = (await call(client, 'list_statuses', { projectId })).items;
    expect(starters.map(({ category, isDefault }) => [category, isDefault]).sort()).toEqual(
      STARTER_STATUSES.map(({ category }) => [category, true]).sort(),
    );
    const task = (await call(client, 'create_task', { projectId, title: 'Milestone' })).task;
    expect(task.key).toBe('ROAD-1');
    await expectToolError(
      client,
      'update_project',
      {
        projectId,
        changes: { key: { before: 'ROAD', after: 'ROAD2' } },
      },
      'Another project has this key',
    );
    const update = {
      operationId: structureId(),
      projectId,
      changes: {
        name: { before: project.name, after: 'Release roadmap' },
        key: { before: project.key, after: 'SHIP' },
        icon: { before: null, after: 'rocket' },
        color: { before: 'teal', after: 'amber' },
        priorityNames: { before: project.priorityNames, after: ['Now', '', '', '', ''] },
      },
    };
    const updated = await call(client, 'update_project', update);
    expect(updated.current).toMatchObject({
      name: 'Release roadmap',
      key: 'SHIP',
      color: 'amber',
      icon: 'rocket',
      priorityNames: ['Now', '', '', '', ''],
    });
    expect((await call(client, 'get_task', { task: task.id })).task.key).toBe('SHIP-1');
    expect(
      (await client.callTool({ name: 'get_task', arguments: { task: 'ROAD-1' } })).isError,
    ).toBe(true);

    const moved = await call(client, 'move_project', {
      operationId: structureId(),
      projectId,
      before: { position: project.position },
      placement: { side: 'after', neighborId: other.id },
    });
    expect(moved.current.position > other.position).toBe(true);
    expect((await call(client, 'list_projects')).items.find(({ id }) => id === projectId)).toEqual(
      moved.current,
    );
    const restored = await call(client, 'move_project', {
      operationId: structureId(),
      projectId,
      before: { position: moved.current.position },
      placement: { side: 'before', neighborId: other.id },
    });
    expect(restored.current.position).toBe(project.position);

    expect(
      (
        await request.patch(`/api/projects/${projectId}`, {
          headers: account.headers,
          data: { name: project.name },
        })
      ).status(),
    ).toBe(200);
    expect(await call(client, 'update_project', update)).toEqual(updated);
    expect(await call(client, 'create_project', args)).toEqual(first);
    await expectToolError(client, 'create_project', { ...args, name: 'Different' }, 'already used');
    expect(
      (await call(client, 'list_projects')).items.find(({ id }) => id === projectId)?.name,
    ).toBe(project.name);

    const stale = await call(client, 'update_project', {
      operationId: structureId(),
      projectId,
      changes: {
        name: { before: 'Release roadmap', after: 'Stale rename' },
        color: { before: 'amber', after: 'red' },
      },
    });
    expect(stale).toMatchObject({
      outcome: 'conflict',
      conflicts: ['name'],
      current: { name: project.name, color: 'amber' },
    });
    const history = (await call(client, 'get_task', { task: task.id })).history.items;
    expect(history.map(({ kind, viaTokenName }) => [kind, viaTokenName])).toEqual([
      ['created', 'Queue agent'],
    ]);
  } finally {
    await client.close();
  }
});

test('MCP status and tag writes enforce category, hierarchy and workspace boundaries @api', async ({
  request,
}) => {
  const owner = await createAccount(request);
  const stranger = await createAccount(request);
  const credential = await makeToken(request, owner);
  const otherCredential = await makeToken(request, stranger);
  const own = await makeProject(request, owner, credential.metadata.workspaceId);
  const foreign = await makeProject(request, stranger, otherCredential.metadata.workspaceId);
  const extraId = randomUUID();
  expect(
    (
      await request.post('/api/workspaces', {
        headers: owner.headers,
        data: { id: extraId, name: 'Other workspace', position: 'a1' },
      })
    ).status(),
  ).toBe(201);
  const extra = await makeProject(request, owner, extraId);
  const client = await connect(credential.token);

  try {
    const initialDefault = own.statuses.find(({ category }) => category === 'active')!;
    const created = (
      await call(client, 'create_status', {
        operationId: structureId(),
        projectId: own.id,
        category: 'active',
        name: 'Verify',
      })
    ).current;
    const later = (
      await call(client, 'create_status', {
        operationId: structureId(),
        projectId: own.id,
        category: 'active',
        name: 'Review',
      })
    ).current;
    expect(created).toMatchObject({ isDefault: false, defaultStatusId: initialDefault.id });
    expect(created.position > initialDefault.position).toBe(true);
    expect(
      (
        await request.patch(`/api/statuses/${later.id}`, {
          headers: owner.headers,
          data: { isDefault: true },
        })
      ).status(),
    ).toBe(200);
    const changeDefault = {
      operationId: structureId(),
      statusId: created.id,
      changes: { defaultStatusId: { before: initialDefault.id, after: created.id } },
    };
    expect(await call(client, 'update_status', changeDefault)).toMatchObject({
      outcome: 'conflict',
      conflicts: ['defaultStatusId'],
      current: { defaultStatusId: later.id },
    });
    const renamed = await call(client, 'update_status', {
      ...changeDefault,
      operationId: structureId(),
      changes: {
        name: { before: 'Verify', after: 'Testing' },
        defaultStatusId: { before: later.id, after: created.id },
      },
    });
    expect(renamed.current).toMatchObject({
      name: 'Testing',
      isDefault: true,
      defaultStatusId: created.id,
    });
    await expectToolError(
      client,
      'update_status',
      {
        statusId: created.id,
        changes: { defaultStatusId: { before: created.id, after: initialDefault.id } },
      },
      'Set defaultStatusId.after',
    );
    const moved = await call(client, 'move_status', {
      operationId: structureId(),
      statusId: created.id,
      before: { position: created.position },
      placement: { side: 'before', neighborId: initialDefault.id },
    });
    expect(moved.current.position < initialDefault.position).toBe(true);
    await expectToolError(
      client,
      'move_status',
      {
        statusId: created.id,
        before: { position: moved.current.position },
        placement: {
          side: 'before',
          neighborId: own.statuses.find(({ category }) => category === 'done')!.id,
        },
      },
      'same project and category',
    );
    const statuses = (await call(client, 'list_statuses', { projectId: own.id })).items;
    expect(statuses.filter(({ isDefault }) => isDefault)).toHaveLength(4);
    expect(
      statuses
        .filter(({ isDefault, category }) => isDefault && category === 'active')
        .map(({ id }) => id),
    ).toEqual([created.id]);

    const makeTag = async (name: string, fields: Record<string, unknown> = {}) =>
      (
        await call(client, 'create_tag', {
          operationId: structureId(),
          projectId: own.id,
          name,
          ...fields,
        })
      ).current;
    const root = await makeTag('Team', { color: 'teal', icon: 'rocket' });
    await expectToolError(
      client,
      'create_tag',
      { projectId: own.id, name: 'Duplicate color', color: 'teal' },
      'already linked',
    );
    await expectToolError(
      client,
      'create_tag',
      { projectId: own.id, name: 'Colored child', parentId: root.id, color: 'red' },
      'Only top-level tags',
    );
    const child = await makeTag('Queue', { parentId: root.id });
    const sibling = await makeTag('Backlog', { parentId: root.id });
    const leaf = await makeTag('Mobile', { color: 'amber', icon: 'heart' });
    await expectToolError(
      client,
      'update_tag',
      {
        tagId: root.id,
        changes: { parentId: { before: null, after: child.id } },
      },
      'own branch',
    );
    await expectToolError(
      client,
      'update_tag',
      {
        tagId: leaf.id,
        changes: { parentId: { before: null, after: child.id } },
      },
      'Only top-level tags',
    );
    const nested = await call(client, 'update_tag', {
      operationId: structureId(),
      tagId: leaf.id,
      changes: {
        name: { before: 'Mobile', after: 'App' },
        parentId: { before: null, after: child.id },
        color: { before: 'amber', after: null },
        icon: { before: 'heart', after: null },
      },
    });
    expect(nested.current).toMatchObject({
      name: 'App',
      parentId: child.id,
      color: null,
      icon: null,
    });
    const move = {
      operationId: structureId(),
      tagId: child.id,
      before: { parentId: root.id, position: null },
      placement: { side: 'before', neighborId: sibling.id },
    };
    const movedTag = await call(client, 'move_tag', move);
    expect(await call(client, 'move_tag', move)).toEqual(movedTag);
    const items = (await call(client, 'list_tags', { projectId: own.id })).items;
    expect(items.find(({ id }) => id === leaf.id)?.path).toEqual(['Team', 'Queue', 'App']);
    expect(items.find(({ id }) => id === sibling.id)!.position! > movedTag.current.position!).toBe(
      true,
    );
    await expect
      .poll(
        async () =>
          (await shapeRows(request, 'tags', owner.headers)).find((row) => row.id === child.id)
            ?.position,
      )
      .toBe(movedTag.current.position);

    const foreignTagId = randomUUID();
    expect(
      (
        await request.post('/api/tags', {
          headers: stranger.headers,
          data: {
            id: foreignTagId,
            projectId: foreign.id,
            name: 'Private',
            color: null,
            icon: null,
            parentId: null,
          },
        })
      ).status(),
    ).toBe(201);
    await expectToolError(
      client,
      'update_tag',
      {
        tagId: foreignTagId,
        changes: { name: { before: 'Private', after: 'Leaked' } },
      },
      'Tag not found',
    );
    await expectToolError(
      client,
      'create_tag',
      { projectId: own.id, name: 'Child', parentId: foreignTagId },
      'Parent tag not in this project',
    );
    for (const project of [foreign, extra]) {
      await expectToolError(
        client,
        'update_project',
        {
          projectId: project.id,
          changes: { name: { before: project.name, after: 'Leaked' } },
        },
        'Project not found',
      );
      await expectToolError(
        client,
        'create_status',
        { projectId: project.id, name: 'Hidden', category: 'active' },
        'Project not found',
      );
      await expectToolError(
        client,
        'create_tag',
        { projectId: project.id, name: 'Hidden' },
        'Project not found',
      );
      await expectToolError(
        client,
        'update_status',
        {
          statusId: project.statuses[0]!.id,
          changes: { name: { before: 'Backlog', after: 'Leaked' } },
        },
        'Status not found',
      );
    }
  } finally {
    await client.close();
  }
});

test('reparenting a manually ordered tag offline clears its position immediately and on replay', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Both layouts use the same tag action and outbox.');
  const account = await signUp(page);
  const credential = await makeToken(page.request, account);
  const project = await makeProject(page.request, account, credential.metadata.workspaceId);
  const client = await connect(credential.token);
  let tagId: string;
  let parentId: string;
  let originalPosition: string | null;
  try {
    const createRoot = async (name: string) =>
      (
        await call(client, 'create_tag', {
          projectId: project.id,
          name,
          operationId: structureId(),
        })
      ).current;
    const parent = await createRoot('Alpha');
    const tag = await createRoot('Zulu');
    parentId = parent.id;
    tagId = tag.id;
    const moved = await call(client, 'move_tag', {
      operationId: structureId(),
      tagId,
      before: { parentId: null, position: null },
      placement: { side: 'before', neighborId: parentId },
    });
    originalPosition = moved.current.position;
    expect(originalPosition).not.toBeNull();
  } finally {
    await client.close();
  }

  const localTag = () =>
    page.evaluate(async (id) => {
      const { tagsCollection } = await import(/* @vite-ignore */ '/src/lib/collections.ts');
      const tag = tagsCollection.get(id);
      return tag && { parentId: tag.parentId, position: tag.position };
    }, tagId);
  await expect.poll(localTag, { timeout: APP_LOAD_TIMEOUT }).toEqual({
    parentId: null,
    position: originalPosition,
  });
  const offline = (route: Route) => route.abort('connectionfailed');
  await page.route('**/api/**', offline);
  await page.evaluate(
    async ({ tagId, parentId }) => {
      const { updateTag } = await import(/* @vite-ignore */ '/src/lib/tags.ts');
      updateTag(tagId, { parentId });
    },
    { tagId, parentId },
  );
  await expect.poll(localTag).toEqual({ parentId, position: null });

  await page.unroute('**/api/**', offline);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect
    .poll(
      async () =>
        (await shapeRows(page.request, 'tags', account.headers)).find(({ id }) => id === tagId),
      { timeout: APP_LOAD_TIMEOUT },
    )
    .toMatchObject({ parent_id: parentId, position: null });
});

test('list_changes follows REST and MCP writes with stable pages and token attribution @api', async ({
  request,
}) => {
  const account = await createAccount(request);
  const credential = await makeToken(request, account);
  // These credentials deliberately have the same display name.
  const teammate = await makeToken(request, account);
  const foreign = await makeToken(request, await createAccount(request));
  const [client, other, stranger] = await Promise.all([
    connect(credential.token),
    connect(teammate.token),
    connect(foreign.token),
  ]);
  try {
    const after = new Date(Date.now() - 60_000).toISOString();
    const start = await call(client, 'list_changes');
    expect(start).toEqual({ changes: [], cursor: expect.stringMatching(/^v1\./), hasMore: false });

    await call(stranger, 'create_project', {
      operationId: structureId(),
      name: 'Outside the reader’s workspace',
    });
    const project = await makeProject(request, account, credential.metadata.workspaceId);
    const id = randomUUID();
    const { headers } = account;
    expect(
      (
        await request.patch(`/api/projects/${project.id}`, {
          headers,
          data: { name: 'Renamed project' },
        })
      ).status(),
    ).toBe(200);
    const statuses = await call(client, 'list_statuses', { projectId: project.id });
    const active = statuses.items.find(({ category }) => category === 'active')!;
    expect(
      (
        await request.post('/api/statuses', {
          headers,
          data: {
            id,
            projectId: project.id,
            category: 'active',
            name: 'Review',
            position: 'a1',
            isDefault: false,
          },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await request.patch(`/api/statuses/${id}`, {
          headers,
          data: { name: 'In review', isDefault: true },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await request.patch(`/api/statuses/${id}`, {
          headers,
          data: { position: 'a2' },
        })
      ).status(),
    ).toBe(200);

    const tag = await call(other, 'create_tag', {
      operationId: structureId(),
      projectId: project.id,
      name: 'Review notes',
    });
    const { task } = await call(other, 'create_task', {
      projectId: project.id,
      title: 'Review me',
    });
    await call(client, 'create_task', { projectId: project.id, title: 'Own write' });
    await call(other, 'update_task', {
      task: task.id,
      changes: { title: { before: 'Review me', after: 'Ready for review' } },
    });
    const beforeDrop = (await shapeRows(request, 'tasks', headers)).find(
      ({ id }) => id === task.id,
    )!;
    const dropId = randomUUID();
    expect(
      (
        await request.patch(`/api/tasks/${task.id}`, {
          headers,
          data: {
            changeId: dropId,
            changes: {
              statusId: { before: beforeDrop.status_id, after: active.id },
              priority: { before: 3, after: 2 },
              position: { after: 'a5', statusId: active.id, priority: 2, parentId: null },
            },
          },
        })
      ).status(),
    ).toBe(200);
    const afterDrop = await call(other, 'get_task', { task: task.id });
    expect(
      afterDrop.history.items.find(({ id }) => id === dropId)?.changes.map(({ field }) => field),
    ).toEqual(['statusId', 'priority']);
    for (const before of [false, true]) {
      await call(other, 'update_task', {
        task: task.id,
        changes: { trashed: { before, after: !before } },
      });
    }

    await call(other, 'update_task', {
      task: task.id,
      changes: { trashed: { before: false, after: false } },
    });
    const { commentId } = await call(other, 'add_comment', {
      task: task.id,
      body: 'Original comment',
    });
    expect(
      (
        await request.patch(`/api/comments/${commentId}`, {
          headers,
          data: {
            body: [{ type: 'paragraph', content: [{ type: 'text', text: 'Edited comment' }] }],
          },
        })
      ).status(),
    ).toBe(200);
    expect((await request.delete(`/api/comments/${commentId}`, { headers })).status()).toBe(200);
    expect((await request.delete(`/api/tags/${tag.current.id}`, { headers })).status()).toBe(200);

    const all = await call(client, 'list_changes', { since: start.cursor, limit: 50 });
    expect(all.hasMore).toBe(false);
    expect(all.changes.map(({ type, kind }) => `${type}:${kind}`)).toEqual([
      'project:created',
      'status:created',
      'status:created',
      'status:created',
      'status:created',
      'project:updated',
      'status:created',
      'status:updated',
      'status:updated',
      'status:reordered',
      'tag:created',
      'task:created',
      'task:updated',
      'task:moved',
      'task:trashed',
      'task:restored',
      'comment:created',
      'comment:updated',
      'comment:deleted',
      'tag:deleted',
    ]);
    expect(
      all.changes.find(({ type, kind }) => type === 'task' && kind === 'updated'),
    ).toMatchObject({
      entity: { id: task.id, taskKey: task.key, taskTitle: 'Ready for review' },
      actor: { userId: account.user.id, viaToken: 'Queue agent' },
      changes: [{ field: 'title', before: 'Review me', after: 'Ready for review' }],
    });
    expect(all.changes.find(({ id }) => id === dropId)).toMatchObject({
      kind: 'moved',
      changes: [
        { field: 'statusId', before: beforeDrop.status_id, after: active.id },
        { field: 'priority', before: 3, after: 2 },
        { field: 'position', before: beforeDrop.position, after: 'a5' },
      ],
    });
    expect(
      all.changes
        .filter(({ type }) => type === 'comment')
        .map(({ entity, changes }) => ({
          id: entity.id,
          before: changes[0]?.before,
          after: changes[0]?.after,
        })),
    ).toEqual([
      { id: commentId, before: null, after: { markdown: 'Original comment', lossy: false } },
      {
        id: commentId,
        before: { markdown: 'Original comment', lossy: false },
        after: { markdown: 'Edited comment', lossy: false },
      },
      { id: commentId, before: { markdown: 'Edited comment', lossy: false }, after: null },
    ]);

    let page = await call(client, 'list_changes', { since: start.cursor, limit: 3 });
    const paged = [...page.changes];
    expect(page.hasMore).toBe(true);
    for (let i = 0; page.hasMore && i < 20; i++) {
      page = await call(client, 'list_changes', { since: page.cursor, limit: 3 });
      paged.push(...page.changes);
    }
    expect(page.hasMore).toBe(false);
    expect(paged).toEqual(all.changes);
    expect((await call(client, 'list_changes', { since: page.cursor })).changes).toEqual([]);
    const includesOwn = await call(client, 'list_changes', {
      since: start.cursor,
      includeOwn: true,
      limit: 50,
    });
    expect(includesOwn.changes).toHaveLength(all.changes.length + 1);
    expect(
      includesOwn.changes.find(({ entity }) => entity.taskTitle === 'Own write')?.actor.viaToken,
    ).toBe('Queue agent');
    const offsetAfter = new Date(Date.parse(after) + 17 * 60 * 60 * 1000)
      .toISOString()
      .replace('Z', '+17:00');
    const catchUp = await call(client, 'list_changes', { since: { after: offsetAfter }, limit: 3 });
    expect(catchUp.hasMore).toBe(true);
    const rest = await call(client, 'list_changes', { since: catchUp.cursor, limit: 50 });
    expect([...catchUp.changes, ...rest.changes]).toEqual(all.changes);
    expect((await call(client, 'list_changes', { since: rest.cursor })).changes).toEqual([]);

    const badTime = await client.callTool({
      name: 'list_changes',
      arguments: { since: { after: '0000-01-01T00:00:00Z' } },
    });
    expect(badTime.isError).toBe(true);
    const cursorPayload = JSON.parse(Buffer.from(start.cursor.slice(3), 'base64url').toString());
    const future = `v1.${Buffer.from(
      JSON.stringify({
        ...cursorPayload,
        snapshot: '9223372036854775807:9223372036854775807:',
      }),
    ).toString('base64url')}`;
    for (const [reader, since] of [
      [stranger, start.cursor],
      [client, 'v2.invalid'],
      [client, future],
    ] as const) {
      const failed = await reader.callTool({ name: 'list_changes', arguments: { since } });
      expect(failed.isError).toBe(true);
      const reset = changeCursorErrorSchema.parse(failed.structuredContent);
      expect((await call(reader, 'list_changes', { since: reset.cursor })).changes).toEqual([]);
    }

    // Task and comment history follow the task lifetime. Structure rows survive project purge.
    expect((await request.delete(`/api/statuses/${id}`, { headers })).status()).toBe(409);
    expect(
      (
        await request.patch(`/api/statuses/${active.id}`, { headers, data: { isDefault: true } })
      ).status(),
    ).toBe(200);
    expect((await request.delete(`/api/statuses/${id}`, { headers })).status()).toBe(200);
    for (const trashed of [true, false, true]) {
      expect(
        (
          await request.patch(`/api/projects/${project.id}`, { headers, data: { trashed } })
        ).status(),
      ).toBe(200);
    }
    expect((await request.delete(`/api/projects/${project.id}`, { headers })).status()).toBe(200);
    expect(
      (await call(client, 'list_changes', { since: all.cursor })).changes.map(({ kind }) => kind),
    ).toEqual(['updated', 'updated', 'deleted', 'trashed', 'restored', 'trashed', 'deleted']);
  } finally {
    await Promise.all([client.close(), other.close(), stranger.close()]);
  }
});

test('list_changes catches an in-flight lower transaction after the current batch finishes @api', async ({
  request,
}) => {
  const account = await createAccount(request);
  const credential = await makeToken(request, account);
  const client = await connect(credential.token);
  const project = await makeProject(request, account, credential.metadata.workspaceId);
  const id = randomUUID();
  const writer = spawn('./scripts/dev.sh', ['psql', '-XqAt', '-v', 'ON_ERROR_STOP=1']);
  const lines = createInterface({ input: writer.stdout });
  const exited = once(writer, 'close');
  try {
    const ready = once(lines, 'line');
    writer.stdin.write(`
      BEGIN;
      INSERT INTO structure_activity (id, workspace_id, project_id, project_key, entity_type, entity_id, kind, changes)
      VALUES ('${id}', '${credential.metadata.workspaceId}', '${project.id}', 'THR', 'project', '${project.id}', 'updated', '[]');
      SELECT 'ready';
    `);
    await expect(Promise.race([ready, exited])).resolves.toEqual(['ready']);
    const start = await call(client, 'list_changes');
    for (const name of ['Second transaction', 'Third transaction']) {
      expect(
        (
          await request.patch(`/api/projects/${project.id}`, {
            headers: account.headers,
            data: { name },
          })
        ).status(),
      ).toBe(200);
    }
    const first = await call(client, 'list_changes', { since: start.cursor, limit: 1 });
    expect(first).toMatchObject({
      changes: [{ changes: [{ field: 'name', after: 'Second transaction' }] }],
      hasMore: true,
    });
    writer.stdin.end('COMMIT;\n');
    await expect(exited).resolves.toEqual([0, null]);

    const second = await call(client, 'list_changes', { since: first.cursor, limit: 1 });
    expect(second).toMatchObject({
      changes: [{ changes: [{ field: 'name', after: 'Third transaction' }] }],
      hasMore: false,
    });
    const late = await call(client, 'list_changes', { since: second.cursor });
    expect(late.changes.map((change) => change.id)).toEqual([id]);
    expect((await call(client, 'list_changes', { since: late.cursor })).changes).toEqual([]);
  } finally {
    if (!writer.stdin.destroyed && !writer.stdin.writableEnded) writer.stdin.end('ROLLBACK;\n');
    await exited;
    await client.close();
  }
});

test('purging a task can finish while its comment edit waits @api', async ({ request }) => {
  const account = await createAccount(request);
  const credential = await makeToken(request, account);
  const client = await connect(credential.token);
  const project = await makeProject(request, account, credential.metadata.workspaceId);
  const { task } = await call(client, 'create_task', { projectId: project.id, title: 'Purge me' });
  const { commentId } = await call(client, 'add_comment', { task: task.id, body: 'Before purge' });
  await client.close();

  const writer = spawn('./scripts/dev.sh', ['psql', '-XqAt', '-v', 'ON_ERROR_STOP=1']);
  const lines = createInterface({ input: writer.stdout });
  const exited = once(writer, 'close');
  try {
    const pidLine = once(lines, 'line');
    writer.stdin.write(`
      BEGIN;
      SELECT pg_backend_pid() FROM tasks WHERE id = '${task.id}' FOR UPDATE;
    `);
    const [line] = await Promise.race([pidLine, exited]);
    const pid = Number(line);
    expect(pid).toBeGreaterThan(0);
    const edit = request.patch(`/api/comments/${commentId}`, {
      headers: account.headers,
      data: { body: [{ type: 'paragraph', content: [{ type: 'text', text: 'Concurrent edit' }] }] },
    });
    try {
      await expect
        .poll(() =>
          execFileSync(
            './scripts/dev.sh',
            [
              'psql',
              '-XqAt',
              '-c',
              `SELECT count(*) FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`,
            ],
            { encoding: 'utf8' },
          ).trim(),
        )
        .toBe('1');
      writer.stdin.end(`DELETE FROM tasks WHERE id = '${task.id}';
COMMIT;
`);
      await expect(exited).resolves.toEqual([0, null]);
      expect((await edit).status()).toBe(404);
    } finally {
      if (!writer.stdin.destroyed && !writer.stdin.writableEnded) writer.stdin.end('ROLLBACK;\n');
      await edit;
    }
  } finally {
    if (!writer.stdin.destroyed && !writer.stdin.writableEnded) writer.stdin.end('ROLLBACK;\n');
    await exited;
  }
});

test('an offline task write reaches an existing list_changes cursor on replay', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'The outbox does not depend on the layout.');
  const account = await signUp(page);
  const credential = await makeToken(page.request, account);
  const project = await makeProject(page.request, account, credential.metadata.workspaceId);
  const client = await connect(credential.token);
  try {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(project.name, {
      timeout: APP_LOAD_TIMEOUT,
    });
    const start = await call(client, 'list_changes');
    const block = (route: Route) => route.abort('connectionfailed');
    await page.route('**/api/**', block);
    const taskId = await page.evaluate(async (projectId) => {
      const { createTask } = await import(/* @vite-ignore */ '/src/lib/tasks.ts');
      return createTask(projectId, { title: 'Queued offline' }) as string;
    }, project.id);
    await expect(page.getByRole('status')).toContainText('unsaved', { timeout: 40_000 });
    expect((await call(client, 'list_changes', { since: start.cursor })).changes).toEqual([]);
    await page.unroute('**/api/**', block);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect
      .poll(async () => (await call(client, 'list_changes', { since: start.cursor })).changes, {
        timeout: 40_000,
      })
      .toMatchObject([
        {
          type: 'task',
          kind: 'created',
          entity: { id: taskId, taskTitle: 'Queued offline' },
          actor: { viaToken: null },
        },
      ]);
  } finally {
    await client.close();
  }
});

test('MCP task size supports exact and unset filters, replay, conflicts and the feed @api', async ({
  request,
}) => {
  const account = await createAccount(request);
  const token = await makeToken(request, account);
  const project = await makeProject(request, account, token.metadata.workspaceId);
  const client = await connect(token.token);
  try {
    const start = await call(client, 'list_changes');
    const created = await call(client, 'create_task', {
      projectId: project.id,
      title: 'Sized',
      size: 1,
    });
    const unsized = await call(client, 'create_task', { projectId: project.id, title: 'Unsized' });
    const task = created.task.id;
    const read = () => call(client, 'get_task', { task });
    const bySize = async (size: number | null) =>
      (await call(client, 'list_tasks', { projectId: project.id, size })).items.map(({ id }) => id);

    expect((await read()).task.size).toBe(1);
    expect(await bySize(1)).toEqual([task]);
    expect(await bySize(null)).toEqual([unsized.task.id]);
    expect(await bySize(5)).toEqual([]);
    const changes = { size: { before: 1, after: 5 } };
    const updated = await call(client, 'update_task', { task, changes });
    expect(
      await call(client, 'update_task', { task, changes, operationId: updated.operationId }),
    ).toEqual(updated);
    const stale = await call(client, 'update_task', {
      task,
      changes: { size: { before: 1, after: null } },
    });
    expect(stale.changes).toEqual([
      { field: 'size', previous: 5, requested: null, applied: false, reason: 'stale' },
    ]);
    expect(await bySize(5)).toEqual([task]);

    await call(client, 'update_task', { task, changes: { size: { before: 5, after: null } } });
    expect((await read()).task.size).toBeNull();
    expect(await bySize(null)).toEqual([task, unsized.task.id]);
    const feed = await call(client, 'list_changes', { since: start.cursor, includeOwn: true });
    const sizeChanges = feed.changes.flatMap((entry) =>
      entry.type === 'task' ? entry.changes.filter(({ field }) => field === 'size') : [],
    );
    expect(sizeChanges).toEqual([
      expect.objectContaining({ before: null, after: 1, applied: true }),
      expect.objectContaining({ before: 1, after: 5, applied: true }),
      expect.objectContaining({ before: 5, after: 5, requested: null, applied: false }),
      expect.objectContaining({ before: 5, after: null, applied: true }),
    ]);
  } finally {
    await client.close();
  }
});

test('status colours round trip through REST, MCP and the change feed @api', async ({
  request,
}) => {
  const account = await createAccount(request);
  const token = await makeToken(request, account);
  const project = await makeProject(request, account, token.metadata.workspaceId);
  const client = await connect(token.token);
  try {
    const start = await call(client, 'list_changes');
    const input = {
      operationId: structureId(),
      projectId: project.id,
      name: 'Verify',
      category: 'active',
      color: 'mint',
    };
    const created = await call(client, 'create_status', input);
    expect(created.current.color).toBe('mint');
    expect(await call(client, 'create_status', input)).toEqual(created);

    const statusId = created.current.id;
    const rest = (data: object) =>
      request.patch(`/api/statuses/${statusId}`, { headers: account.headers, data });
    expect((await rest({ name: 'In review' })).status()).toBe(200);
    expect((await rest({ color: 'chartreuse' })).status()).toBe(400);
    const listed = await call(client, 'list_statuses', { projectId: project.id });
    expect(listed.items).toContainEqual(
      expect.objectContaining({ id: statusId, name: 'In review', color: 'mint' }),
    );
    const update = {
      operationId: structureId(),
      statusId,
      changes: { color: { before: 'mint', after: null } },
    };
    const cleared = await call(client, 'update_status', update);
    expect(cleared).toMatchObject({ outcome: 'applied', current: { color: null } });
    expect(await call(client, 'update_status', update)).toEqual(cleared);
    const stale = {
      ...update,
      operationId: structureId(),
      changes: { color: { before: 'mint', after: 'red' } },
    };
    expect(await call(client, 'update_status', stale)).toMatchObject({
      outcome: 'conflict',
      conflicts: ['color'],
    });

    expect((await rest({ color: 'dark-blue' })).status()).toBe(200);
    expect(await (await rest({ color: 'dark-blue' })).json()).toEqual({ txid: null });
    await expect
      .poll(
        async () =>
          (await shapeRows(request, 'statuses', account.headers)).find(({ id }) => id === statusId)
            ?.color,
      )
      .toBe('dark-blue');

    const feed = await call(client, 'list_changes', { since: start.cursor, includeOwn: true });
    expect(
      feed.changes.flatMap(({ entity, changes }) =>
        entity.id === statusId ? changes.filter(({ field }) => field === 'color') : [],
      ),
    ).toEqual([
      { field: 'color', before: null, after: 'mint' },
      { field: 'color', before: 'mint', after: null },
      { field: 'color', before: null, after: 'dark-blue' },
    ]);
  } finally {
    await client.close();
  }
});

test('GitHub deliveries reach the offline collection and MCP, with scoped manual links', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const owner = await signUp(page);
  const token = await makeToken(request, owner);
  const client = await connect(token.token);
  const stranger = await createAccount(request);
  try {
    const project = await makeProject(request, owner, token.metadata.workspaceId);
    const { task } = await call(client, 'create_task', { projectId: project.id, title: 'Ship' });
    const connection = await request.post(`/api/integrations/github/projects/${project.id}`, {
      headers: owner.headers,
      data: { repository: 'org/repo' },
    });
    expect(connection.status()).toBe(201);
    const {
      secret,
      connection: { webhookUrl },
    } = await connection.json();
    async function send(event: string, fields: Record<string, unknown>) {
      const body = JSON.stringify({ repository: { full_name: 'Org/Repo' }, ...fields });
      const response = await request.post(new URL(webhookUrl).pathname, {
        data: body,
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': event,
          'X-GitHub-Delivery': randomUUID(),
          'X-Hub-Signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
        },
      });
      expect(response.status(), await response.text()).toBe(200);
    }
    const pr = {
      number: 23,
      title: 'Patch',
      head: { ref: 'feat/thr-1', sha: 'abc' },
      state: 'open',
      draft: true,
      updated_at: '2026-11-25T09:00:00Z',
    };
    await send('issues', { issue: { ...pr, title: 'THR-1 follow-up', number: 24 } });
    await send('pull_request_review', {
      pull_request: pr,
      review: { id: 11, user: { id: 22 }, state: 'approved' },
    });
    const check = {
      id: 9,
      check_suite: { id: 9 },
      head_sha: 'abc',
      status: 'completed',
      conclusion: 'success',
      pull_requests: [{ number: 23 }],
    };
    await send('check_suite', { check_suite: check });
    await send('check_run', { check_run: check });
    await send('pull_request', { pull_request: pr });
    await send('pull_request', { pull_request: pr });
    await send('check_run', { check_run: { ...check, id: 10, conclusion: 'failure' } });
    const second = await call(client, 'create_task', { projectId: project.id, title: 'Verify' });
    await send('push', {
      ref: `refs/heads/${pr.head.ref}`,
      after: pr.head.sha,
      commits: [{ message: `Verify ${second.task.key}` }],
    });
    const copied = await call(client, 'get_task', { task: second.task.id });
    expect(copied.githubLinks).toHaveLength(1);
    expect(copied.githubLinks[0]).toMatchObject({
      number: 23,
      reviewDecision: 'approved',
      checksSummary: { failed: 1 },
    });
    const merged = {
      ...pr,
      head: { ...pr.head, ref: 'patch' },
      state: 'closed',
      merged: true,
      merged_at: '2026-11-26T07:00:00Z',
      updated_at: '2026-11-26T07:00:00Z',
    };
    await send('pull_request', { pull_request: merged });
    await send('pull_request', { pull_request: pr });
    const result = await call(client, 'get_task', { task: task.id });
    expect(result.githubLinks).toHaveLength(2);
    const link = result.githubLinks.find((l) => l.kind === 'pr')!;
    expect(link).toMatchObject({
      state: 'merged',
      reviewDecision: 'approved',
      checksSummary: { state: 'failing', passed: 1, failed: 1, pending: 0 },
    });
    expect(result.history.items.filter((i) => i.viaTokenName === 'GitHub')).toHaveLength(3);
    const release = {
      tag_name: 'v1',
      name: 'First release',
      draft: false,
      prerelease: true,
      published_at: '2026-11-26T08:00:00Z',
    };
    const unreleased = () =>
      call(client, 'list_tasks', { projectId: project.id, unreleased: true });
    expect((await unreleased()).items.map((t) => t.id)).toContain(task.id);
    await send('release', {
      action: 'published',
      release: { ...release, tag_name: 'v0', published_at: '2026-11-26T06:59:59Z' },
    });
    expect((await unreleased()).items.map((t) => t.id)).toContain(task.id);
    const tagPush = {
      ref: 'refs/tags/v1',
      after: 'a'.repeat(40),
      deleted: false,
      repository: { full_name: 'Org/Repo', pushed_at: Date.parse(release.published_at) / 1000 },
    };
    await send('push', tagPush);
    await send('release', { action: 'published', release });
    const first = await call(client, 'list_github_releases', { projectId: project.id, limit: 1 });
    const [shipped] = first.releases;
    expect(first.nextCursor?.id).toBe(shipped?.id);
    const next = await call(client, 'list_github_releases', {
      projectId: project.id,
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(next.releases.map((row) => row.tagName)).toEqual(['v0']);
    expect(next.nextCursor).toBeNull();
    expect(shipped).toMatchObject({ tagName: 'v1', isPrerelease: true });
    expect((await unreleased()).items).toHaveLength(0);
    expect((await call(client, 'get_task', { task: task.key })).githubReleases).toEqual([shipped]);
    for (const filter of [shipped!.id, 'v1'])
      expect(
        (await call(client, 'list_tasks', { release: filter })).items.map((t) => t.id),
      ).toContain(task.id);
    for (const shape of ['github-releases', 'task-github-releases'])
      expect(await shapeRows(request, shape, stranger.headers)).toEqual([]);
    const bindingPath = `/api/integrations/github/projects/${project.id}/releases/${shipped!.id}/tasks/${task.id}`;
    expect((await request.delete(bindingPath, { headers: stranger.headers })).status()).toBe(404);
    expect((await request.put(bindingPath, { headers: stranger.headers })).status()).toBe(404);
    await send('release', {
      action: 'published',
      release: { ...release, tag_name: 'v2', published_at: '2026-11-27T00:00:00Z' },
    });
    expect((await call(client, 'get_task', { task: task.key })).githubReleases).toEqual([shipped]);
    async function cachedRelease() {
      return page.evaluate(
        async ({ releaseId, taskId }) => {
          const { githubReleasesCollection: r, taskGithubReleasesCollection: b } = await import(
            /* @vite-ignore */ '/src/lib/collections.ts'
          );
          const persisted = await b.config.persistence.adapter.loadSubset(b.id, {});
          return [
            r.get(releaseId)?.tagName,
            [...b.state.values()].some((binding) => binding.taskId === taskId),
            persisted.some((entry: { value: { taskId: string } }) => entry.value.taskId === taskId),
          ];
        },
        { releaseId: shipped!.id, taskId: task.id },
      );
    }
    await expect.poll(cachedRelease, { timeout: 30000 }).toEqual(['v1', true, true]);
    const synced = () =>
      page.evaluate(async (id) => {
        const { taskGithubLinksCollection: c } = await import(
          /* @vite-ignore */ '/src/lib/collections.ts'
        );
        return c.get(id);
      }, link.id);
    await expect.poll(synced, { timeout: 30000 }).toMatchObject(link);
    // Electric publishes the in-memory row before the asynchronous SQLite commit completes.
    await expect
      .poll(
        () =>
          page.evaluate(async (id) => {
            const { taskGithubLinksCollection: c } = await import(
              /* @vite-ignore */ '/src/lib/collections.ts'
            );
            const rows = await c.config.persistence.adapter.loadSubset(c.id, {});
            return rows.find((row: { key: string }) => row.key === id)?.value;
          }, link.id),
        { timeout: 30000 },
      )
      .toMatchObject(link);
    await page.route('**/api/shapes/**', (route) => route.abort());
    await page.reload();
    await expect.poll(synced, { timeout: 30000 }).toMatchObject(link);
    await expect.poll(cachedRelease, { timeout: 30000 }).toEqual(['v1', true, true]);
    await call(client, 'unbind_task_release', { task: task.key, releaseId: shipped!.id });
    expect((await unreleased()).items.map((t) => t.id)).toContain(task.id);
    await call(client, 'bind_task_release', { task: task.key, releaseId: shipped!.id });
    expect(
      await call(client, 'bind_task_release', { task: task.key, releaseId: shipped!.id }),
    ).toEqual({ bound: true, txid: null });
    await send('release', {
      action: 'unpublished',
      release: { ...release, draft: true, published_at: null },
    });
    expect((await unreleased()).items.map((t) => t.id)).toContain(task.id);
    await send('release', { action: 'deleted', release });
    for (const sha of [tagPush.after, 'b'.repeat(40)]) {
      if (sha !== tagPush.after) await send('push', { ...tagPush, after: sha });
      const tags = await call(client, 'list_github_releases', { projectId: project.id });
      expect(tags.releases.find((r) => r.id === shipped!.id)).toMatchObject({
        source: 'tag',
        publishedAt: null,
        targetCommitish: sha,
      });
      expect((await unreleased()).items.map((t) => t.id)).toContain(task.id);
    }
    await send('push', { ...tagPush, deleted: true });
    expect(
      (await call(client, 'list_github_releases', { projectId: project.id })).releases.map(
        (r) => r.id,
      ),
    ).not.toContain(shipped!.id);
    expect((await call(client, 'get_task', { task: task.id })).githubReleases).toEqual([]);
    expect(await shapeRows(request, 'task-github-links', stranger.headers)).toEqual([]);
    const rows = await shapeRows(request, 'task-github-links', owner.headers);
    expect(rows[0]).not.toHaveProperty('runs');
    const url = 'https://github.com/org/repo/issues/81';
    const path = `/api/integrations/github/tasks/${task.id}/links`;
    expect((await request.post(path, { headers: stranger.headers, data: { url } })).status()).toBe(
      404,
    );
    expect(
      (await request.delete(`${path}/${link.id}`, { headers: stranger.headers })).status(),
    ).toBe(404);
    expect((await request.post(path, { headers: owner.headers, data: { url } })).status()).toBe(
      201,
    );
    const manual = await call(client, 'link_github', { task: task.key, url });
    expect(manual.txid).toBeNull();
    expect(
      (await request.delete(`${path}/${manual.link.id}`, { headers: owner.headers })).status(),
    ).toBe(200);
    expect(
      (await call(client, 'unlink_github', { task: task.key, linkId: manual.link.id })).txid,
    ).toBeNull();
    expect((await call(client, 'unlink_github', { task: task.key, linkId: link.id })).txid).toEqual(
      expect.any(Number),
    );
  } finally {
    await client.close();
  }
});
