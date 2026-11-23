import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { type McpOutput, type McpToolName, mcpTools } from '../packages/shared/src/mcp';
import { createMcpTokenResponseSchema } from '../packages/shared/src/mcpTokens';
import { APP_LOAD_TIMEOUT, createAccount, shapeRows, signUp } from './helpers';

type Headers = Record<string, string>;
const CATEGORIES = ['backlog', 'active', 'done', 'cancelled'] as const;

async function makeProject(
  request: APIRequestContext,
  headers: Headers,
  workspaceId: string,
  key: string,
  name: string,
) {
  const project = {
    id: randomUUID(),
    workspaceId,
    name,
    key,
    color: key === 'APP' ? 'teal' : 'orange',
    icon: null,
    position: key === 'APP' ? 'a0' : 'a1',
    statuses: CATEGORIES.map((category) => ({
      id: randomUUID(),
      name: category === 'active' ? 'Working' : category,
      category,
      position: 'a0',
      isDefault: true,
    })),
  };
  expect((await request.post('/api/projects', { headers, data: project })).status()).toBe(201);
  const status = (category: (typeof CATEGORIES)[number]) =>
    project.statuses.find((row) => row.category === category)!.id;
  return { ...project, status };
}

async function makeTask(
  request: APIRequestContext,
  headers: Headers,
  projectId: string,
  title: string,
  statusId: string,
) {
  const id = randomUUID();
  const response = await request.post('/api/tasks', {
    headers,
    data: {
      id,
      projectId,
      title,
      statusId,
      priority: 3,
      position: 'a0',
      parentId: null,
      description: null,
      descriptionVersion: null,
    },
  });
  expect(response.status()).toBe(201);
  return id;
}

/** Two projects of one workspace, a task in each and a second in the first. */
async function workspace(request: APIRequestContext, headers: Headers) {
  const [row] = await shapeRows(request, 'workspaces', headers);
  const workspaceId = String(row?.id);
  const app = await makeProject(request, headers, workspaceId, 'APP', 'App');
  const ops = await makeProject(request, headers, workspaceId, 'OPS', 'Operations');
  const blocked = await makeTask(
    request,
    headers,
    app.id,
    'Ship the release',
    app.status('active'),
  );
  const blocker = await makeTask(request, headers, ops.id, 'Rotate the keys', ops.status('active'));
  const sibling = await makeTask(request, headers, app.id, 'Write notes', app.status('active'));
  return { workspaceId, app, ops, blocked, blocker, sibling };
}

const relation = (sourceTaskId: string, targetTaskId: string, kind: string) => ({
  id: randomUUID(),
  sourceTaskId,
  targetTaskId,
  kind,
});

async function moveTask(
  request: APIRequestContext,
  headers: Headers,
  id: string,
  before: string,
  after: string,
) {
  const response = await request.patch(`/api/tasks/${id}`, {
    headers,
    data: { changeId: randomUUID(), changes: { statusId: { before, after } } },
  });
  expect(response.ok()).toBe(true);
}

test('relations link tasks across projects, replay safely and refuse reverse links @api', async ({
  request,
}) => {
  const account = await createAccount(request);
  const { headers } = account;
  const { blocked, blocker, sibling } = await workspace(request, headers);
  const blocks = relation(blocker, blocked, 'blocks');

  const created = await request.post('/api/task-relations', { headers, data: blocks });
  expect(created.status()).toBe(201);
  expect((await created.json()).txid).toEqual(expect.any(Number));
  // A resend, and the same link made under another id on another device, change nothing.
  for (const data of [blocks, { ...blocks, id: randomUUID() }]) {
    const replay = await request.post('/api/task-relations', { headers, data });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual({ txid: null });
  }
  const reverse = await request.post('/api/task-relations', {
    headers,
    data: relation(blocked, blocker, 'blocks'),
  });
  expect(reverse.status()).toBe(409);
  expect(await reverse.json()).toEqual({
    error: 'The other task already has the reverse relation',
  });
  expect(
    (
      await request.post('/api/task-relations', {
        headers,
        data: relation(blocked, blocked, 'relates_to'),
      })
    ).status(),
  ).toBe(400);
  // relates_to is stored once, lower id first, whichever way it was sent.
  const [low, high] = [blocked, sibling].sort();
  const related = relation(high!, low!, 'relates_to');
  expect((await request.post('/api/task-relations', { headers, data: related })).status()).toBe(
    201,
  );
  expect(
    await (
      await request.post('/api/task-relations', {
        headers,
        data: relation(low!, high!, 'relates_to'),
      })
    ).json(),
  ).toEqual({ txid: null });

  await expect
    .poll(async () =>
      (await shapeRows(request, 'task-relations', headers))
        .map((row) => [row.source_task_id, row.target_task_id, row.kind])
        .sort(),
    )
    .toEqual(
      [
        [blocker, blocked, 'blocks'],
        [low, high, 'relates_to'],
      ].sort(),
    );
  // Each end's log says what changed, as that task sees it.
  const entries = (await shapeRows(request, 'task_activity', headers)).flatMap((row) =>
    (JSON.parse(String(row.changes)) as { field: string; relation?: string }[])
      .filter((change) => change.field === 'relations')
      .map((change) => [row.task_id, change.relation]),
  );
  expect(entries).toEqual(
    expect.arrayContaining([
      [blocked, 'blocked_by'],
      [blocker, 'blocks'],
      [low, 'relates_to'],
      [high, 'relates_to'],
    ]),
  );

  const stranger = await createAccount(request);
  const foreign = await request.post('/api/task-relations', {
    headers: stranger.headers,
    data: relation(blocked, sibling, 'duplicates'),
  });
  expect(foreign.status()).toBe(404);
  expect(
    await (
      await request.delete(`/api/task-relations/${blocks.id}`, { headers: stranger.headers })
    ).json(),
  ).toEqual({ txid: null });

  const removed = await request.delete(`/api/task-relations/${blocks.id}`, { headers });
  expect((await removed.json()).txid).toEqual(expect.any(Number));
  expect(
    await (await request.delete(`/api/task-relations/${blocks.id}`, { headers })).json(),
  ).toEqual({ txid: null });
  // Purging a task takes its links with it.
  await request.patch(`/api/tasks/${sibling}`, {
    headers,
    data: { changeId: randomUUID(), changes: { trashed: { before: false, after: true } } },
  });
  expect((await request.delete(`/api/tasks/${sibling}`, { headers })).ok()).toBe(true);
  await expect.poll(async () => shapeRows(request, 'task-relations', headers)).toEqual([]);
});

async function call<T extends McpToolName>(
  client: Client,
  name: T,
  args: Record<string, unknown> = {},
): Promise<McpOutput<T>> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  return mcpTools[name].output.parse(result.structuredContent) as McpOutput<T>;
}

test('MCP agents add, read and remove relations by key, and follow them in the feed @api', async ({
  request,
}) => {
  const account = await createAccount(request);
  const { headers } = account;
  const { workspaceId, ops, blocker, blocked } = await workspace(request, headers);
  const tokenResponse = await request.post('/api/mcp-tokens', {
    headers,
    data: { name: 'Relations agent', workspaceId },
  });
  expect(tokenResponse.status()).toBe(201);
  const { token } = createMcpTokenResponseSchema.parse(await tokenResponse.json());
  const client = new Client({ name: 'Throw relations test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('/api/mcp', test.info().project.use.baseURL), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  try {
    const start = await call(client, 'list_changes');
    const operationId = '019abcd0-abcd-7abc-8abc-abcdefabcdef';
    const args = { task: 'APP-1', relation: 'blocked_by', other: 'OPS-1', operationId };
    const added = await call(client, 'add_task_relation', args);
    expect(added).toMatchObject({
      outcome: 'added',
      relation: { relation: 'blocked_by', task: { id: blocker, key: 'OPS-1' } },
    });
    expect((await call(client, 'add_task_relation', args)).relation.id).toBe(added.relation.id);
    const reverse = await client.callTool({
      name: 'add_task_relation',
      arguments: { task: 'OPS-1', relation: 'blocked_by', other: 'APP-1' },
    });
    expect(reverse.isError).toBe(true);
    expect(JSON.stringify(reverse.content)).toContain('reverse relation');

    let read = await call(client, 'get_task', { task: 'APP-1' });
    expect(read.task.blocked).toBe(true);
    expect(read.relations).toEqual([
      expect.objectContaining({ id: added.relation.id, relation: 'blocked_by' }),
    ]);
    expect((await call(client, 'get_task', { task: 'OPS-1' })).relations[0]?.relation).toBe(
      'blocks',
    );
    // Closing the blocker clears the block; the relation stays.
    await moveTask(request, headers, blocker, ops.status('active'), ops.status('done'));
    read = await call(client, 'get_task', { task: blocked });
    expect(read.task.blocked).toBe(false);
    expect(read.relations).toHaveLength(1);

    const feed = await call(client, 'list_changes', {
      since: start.cursor,
      includeOwn: true,
      limit: 50,
    });
    expect(
      feed.changes.flatMap((change) =>
        change.changes
          .filter((item) => item.field === 'relations')
          .map((item) => [change.entity.taskKey, item.relation, item.after]),
      ),
    ).toEqual(
      expect.arrayContaining([
        ['APP-1', 'blocked_by', blocker],
        ['OPS-1', 'blocks', blocked],
      ]),
    );

    const removed = await call(client, 'remove_task_relation', {
      task: 'OPS-1',
      relation: 'blocks',
      other: 'APP-1',
    });
    expect(removed).toMatchObject({ outcome: 'removed', relationId: added.relation.id });
    expect(
      (await call(client, 'remove_task_relation', { relationId: added.relation.id })).outcome,
    ).toBe('absent');
    expect((await call(client, 'get_task', { task: 'APP-1' })).relations).toEqual([]);
  } finally {
    await client.close();
  }
});

/** The pane's drawer on desktop; on a phone, the board drawer's dock (ADR 0009). */
const controls = (page: Page) => page.getByRole('toolbar', { name: 'Task controls', exact: true });

test('a task links another project’s task as its blocker, which shows on its card until it closes', async ({
  page,
  isMobile,
}) => {
  const account = await signUp(page);
  const { headers } = account;
  const { workspaceId, app, ops, blocker } = await workspace(page.request, headers);
  await page.goto(`/w/${workspaceId}/p/${app.id}?view=board`);
  const card = page.getByRole('article', { name: 'APP-1 Ship the release', exact: true });
  await expect(card).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await card.click();
  const pane = page.getByLabel('Task', { exact: true });
  await expect(pane).toBeVisible();

  await controls(page).getByRole('button', { name: 'Link a task', exact: true }).click();
  await page.getByRole('radio', { name: 'Blocked by', exact: true }).click();
  await page.getByRole('combobox', { name: 'Find a task' }).fill('OPS-1');
  const results = page.getByRole('listbox', { name: 'Tasks to link' });
  await expect(results.getByRole('option', { name: /OPS-1/ })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('relation-picker.png') });
  await results.getByRole('option', { name: /OPS-1/ }).click();
  await expect(results).toHaveCount(0);

  const relations = pane.getByRole('region', { name: 'Relations' });
  await expect(pane.getByRole('tab', { name: /Links · 1/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(relations).toBeVisible();
  await expect(relations.getByText('Blocked by', { exact: true })).toBeVisible();
  await expect(relations.getByText('Operations', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('links-tab.png') });
  await expect
    .poll(async () =>
      (await shapeRows(page.request, 'task-relations', headers)).map((row) => [
        row.source_task_id,
        row.kind,
      ]),
    )
    .toEqual([[blocker, 'blocks']]);

  // Beside the board the card stays in view; a phone's task screen covers it, so leave first.
  if (isMobile) await pane.getByRole('button', { name: 'Back to the board' }).click();
  const indicator = card.getByRole('img', { name: 'Blocked by OPS-1' });
  await expect(indicator).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('blocked-card.png') });
  await moveTask(page.request, headers, blocker, ops.status('active'), ops.status('done'));
  await expect(indicator).toHaveCount(0);
  await moveTask(page.request, headers, blocker, ops.status('done'), ops.status('active'));
  await expect(indicator).toBeVisible();

  // The related task opens on its own project's board.
  if (isMobile) await card.click();
  await pane
    .getByRole('region', { name: 'Relations' })
    .getByRole('button', { name: 'Open OPS-1 Rotate the keys' })
    .click();
  await expect(page).toHaveURL(new RegExp(`/p/${ops.id}.*task=${blocker}`));
  const blockerPane = page.getByLabel('Task', { exact: true });
  await expect(blockerPane.getByRole('textbox', { name: 'Task title' })).toHaveValue(
    'Rotate the keys',
    { timeout: APP_LOAD_TIMEOUT },
  );
  const blocks = blockerPane.getByRole('region', { name: 'Relations' });
  await expect(blocks.getByText('Blocks', { exact: true })).toBeVisible();
  await blocks.getByRole('button', { name: 'Remove blocks APP-1' }).click();
  await expect(blockerPane.getByRole('region', { name: 'Relations' })).toHaveCount(0);
  await expect.poll(async () => shapeRows(page.request, 'task-relations', headers)).toEqual([]);
});

test('a wide desktop pane lists relations in its side column, which shuts with the last one', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'A phone keeps its stacked layout (ADR 0009)');
  const account = await signUp(page);
  const { headers } = account;
  const { workspaceId, app, blocked, sibling } = await workspace(page.request, headers);
  await page.goto(`/w/${workspaceId}/p/${app.id}?view=board&task=${blocked}`);
  const pane = page.getByLabel('Task', { exact: true });
  await expect(pane.getByRole('textbox', { name: 'Task title' })).toHaveValue('Ship the release', {
    timeout: APP_LOAD_TIMEOUT,
  });
  // The narrow pane starts with Comments, History and Links tabs.
  await expect(pane.getByRole('tab', { name: /^Links/ })).toBeVisible();
  const column = pane.getByRole('complementary', { name: 'Task sidebar' });
  const handle = page.getByRole('separator', { name: 'Resize task' });
  await handle.focus();
  while (Number(await handle.getAttribute('aria-valuenow')) < 620)
    await handle.press('Shift+ArrowLeft');
  await expect(column).toHaveCount(0);
  // Once wide enough for the side column, the third tab leaves the tab strip.
  await expect(pane.getByRole('tab', { name: /^Links/ })).toHaveCount(0);

  const link = relation(sibling, blocked, 'duplicates');
  expect((await page.request.post('/api/task-relations', { headers, data: link })).status()).toBe(
    201,
  );
  // The synced link goes straight to the column; the tab copy cannot be reached.
  await expect(column.getByRole('region', { name: 'Relations' })).toContainText('Duplicated by');
  await expect(pane.getByRole('region', { name: 'Relations' })).toHaveCount(1);
  await column.getByRole('button', { name: 'Remove duplicated by APP-2' }).click();
  await expect(column).toHaveCount(0);

  // Narrowing back below the breakpoint brings the Links tab back.
  await handle.focus();
  while (Number(await handle.getAttribute('aria-valuenow')) >= 620)
    await handle.press('Shift+ArrowRight');
  await expect(pane.getByRole('tab', { name: /^Links/ })).toBeVisible();
});
