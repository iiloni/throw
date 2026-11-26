import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { type APIRequestContext, expect, test } from '@playwright/test';
import {
  githubConnectionResponseSchema,
  githubConnectionSecretResponseSchema,
} from '../packages/shared/src/github';
import { STARTER_STATUSES } from '../packages/shared/src/statuses';
import { webhooksResponseSchema } from '../packages/shared/src/webhooks';
import { createAccount } from './helpers';

type Account = Awaited<ReturnType<typeof createAccount>>;
type Statuses = Record<'backlog' | 'progress' | 'review' | 'done' | 'cancelled', string>;

/** Rows from this worktree's database, for state no API returns (closing times, the queue). */
function query<T>(sql: string): T[] {
  const out = execFileSync(
    './scripts/dev.sh',
    [
      'psql',
      '-XqAt',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `SELECT coalesce(json_agg(r), '[]') FROM (${sql}) r`,
    ],
    { encoding: 'utf8' },
  );
  return JSON.parse(out.trim()) as T[];
}

async function makeProject(request: APIRequestContext, account: Account, key: string) {
  const list = await request.get('/api/webhooks', { headers: account.headers });
  const workspaceId = webhooksResponseSchema.parse(await list.json()).workspaces[0]!.id;
  const ids = STARTER_STATUSES.map(() => randomUUID());
  const project = {
    id: randomUUID(),
    workspaceId,
    name: `Rules ${key}`,
    key,
    color: 'teal',
    icon: null,
    position: 'a0',
    statuses: STARTER_STATUSES.map((status, i) => ({
      ...status,
      id: ids[i]!,
      position: 'a0',
      isDefault: true,
    })),
  };
  const made = await request.post('/api/projects', { data: project, headers: account.headers });
  expect(made.status(), await made.text()).toBe(201);
  const review = randomUUID();
  const added = await request.post('/api/statuses', {
    headers: account.headers,
    data: {
      id: review,
      projectId: project.id,
      name: 'In review',
      category: 'active',
      position: 'a1',
      isDefault: false,
    },
  });
  expect(added.status(), await added.text()).toBe(201);
  const statuses: Statuses = {
    backlog: ids[0]!,
    progress: ids[1]!,
    review,
    done: ids[2]!,
    cancelled: ids[3]!,
  };
  return { ...project, statuses };
}

const managed = (projectId: string) => `/api/integrations/github/projects/${projectId}`;

async function connect(request: APIRequestContext, account: Account, projectId: string) {
  const created = await request.post(managed(projectId), {
    headers: account.headers,
    data: { repository: 'org/repo' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { secret, connection } = githubConnectionSecretResponseSchema.parse(await created.json());
  expect(connection.statusRules).toEqual({
    prDraftOpened: null,
    prReadyForReview: null,
    prMerged: null,
    prClosed: null,
    issueClosed: null,
  });
  return async (event: string, fields: Record<string, unknown>) => {
    const body = JSON.stringify({ repository: { full_name: 'org/repo' }, ...fields });
    const response = await request.post(new URL(connection.webhookUrl).pathname, {
      data: body,
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': event,
        'X-GitHub-Delivery': randomUUID(),
        'X-Hub-Signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
      },
    });
    expect(response.status(), await response.text()).toBe(200);
  };
}

const patchRules = (
  request: APIRequestContext,
  account: Account,
  projectId: string,
  statusRules: Record<string, string | null>,
) => request.patch(managed(projectId), { headers: account.headers, data: { statusRules } });

async function createTask(
  request: APIRequestContext,
  account: Account,
  projectId: string,
  title: string,
  place: { statusId?: string; position?: string } = {},
) {
  const id = randomUUID();
  const response = await request.post('/api/tasks', {
    headers: account.headers,
    data: {
      id,
      projectId,
      title,
      description: null,
      descriptionVersion: null,
      position: place.position ?? 'a0',
      parentId: null,
      ...(place.statusId ? { statusId: place.statusId } : {}),
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return id;
}

async function updateTask(
  request: APIRequestContext,
  account: Account,
  id: string,
  changes: Record<string, unknown>,
) {
  const response = await request.patch(`/api/tasks/${id}`, {
    headers: account.headers,
    data: { changeId: randomUUID(), changes },
  });
  expect(response.status(), await response.text()).toBe(200);
}

type TaskRow = {
  status_id: string;
  closed_at: string | null;
  position: string;
};
const task = (id: string) =>
  query<TaskRow>(`SELECT status_id, closed_at, position FROM tasks WHERE id = '${id}'`)[0]!;
type Entry = {
  user_id: string | null;
  via_token_name: string | null;
  changes: { field: string; requested: unknown; requestedName?: string | null }[];
  feed_position: { field: string; requested: string } | null;
};
const entries = (id: string) =>
  query<Entry>(
    `SELECT user_id, via_token_name, changes, feed_position FROM task_activity
     WHERE task_id = '${id}' AND kind = 'updated' ORDER BY created_at, id`,
  );
type Delivery = {
  payload: {
    taskId: string;
    changedFields: string[];
    statusTo?: { id: string; category: string };
    actor: Record<string, unknown>;
  };
};
const deliveries = (webhookId: string, taskId: string) =>
  query<Delivery>(
    `SELECT payload FROM webhook_deliveries WHERE webhook_id = '${webhookId}'
     AND event = 'task.updated' AND payload->>'taskId' = '${taskId}' ORDER BY id`,
  );
const statusChanges = (id: string) =>
  entries(id).flatMap((entry) =>
    entry.changes.filter((change) => change.field === 'statusId').map((c) => c.requested),
  );

test('status rules take only the project’s own statuses and turn off when one is deleted @api', async ({
  request,
}) => {
  const owner = await createAccount(request);
  const project = await makeProject(request, owner, 'RUL');
  const other = await makeProject(request, owner, 'OTH');
  // A project with no connection has no rules to set.
  expect((await patchRules(request, owner, project.id, { prMerged: null })).status()).toBe(404);
  await connect(request, owner, project.id);

  const saved = await patchRules(request, owner, project.id, {
    prMerged: project.statuses.done,
    prClosed: project.statuses.cancelled,
  });
  expect(saved.status(), await saved.text()).toBe(200);
  expect(githubConnectionResponseSchema.parse(await saved.json()).connection?.statusRules).toEqual({
    prDraftOpened: null,
    prReadyForReview: null,
    prMerged: project.statuses.done,
    prClosed: project.statuses.cancelled,
    issueClosed: null,
  });
  // A rule left out keeps its status; null turns one off.
  const partial = await patchRules(request, owner, project.id, { prClosed: null });
  expect(
    githubConnectionResponseSchema.parse(await partial.json()).connection?.statusRules,
  ).toMatchObject({ prMerged: project.statuses.done, prClosed: null });

  for (const statusRules of [
    { prMerged: other.statuses.done },
    { issueClosed: randomUUID() },
    { prMerged: project.statuses.done, prClosed: other.statuses.cancelled },
  ]) {
    const refused = await patchRules(request, owner, project.id, statusRules);
    expect(refused.status(), JSON.stringify(statusRules)).toBe(400);
  }
  for (const statusRules of [{ prMerged: 'done' }, { pushed: project.statuses.done }]) {
    expect((await patchRules(request, owner, project.id, statusRules)).status()).toBe(400);
  }
  const stranger = await createAccount(request);
  expect((await patchRules(request, stranger, project.id, { prMerged: null })).status()).toBe(404);
  const unchanged = await request.get(managed(project.id), { headers: owner.headers });
  expect(
    githubConnectionResponseSchema.parse(await unchanged.json()).connection?.statusRules,
  ).toMatchObject({ prMerged: project.statuses.done, prClosed: null });

  // Deleting a status that a rule names turns that rule off.
  const qa = randomUUID();
  expect(
    (
      await request.post('/api/statuses', {
        headers: owner.headers,
        data: {
          id: qa,
          projectId: project.id,
          name: 'QA',
          category: 'active',
          position: 'a2',
          isDefault: false,
        },
      })
    ).status(),
  ).toBe(201);
  expect((await patchRules(request, owner, project.id, { prClosed: qa })).status()).toBe(200);
  expect((await request.delete(`/api/statuses/${qa}`, { headers: owner.headers })).status()).toBe(
    200,
  );
  const after = await request.get(managed(project.id), { headers: owner.headers });
  expect(
    githubConnectionResponseSchema.parse(await after.json()).connection?.statusRules,
  ).toMatchObject({ prMerged: project.statuses.done, prClosed: null });

  // A project in the trash takes no new rules, though turning one off still works.
  expect(
    (
      await request.patch(`/api/projects/${project.id}`, {
        headers: owner.headers,
        data: { trashed: true },
      })
    ).status(),
  ).toBe(200);
  expect(
    (await patchRules(request, owner, project.id, { issueClosed: project.statuses.done })).status(),
  ).toBe(400);
  expect((await patchRules(request, owner, project.id, { prMerged: null })).status()).toBe(200);
  expect(
    (await patchRules(request, owner, project.id, { prMerged: project.statuses.done })).status(),
  ).toBe(400);

  // Purging a project whose connection names its statuses removes them all together.
  await connect(request, owner, other.id);
  expect(
    (await patchRules(request, owner, other.id, { prMerged: other.statuses.done })).status(),
  ).toBe(200);
  expect(
    (
      await request.patch(`/api/projects/${other.id}`, {
        headers: owner.headers,
        data: { trashed: true },
      })
    ).status(),
  ).toBe(200);
  expect(
    (await request.delete(`/api/projects/${other.id}`, { headers: owner.headers })).status(),
  ).toBe(200);
  expect(query(`SELECT id FROM github_connections WHERE project_id = '${other.id}'`)).toEqual([]);
});

test('GitHub events move linked tasks once, as GitHub, by the project’s rules @api', async ({
  request,
}) => {
  test.setTimeout(120_000);
  const owner = await createAccount(request);
  const project = await makeProject(request, owner, 'AUT');
  const send = await connect(request, owner, project.id);
  const { statuses } = project;
  const hook = await request.post('/api/webhooks', {
    headers: owner.headers,
    data: {
      workspaceId: project.workspaceId,
      projectId: project.id,
      name: 'Agent',
      url: 'https://hooks.example.com/throw',
    },
  });
  expect(hook.status(), await hook.text()).toBe(201);
  const webhookId = ((await hook.json()) as { webhook: { id: string } }).webhook.id;
  const rules = await patchRules(request, owner, project.id, {
    prDraftOpened: statuses.progress,
    prReadyForReview: statuses.review,
    prMerged: statuses.done,
    prClosed: statuses.cancelled,
    issueClosed: statuses.done,
  });
  expect(rules.status(), await rules.text()).toBe(200);

  const one = await createTask(request, owner, project.id, 'One'); // AUT-1
  const two = await createTask(request, owner, project.id, 'Two'); // AUT-2
  const trashed = await createTask(request, owner, project.id, 'Gone'); // AUT-3
  const multi = await createTask(request, owner, project.id, 'Many'); // AUT-4
  await updateTask(request, owner, trashed, { trashed: { before: false, after: true } });
  const pr = (number: number, fields: Record<string, unknown>) => ({
    number,
    title: 'Patch',
    body: null,
    head: { ref: 'feat/change', sha: `sha-${number}` },
    state: 'open',
    draft: false,
    merged: false,
    ...fields,
  });

  // Opened as a draft: linked and moved to In progress in one entry and one webhook.
  const draft = pr(1, { title: 'AUT-1 start', draft: true, updated_at: '2026-11-26T08:00:00Z' });
  await send('pull_request', { action: 'opened', pull_request: draft });
  expect(task(one).status_id).toBe(statuses.progress);
  const [first] = entries(one);
  expect(first).toMatchObject({ user_id: null, via_token_name: 'GitHub' });
  expect(first!.changes.map((change) => change.field)).toEqual(['relations', 'statusId']);
  expect(first!.changes[1]).toMatchObject({
    requested: statuses.progress,
    requestedName: 'In progress',
  });
  const [hooked] = deliveries(webhookId, one);
  expect(deliveries(webhookId, one)).toHaveLength(1);
  expect(hooked!.payload).toMatchObject({
    statusTo: { id: statuses.progress, category: 'active' },
    actor: { kind: 'token', viaTokenName: 'GitHub', integration: 'github' },
  });
  expect(hooked!.payload.changedFields).toEqual(expect.arrayContaining(['relations', 'statusId']));

  // A person moves it back; an edited title or a push to the branch does not move it again.
  await updateTask(request, owner, one, {
    statusId: { before: statuses.progress, after: statuses.backlog },
  });
  await send('pull_request', {
    action: 'edited',
    pull_request: { ...draft, title: 'AUT-1 started', updated_at: '2026-11-26T08:05:00Z' },
  });
  await send('pull_request', {
    action: 'synchronize',
    pull_request: { ...draft, updated_at: '2026-11-26T08:06:00Z' },
  });
  expect(task(one).status_id).toBe(statuses.backlog);

  // Ready for review moves it; GitHub's older `opened`, arriving late, is ignored.
  await send('pull_request', {
    action: 'ready_for_review',
    pull_request: { ...draft, draft: false, updated_at: '2026-11-26T09:00:00Z' },
  });
  expect(task(one).status_id).toBe(statuses.review);
  await send('pull_request', { action: 'opened', pull_request: draft });
  expect(task(one).status_id).toBe(statuses.review);

  // Merged: Done, stamped closed, in the place it had (the closed lane sorts by time).
  const reviewPlace = task(one).position;
  const merged = {
    ...draft,
    draft: false,
    state: 'closed',
    merged: true,
    merged_at: '2026-11-26T10:00:00Z',
    updated_at: '2026-11-26T10:00:00Z',
  };
  await send('pull_request', { action: 'closed', pull_request: merged });
  const done = task(one);
  expect(done.status_id).toBe(statuses.done);
  expect(done.closed_at).not.toBeNull();
  expect(done.position).toBe(reviewPlace);
  // A second notice of the same merge changes nothing and records nothing.
  const recorded = entries(one).length;
  await send('pull_request', { action: 'closed', pull_request: merged });
  expect(entries(one)).toHaveLength(recorded);

  // Reopened: back to review, reopened, at the top of that lane, above a task already there.
  await createTask(request, owner, project.id, 'Waiting', {
    statusId: statuses.review,
    position: 'a5',
  });
  await send('pull_request', {
    action: 'reopened',
    pull_request: {
      ...merged,
      state: 'open',
      merged: false,
      merged_at: null,
      updated_at: '2026-11-26T11:00:00Z',
    },
  });
  const reopened = task(one);
  expect(reopened.status_id).toBe(statuses.review);
  expect(reopened.closed_at).toBeNull();
  expect(reopened.position < 'a5').toBe(true);
  const last = entries(one).at(-1)!;
  expect(last.feed_position?.requested).toBe(reopened.position);
  expect(last.changes.map((change) => change.field)).toEqual(['relations', 'statusId']);
  expect(deliveries(webhookId, one).at(-1)!.payload.changedFields).toEqual([
    'relations',
    'statusId',
    'position',
  ]);

  // A trashed task is neither linked nor moved.
  await send('pull_request', {
    action: 'opened',
    pull_request: pr(2, { title: 'AUT-3 gone', updated_at: '2026-11-26T08:00:00Z' }),
  });
  expect(task(trashed).status_id).toBe(statuses.backlog);
  expect(entries(trashed).filter((entry) => entry.via_token_name === 'GitHub')).toHaveLength(0);

  // Two pull requests: the first merging leaves the task in review; the last closing settles it,
  // as merged because one of them merged.
  for (const number of [3, 4])
    await send('pull_request', {
      action: 'opened',
      pull_request: pr(number, { title: 'AUT-4 part', updated_at: '2026-11-26T08:00:00Z' }),
    });
  expect(task(multi).status_id).toBe(statuses.review);
  await send('pull_request', {
    action: 'closed',
    pull_request: pr(3, {
      title: 'AUT-4 part',
      state: 'closed',
      merged: true,
      merged_at: '2026-11-26T09:00:00Z',
      updated_at: '2026-11-26T09:00:00Z',
    }),
  });
  expect(task(multi).status_id).toBe(statuses.review);
  await send('pull_request', {
    action: 'closed',
    pull_request: pr(4, {
      title: 'AUT-4 part',
      state: 'closed',
      updated_at: '2026-11-26T09:30:00Z',
    }),
  });
  expect(task(multi).status_id).toBe(statuses.done);
  expect(statusChanges(multi)).toEqual([statuses.review, statuses.done]);

  // A pull request closed without merging cancels; a task already in a rule's status is left.
  await send('pull_request', {
    action: 'opened',
    pull_request: pr(5, { title: 'AUT-2 try', updated_at: '2026-11-26T08:00:00Z' }),
  });
  await send('pull_request', {
    action: 'opened',
    pull_request: pr(6, { title: 'AUT-2 again', updated_at: '2026-11-26T08:00:00Z' }),
  });
  expect(statusChanges(two)).toEqual([statuses.review]);
  for (const number of [5, 6])
    await send('pull_request', {
      action: 'closed',
      pull_request: pr(number, {
        title: 'AUT-2',
        state: 'closed',
        updated_at: '2026-11-26T09:00:00Z',
      }),
    });
  expect(task(two).status_id).toBe(statuses.cancelled);
  expect(task(two).closed_at).not.toBeNull();

  // An issue closing moves its task; one opening has no rule. From one closed status to another,
  // the closing time is kept.
  const cancelledAt = task(two).closed_at;
  const issue = {
    number: 7,
    title: 'AUT-2 report',
    body: null,
    state: 'open',
    updated_at: '2026-11-26T08:00:00Z',
  };
  await send('issues', { action: 'opened', issue });
  expect(task(two).status_id).toBe(statuses.cancelled);
  await send('issues', {
    action: 'closed',
    issue: { ...issue, state: 'closed', updated_at: '2026-11-26T12:00:00Z' },
  });
  expect(task(two)).toMatchObject({ status_id: statuses.done, closed_at: cancelledAt });

  // Turning the rules off leaves later events to link only.
  await patchRules(request, owner, project.id, { prReadyForReview: null });
  await send('pull_request', {
    action: 'opened',
    pull_request: pr(8, { title: 'AUT-2 more', updated_at: '2026-11-26T13:00:00Z' }),
  });
  expect(task(two).status_id).toBe(statuses.done);
});
