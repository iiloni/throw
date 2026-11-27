import { SYNCED_ACTIVITY_KINDS } from '@throw/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { env } from '../env';
import { requireUser } from '../lib/requireUser';

/** The workspaces the signed-in user belongs to, as a subquery on `$1`, their id. */
const MEMBER_WORKSPACES = 'SELECT workspace_id FROM workspace_members WHERE user_id = $1';

/**
 * What clients may sync: an explicit column list per table, and the filter that keeps a
 * shape to rows in the user's workspaces. Server-only columns stay out.
 */
export const SHAPES: Record<string, { table: string; columns: string[]; where: string }> = {
  workspaces: {
    table: 'workspaces',
    columns: ['id', 'name', 'position'],
    where: `id IN (${MEMBER_WORKSPACES})`,
  },
  projects: {
    table: 'projects',
    // Not `task_counter`: numbers are the server's to hand out.
    columns: [
      'id',
      'workspace_id',
      'name',
      'color',
      'icon',
      'position',
      'key',
      'priority_names',
      'deleted_at',
    ],
    where: `workspace_id IN (${MEMBER_WORKSPACES})`,
  },
  statuses: {
    table: 'statuses',
    columns: [
      'id',
      'workspace_id',
      'project_id',
      'name',
      'category',
      'position',
      'is_default',
      'color',
    ],
    where: `workspace_id IN (${MEMBER_WORKSPACES})`,
  },
  tags: {
    table: 'tags',
    columns: ['id', 'workspace_id', 'project_id', 'name', 'parent_id', 'icon', 'color', 'position'],
    where: `workspace_id IN (${MEMBER_WORKSPACES})`,
  },
  'task-tags': {
    table: 'task_tags',
    columns: ['task_id', 'tag_id', 'workspace_id', 'project_id'],
    where: `workspace_id IN (${MEMBER_WORKSPACES})`,
  },
  // Links between those tasks, across projects of one workspace.
  'github-releases': {
    table: 'github_releases',
    columns: [
      'id',
      'workspace_id',
      'project_id',
      'repo',
      'tag_name',
      'name',
      'url',
      'target_commitish',
      'source',
      'is_draft',
      'is_prerelease',
      'published_at',
      'created_at',
      'updated_at',
    ],
    where: `workspace_id IN (${MEMBER_WORKSPACES})`,
  },
  'task-github-releases': {
    table: 'task_github_releases',
    columns: [
      'id',
      'workspace_id',
      'project_id',
      'task_id',
      'release_id',
      'matched_by',
      'created_at',
    ],
    where: `workspace_id IN (${MEMBER_WORKSPACES})`,
  },
  'task-github-links': {
    table: 'task_github_links',
    columns: [
      'id',
      'workspace_id',
      'project_id',
      'task_id',
      'repo',
      'kind',
      'number',
      'url',
      'title',
      'state',
      'review_decision',
      'checks_summary',
      'branch',
      'merge_commit_sha',
      'merged_at',
      'created_at',
      'updated_at',
    ],
    where: `workspace_id IN (${MEMBER_WORKSPACES})`,
  },
  'task-relations': {
    table: 'task_relations',
    columns: ['id', 'workspace_id', 'source_task_id', 'target_task_id', 'kind', 'created_at'],
    where: `workspace_id IN (${MEMBER_WORKSPACES})`,
  },
  // Every task the user can reach, in the trash and closed ones included, so both can be
  // shown offline.
  tasks: {
    table: 'tasks',
    columns: [
      'id',
      'workspace_id',
      'project_id',
      'number',
      'title',
      'description',
      'description_version',
      'status_id',
      'priority',
      'size',
      'position',
      'parent_id',
      'primary_tag_id',
      'closed_at',
      'deleted_at',
      'created_at',
    ],
    where: `workspace_id IN (${MEMBER_WORKSPACES})`,
  },
  // The log of every task above, so a task's timeline reads offline. Entries that only record
  // a reorder's change id stay on the server.
  task_activity: {
    table: 'task_activity',
    columns: [
      'id',
      'workspace_id',
      'project_id',
      'task_id',
      'user_id',
      'via_token_name',
      'kind',
      'changes',
      'created_at',
    ],
    where: `kind IN (${SYNCED_ACTIVITY_KINDS.map((kind) => `'${kind}'`).join(', ')}) AND workspace_id IN (${MEMBER_WORKSPACES})`,
  },
  comments: {
    table: 'comments',
    columns: [
      'id',
      'workspace_id',
      'project_id',
      'task_id',
      'user_id',
      'via_token_name',
      'body',
      'created_at',
      'edited_at',
    ],
    where: `workspace_id IN (${MEMBER_WORKSPACES})`,
  },
};

/**
 * What a client may ask of its shape: where to resume it and how to wait for changes.
 * Electric's other parameters choose rows (`where`, `subset__*`), which is the server's call.
 */
const CLIENT_PARAMS = [
  'offset',
  'handle',
  'cursor',
  'live',
  'live_sse',
  'experimental_live_sse',
  'expired_handle',
  'log',
  'cache-buster',
];

/**
 * Auth proxy in front of Electric. Clients never talk to Electric directly;
 * the server decides which table and rows each user can sync.
 */
export const shapeRoutes = new Hono<AppEnv>()
  .use(async (c, next) => {
    await next();
    // Electric answers as if for a CDN, and a browser would keep its responses too. A reload
    // then restarts the shape from a snapshot cached days ago, which counts as caught up until
    // the log replays, so the app shows old rows as current. They are one user's rows besides.
    // Devices keep their own copy (ADR 0002); the HTTP cache adds nothing.
    c.res.headers.set('cache-control', 'no-store');
    // For a cache in front of the server that is set to ignore `no-store`.
    c.res.headers.set('vary', 'cookie, authorization');
  })
  .use(requireUser)
  .get('/:shape', async (c) => {
    const shape = Object.hasOwn(SHAPES, c.req.param('shape')) ? SHAPES[c.req.param('shape')] : null;
    if (!shape) return c.json({ error: 'Shape not found' }, 404);
    const user = c.get('user')!;
    const incoming = new URL(c.req.url);
    const upstream = new URL('/v1/shape', env.ELECTRIC_URL);

    for (const [key, value] of incoming.searchParams) {
      if (CLIENT_PARAMS.includes(key)) upstream.searchParams.set(key, value);
    }
    upstream.searchParams.set('table', shape.table);
    upstream.searchParams.set('columns', shape.columns.join(','));
    upstream.searchParams.set('where', shape.where);
    upstream.searchParams.set('params[1]', user.id);
    if (env.ELECTRIC_SECRET) upstream.searchParams.set('secret', env.ELECTRIC_SECRET);

    const response = await fetch(upstream);
    const headers = new Headers(response.headers);
    // fetch already decoded the body, so these no longer describe it.
    headers.delete('content-encoding');
    headers.delete('content-length');
    return new Response(response.body, { status: response.status, headers });
  });
