import {
  type ActivityChange,
  descriptionSchema,
  type McpInput,
  type McpOutput,
  type McpPageInput,
  openBlockers,
  relationRole,
  SYNCED_ACTIVITY_KINDS,
  TASK_RELATION_ROLES,
} from '@throw/shared';
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../db/client';
import {
  comments,
  githubReleases,
  projects,
  statuses,
  tags,
  taskActivity,
  taskGithubLinks,
  taskGithubReleases,
  taskRelations,
  tasks,
  taskTags,
  workspaces,
} from '../db/schema';
import { publicLink } from '../github/linkData';
import { publicRelease } from '../github/releases';
import type { McpActor } from '../lib/mcpTokens';
import { memberWorkspaces } from '../lib/workspaces';
import { blocksToMarkdown } from './markdown';

export class ToolError extends Error {}

const workspacesFor = (actor: McpActor) => memberWorkspaces(db, actor.userId, actor.workspaceId);

function uuidPage<T extends { id: string }>(rows: T[], { limit }: McpPageInput) {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
}

function timelinePage<T extends { id: string; createdAt: string }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  const cursor = rows.length > limit ? items.at(-1) : undefined;
  return { items, nextCursor: cursor ? { id: cursor.id, createdAt: cursor.createdAt } : null };
}

export async function listWorkspaces(actor: McpActor): Promise<McpOutput<'list_workspaces'>> {
  const items = await db
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(inArray(workspaces.id, workspacesFor(actor)));
  return { items };
}

export async function listProjects(
  actor: McpActor,
  input: McpInput<'list_projects'>,
): Promise<McpOutput<'list_projects'>> {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      key: projects.key,
      color: projects.color,
      icon: projects.icon,
      position: projects.position,
      priorityNames: projects.priorityNames,
      trashed: sql<boolean>`${projects.deletedAt} IS NOT NULL`,
    })
    .from(projects)
    .where(
      and(
        inArray(projects.workspaceId, workspacesFor(actor)),
        input.includeTrashed ? undefined : isNull(projects.deletedAt),
        input.cursor ? gt(projects.id, input.cursor) : undefined,
      ),
    )
    .orderBy(projects.id)
    .limit(input.limit + 1);
  return uuidPage(rows, input);
}

export async function requireProject(actor: McpActor, id: string) {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, id), inArray(projects.workspaceId, workspacesFor(actor))));
  if (!project) throw new ToolError('Project not found.');
}

export async function listStatuses(
  actor: McpActor,
  input: McpInput<'list_statuses'>,
): Promise<McpOutput<'list_statuses'>> {
  await requireProject(actor, input.projectId);
  const rows = await db
    .select({
      id: statuses.id,
      name: statuses.name,
      color: statuses.color,
      category: statuses.category,
      position: statuses.position,
      isDefault: statuses.isDefault,
    })
    .from(statuses)
    .where(
      and(
        eq(statuses.projectId, input.projectId),
        inArray(statuses.workspaceId, workspacesFor(actor)),
        input.cursor ? gt(statuses.id, input.cursor) : undefined,
      ),
    )
    .orderBy(statuses.id)
    .limit(input.limit + 1);
  return uuidPage(rows, input);
}

export async function listTags(
  actor: McpActor,
  input: McpInput<'list_tags'>,
): Promise<McpOutput<'list_tags'>> {
  await requireProject(actor, input.projectId);
  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      parentId: tags.parentId,
      color: tags.color,
      icon: tags.icon,
      position: tags.position,
    })
    .from(tags)
    .where(
      and(
        eq(tags.projectId, input.projectId),
        inArray(tags.workspaceId, workspacesFor(actor)),
        input.cursor ? gt(tags.id, input.cursor) : undefined,
      ),
    )
    .orderBy(tags.id)
    .limit(input.limit + 1);
  const { items, nextCursor } = uuidPage(rows, input);
  if (items.length === 0) return { items: [], nextCursor };

  // Walk only the ancestors of the requested page, including parents on other pages.
  const ancestors = await db.execute<{ leaf: string; path: string[] }>(sql`
    WITH RECURSIVE ancestors AS (
      SELECT id AS leaf, id, parent_id, ARRAY[id] AS visited, ARRAY[name] AS path
      FROM tags WHERE id IN (${sql.join(
        items.map((tag) => sql`${tag.id}::uuid`),
        sql`, `,
      )})
        AND project_id = ${input.projectId} AND workspace_id IN (${workspacesFor(actor)})
      UNION ALL
      SELECT a.leaf, parent.id, parent.parent_id, parent.id || a.visited, parent.name || a.path
      FROM ancestors a JOIN tags parent ON a.parent_id = parent.id
      WHERE parent.project_id = ${input.projectId} AND parent.workspace_id IN (${workspacesFor(actor)})
        AND NOT parent.id = ANY(a.visited)
    )
    SELECT DISTINCT ON (leaf) leaf, path FROM ancestors ORDER BY leaf, cardinality(path) DESC
  `);
  const paths = new Map(ancestors.map(({ leaf, path }) => [leaf, path]));
  return {
    items: items.flatMap((row) => {
      const path = paths.get(row.id);
      return path ? [{ ...row, path }] : [];
    }),
    nextCursor,
  };
}

const parent = alias(tasks, 'parent');
const key = sql<string>`${projects.key} || '-' || ${tasks.number}`;
const trashed = or(
  isNotNull(tasks.deletedAt),
  isNotNull(parent.deletedAt),
  isNotNull(projects.deletedAt),
)!;
const summary = {
  id: tasks.id,
  key,
  projectId: tasks.projectId,
  title: tasks.title,
  statusId: tasks.statusId,
  category: statuses.category,
  priority: tasks.priority,
  size: tasks.size,
  parentId: tasks.parentId,
  primaryTagId: tasks.primaryTagId,
  trashed: sql<boolean>`${tasks.deletedAt} IS NOT NULL`,
  effectivelyTrashed: sql<boolean>`${trashed}`,
  closedAt: tasks.closedAt,
};

const summarize = <T extends { closedAt: Date | null }>(row: T) => ({
  ...row,
  closedAt: row.closedAt?.toISOString() ?? null,
});

function taskPage(actor: McpActor, input: McpPageInput, ...filters: (SQL | undefined)[]) {
  return db
    .select(summary)
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .innerJoin(statuses, eq(tasks.statusId, statuses.id))
    .leftJoin(parent, eq(tasks.parentId, parent.id))
    .where(
      and(
        inArray(tasks.workspaceId, workspacesFor(actor)),
        input.cursor ? gt(tasks.id, input.cursor) : undefined,
        ...filters,
      ),
    )
    .orderBy(asc(tasks.id))
    .limit(input.limit + 1);
}

function taskFilter(reference: string) {
  const match = /^([A-Z][A-Z0-9]*)-([1-9][0-9]*)$/.exec(reference);
  if (!match) return eq(tasks.id, reference);
  const number = Number(match[2]);
  return number <= 2_147_483_647
    ? and(eq(projects.key, match[1]!), eq(tasks.number, number))
    : sql`false`;
}

export async function findTask(actor: McpActor, reference: string) {
  const [task] = await db
    .select({ id: tasks.id, projectId: tasks.projectId, key })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(inArray(tasks.workspaceId, workspacesFor(actor)), taskFilter(reference)))
    .limit(1);
  return task;
}

export async function requireTask(actor: McpActor, reference: string) {
  const task = await findTask(actor, reference);
  if (!task) throw new ToolError('Task not found.');
  return task;
}

export async function listTasks(
  actor: McpActor,
  input: McpInput<'list_tasks'>,
): Promise<McpOutput<'list_tasks'>> {
  const bound = (filter: SQL | undefined) =>
    db
      .select({ id: githubReleases.id })
      .from(taskGithubReleases)
      .innerJoin(githubReleases, eq(githubReleases.id, taskGithubReleases.releaseId))
      .where(
        and(
          eq(taskGithubReleases.taskId, tasks.id),
          inArray(githubReleases.workspaceId, workspacesFor(actor)),
          filter,
        ),
      );
  const parentId =
    typeof input.parent === 'string' ? (await requireTask(actor, input.parent)).id : input.parent;
  const rows = await taskPage(
    actor,
    input,
    input.projectId ? eq(tasks.projectId, input.projectId) : undefined,
    input.release
      ? exists(
          bound(
            or(
              eq(githubReleases.tagName, input.release),
              sql`${githubReleases.id}::text = ${input.release}`,
            ),
          ),
        )
      : undefined,
    input.unreleased
      ? and(
          exists(
            db
              .select({ id: taskGithubLinks.id })
              .from(taskGithubLinks)
              .where(
                and(
                  eq(taskGithubLinks.taskId, tasks.id),
                  eq(taskGithubLinks.kind, 'pr'),
                  eq(taskGithubLinks.state, 'merged'),
                ),
              ),
          ),
          sql`NOT ${exists(bound(and(eq(githubReleases.isDraft, false), isNotNull(githubReleases.publishedAt))))}`,
        )
      : undefined,
    input.statusId ? eq(tasks.statusId, input.statusId) : undefined,
    input.category ? eq(statuses.category, input.category) : undefined,
    input.priority ? eq(tasks.priority, input.priority) : undefined,
    input.size === undefined
      ? undefined
      : input.size === null
        ? isNull(tasks.size)
        : eq(tasks.size, input.size),
    parentId === null
      ? isNull(tasks.parentId)
      : parentId
        ? eq(tasks.parentId, parentId)
        : undefined,
    input.trash === 'all' ? undefined : input.trash === 'trashed' ? trashed : sql`NOT ${trashed}`,
    input.tagId
      ? or(
          eq(tasks.primaryTagId, input.tagId),
          exists(
            db
              .select({ tagId: taskTags.tagId })
              .from(taskTags)
              .where(
                and(
                  eq(taskTags.taskId, tasks.id),
                  eq(taskTags.tagId, input.tagId),
                  inArray(taskTags.workspaceId, workspacesFor(actor)),
                ),
              ),
          ),
        )
      : undefined,
    input.query
      ? sql`(
      strpos(lower(${tasks.title}), lower(${input.query})) > 0 OR
      strpos(lower(${key}), lower(${input.query})) > 0 OR
      EXISTS (
        SELECT 1 FROM jsonb_path_query(${tasks.description}, 'lax $.**.text ? (@.type() == "string")') AS fragment
        WHERE strpos(lower(fragment #>> '{}'), lower(${input.query})) > 0
      )
    )`
      : undefined,
  );
  return uuidPage(rows.map(summarize), input);
}

// Keep cursor precision from Postgres. JavaScript's Date alone would round timestamps
// from clock_timestamp() and skip or repeat rows at the same millisecond.
const timeForCursor = (column: typeof comments.createdAt | typeof taskActivity.createdAt) =>
  sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
type TimelineCursor = NonNullable<McpInput<'get_task'>['history']['cursor']>;
const beforeCursor = (
  table: typeof comments | typeof taskActivity,
  cursor: TimelineCursor | undefined,
) =>
  cursor
    ? sql`(${table.createdAt}, ${table.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
    : undefined;

export function exposeChanges(changes: ActivityChange[]) {
  return changes.map(({ rejectedDocument, ...change }) => {
    const document = descriptionSchema.safeParse(rejectedDocument);
    return document.success
      ? { ...change, rejectedDescription: blocksToMarkdown(document.data) }
      : change;
  });
}

/** One task's summary as a relation endpoint, for replayed relation responses. */
export async function relationTargetOf(actor: McpActor, taskId: string) {
  const [target] = await db
    .select({
      id: tasks.id,
      key,
      projectId: tasks.projectId,
      title: tasks.title,
      category: statuses.category,
      effectivelyTrashed: sql<boolean>`${trashed}`,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .innerJoin(statuses, eq(tasks.statusId, statuses.id))
    .leftJoin(parent, eq(tasks.parentId, parent.id))
    .where(and(eq(tasks.id, taskId), inArray(tasks.workspaceId, workspacesFor(actor))))
    .limit(1);
  if (!target) throw new ToolError('Task not found.');
  return target;
}

/** A task's relations, as it sees them, with the tasks on their other ends. */
export async function taskRelationsOf(actor: McpActor, taskId: string) {
  const rows = await db
    .select()
    .from(taskRelations)
    .where(
      and(
        or(eq(taskRelations.sourceTaskId, taskId), eq(taskRelations.targetTaskId, taskId)),
        inArray(taskRelations.workspaceId, workspacesFor(actor)),
      ),
    );
  const seen = rows.map((row) => ({ row, ...relationRole(row, taskId)! }));
  const others = seen.length
    ? await db
        .select({
          id: tasks.id,
          key,
          projectId: tasks.projectId,
          title: tasks.title,
          category: statuses.category,
          effectivelyTrashed: sql<boolean>`${trashed}`,
        })
        .from(tasks)
        .innerJoin(projects, eq(tasks.projectId, projects.id))
        .innerJoin(statuses, eq(tasks.statusId, statuses.id))
        .leftJoin(parent, eq(tasks.parentId, parent.id))
        .where(
          and(
            inArray(
              tasks.id,
              seen.map((item) => item.otherTaskId),
            ),
            inArray(tasks.workspaceId, workspacesFor(actor)),
          ),
        )
    : [];
  const byId = new Map(others.map((task) => [task.id, task]));
  const relations = seen
    .flatMap(({ row, role, otherTaskId }) => {
      const task = byId.get(otherTaskId);
      return task ? [{ id: row.id, relation: role, task }] : [];
    })
    .sort(
      (a, b) =>
        TASK_RELATION_ROLES.indexOf(a.relation) - TASK_RELATION_ROLES.indexOf(b.relation) ||
        a.task.key.localeCompare(b.task.key, undefined, { numeric: true }),
    );
  const blocked =
    openBlockers(taskId, rows, (id) => {
      const task = byId.get(id);
      return task && { task, category: task.category, trashed: task.effectivelyTrashed };
    }).length > 0;
  return { relations, blocked };
}

export async function getTask(
  actor: McpActor,
  input: McpInput<'get_task'>,
): Promise<McpOutput<'get_task'>> {
  const [task] = await db
    .select({
      ...summary,
      description: tasks.description,
      descriptionVersion: tasks.descriptionVersion,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .innerJoin(statuses, eq(tasks.statusId, statuses.id))
    .leftJoin(parent, eq(tasks.parentId, parent.id))
    .where(and(inArray(tasks.workspaceId, workspacesFor(actor)), taskFilter(input.task)))
    .limit(1);
  if (!task) throw new ToolError('Task not found.');

  const [subtaskRows, commentRows, historyRows, assignments, linked, githubRows, releases] =
    await Promise.all([
      taskPage(actor, input.subtasks, eq(tasks.parentId, task.id)),
      db
        .select({
          id: comments.id,
          userId: comments.userId,
          viaTokenName: comments.viaTokenName,
          createdAt: timeForCursor(comments.createdAt),
          editedAt: comments.editedAt,
          body: comments.body,
        })
        .from(comments)
        .where(
          and(
            eq(comments.taskId, task.id),
            inArray(comments.workspaceId, workspacesFor(actor)),
            beforeCursor(comments, input.comments.cursor),
          ),
        )
        .orderBy(desc(comments.createdAt), desc(comments.id))
        .limit(input.comments.limit + 1),
      db
        .select({
          id: taskActivity.id,
          kind: sql<'created' | 'updated'>`${taskActivity.kind}`,
          userId: taskActivity.userId,
          viaTokenName: taskActivity.viaTokenName,
          createdAt: timeForCursor(taskActivity.createdAt),
          changes: taskActivity.changes,
        })
        .from(taskActivity)
        .where(
          and(
            eq(taskActivity.taskId, task.id),
            inArray(taskActivity.workspaceId, workspacesFor(actor)),
            inArray(taskActivity.kind, SYNCED_ACTIVITY_KINDS),
            beforeCursor(taskActivity, input.history.cursor),
          ),
        )
        .orderBy(desc(taskActivity.createdAt), desc(taskActivity.id))
        .limit(input.history.limit + 1),
      db
        .select({ tagId: taskTags.tagId })
        .from(taskTags)
        .where(
          and(eq(taskTags.taskId, task.id), inArray(taskTags.workspaceId, workspacesFor(actor))),
        )
        .orderBy(taskTags.tagId),
      taskRelationsOf(actor, task.id),
      db
        .select()
        .from(taskGithubLinks)
        .where(
          and(
            eq(taskGithubLinks.taskId, task.id),
            inArray(taskGithubLinks.workspaceId, workspacesFor(actor)),
          ),
        )
        .orderBy(taskGithubLinks.id),
      db
        .select({ release: githubReleases })
        .from(taskGithubReleases)
        .innerJoin(githubReleases, eq(githubReleases.id, taskGithubReleases.releaseId))
        .where(
          and(
            eq(taskGithubReleases.taskId, task.id),
            inArray(githubReleases.workspaceId, workspacesFor(actor)),
          ),
        )
        .orderBy(githubReleases.tagName),
    ]);

  const commentPage = timelinePage(commentRows, input.comments.limit);
  const historyPage = timelinePage(historyRows, input.history.limit);
  const { description, ...row } = task;
  return {
    task: {
      ...summarize(row),
      description: blocksToMarkdown(description),
      secondaryTagIds: assignments.map(({ tagId }) => tagId),
      blocked: linked.blocked,
    },
    relations: linked.relations,
    githubReleases: releases.map(({ release }) => publicRelease(release)),
    githubLinks: githubRows.map(publicLink),
    subtasks: uuidPage(subtaskRows.map(summarize), input.subtasks),
    comments: {
      ...commentPage,
      items: commentPage.items.map(({ body, editedAt, ...item }) => ({
        ...item,
        body: blocksToMarkdown(body),
        editedAt: editedAt?.toISOString() ?? null,
      })),
    },
    history: {
      ...historyPage,
      items: historyPage.items.map(({ changes, ...item }) => ({
        ...item,
        changes: exposeChanges(changes),
      })),
    },
  };
}
