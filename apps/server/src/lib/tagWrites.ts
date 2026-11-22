import {
  type ActivityChange,
  type CreateTag,
  type Tag,
  tagSubtreeIds,
  tagWriteIssue,
  type UpdateTag,
} from '@throw/shared';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Transaction } from '../db/client';
import { projects, tags, taskActivity, tasks, taskTags } from '../db/schema';
import { findProject } from './projectWrites';
import { recordStructure } from './structureActivity';
import { lockTagTree, projectTags } from './tagTree';
import { currentTxid } from './txid';
import { memberWorkspaces } from './workspaces';
import type { WriteActor } from './writeActor';

export class TagError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 = 409,
  ) {
    super(message);
  }
}

const member = (tx: Transaction, actor: WriteActor) =>
  inArray(tags.workspaceId, memberWorkspaces(tx, actor.userId, actor.workspaceId));

export async function findTag(tx: Transaction, actor: WriteActor, id: string) {
  const [tag] = await tx
    .select()
    .from(tags)
    .where(and(eq(tags.id, id), member(tx, actor)));
  return tag;
}

function validate(tag: Tag, rows: readonly Tag[]) {
  const issue = tagWriteIssue(tag, rows);
  if (issue) throw new TagError(issue);
}

export async function createTag(tx: Transaction, actor: WriteActor, body: CreateTag) {
  await lockTagTree(tx, body.projectId);
  const [project] = await tx
    .select({ id: projects.id, workspaceId: projects.workspaceId, key: projects.key })
    .from(projects)
    .where(
      and(
        eq(projects.id, body.projectId),
        inArray(projects.workspaceId, memberWorkspaces(tx, actor.userId, actor.workspaceId)),
      ),
    )
    .for('key share');
  if (!project) throw new TagError('Project not found', 404);
  const rows = await projectTags(tx, actor.userId, project.id, actor.workspaceId);
  if (rows.some((tag) => tag.id === body.id)) return null;
  const tag = { ...body, projectId: project.id, workspaceId: project.workspaceId };
  validate(tag, rows);
  const [inserted] = await tx.insert(tags).values(tag).onConflictDoNothing().returning();
  if (!inserted) throw new TagError('Tag id is in use');
  await recordStructure(
    tx,
    actor,
    'tag',
    { ...inserted, projectKey: project.key },
    'created',
    {},
    tagFields(inserted),
  );
  return currentTxid(tx);
}

export async function updateTag(tx: Transaction, actor: WriteActor, id: string, body: UpdateTag) {
  const found = await findTag(tx, actor, id);
  if (!found) throw new TagError('Tag not found', 404);
  await lockTagTree(tx, found.projectId);
  const current = await findTag(tx, actor, id);
  if (!current) throw new TagError('Tag not found', 404);
  // A fractional position belongs to its sibling group.
  const changes =
    body.parentId !== undefined && body.parentId !== current.parentId
      ? { ...body, position: null }
      : body;
  validate(
    { ...current, ...changes },
    await projectTags(tx, actor.userId, current.projectId, actor.workspaceId),
  );
  if (!Object.entries(changes).some(([key, value]) => current[key as keyof Tag] !== value))
    return null;
  const [updated] = await tx
    .update(tags)
    .set(changes)
    .where(and(eq(tags.id, id), member(tx, actor)))
    .returning();
  if (!updated) return null;
  const project = await findProject(tx, actor, updated.projectId);
  await recordStructure(
    tx,
    actor,
    'tag',
    { ...updated, projectKey: project?.key ?? null },
    'updated',
    tagFields(current),
    tagFields(updated),
  );
  return currentTxid(tx);
}

/** The caller holds the project tag tree lock and has planned positions for one sibling group. */
export async function setTagPositions(
  tx: Transaction,
  actor: WriteActor,
  projectId: string,
  updates: readonly { id: string; position: string }[],
) {
  if (!updates.length) return;
  const rows = await projectTags(tx, actor.userId, projectId, actor.workspaceId);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const project = await findProject(tx, actor, projectId);
  await tx.execute(sql`
    UPDATE tags SET position = placement.position
    FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb) AS placement(id uuid, position text)
    WHERE tags.id = placement.id AND tags.project_id = ${projectId}
      AND tags.workspace_id IN (${memberWorkspaces(tx, actor.userId, actor.workspaceId)})
  `);
  for (const { id, position } of updates) {
    const row = byId.get(id);
    if (row)
      await recordStructure(
        tx,
        actor,
        'tag',
        { ...row, projectKey: project?.key ?? null },
        'reordered',
        { position: row.position },
        { position },
      );
  }
}

function tagFields({ name, parentId, position, color, icon }: typeof tags.$inferSelect) {
  return { name, parentId, position, color, icon };
}

export async function deleteTag(tx: Transaction, actor: WriteActor, id: string) {
  const { userId } = actor;
  const found = await findTag(tx, actor, id);
  if (!found) return { txid: null };
  await lockTagTree(tx, found.projectId);
  const rows = await projectTags(tx, userId, found.projectId, actor.workspaceId);
  if (!rows.some((tag) => tag.id === id)) return { txid: null };
  const removed = [...tagSubtreeIds(rows, id)];
  const names = new Map(rows.map((tag) => [tag.id, tag.name]));
  const secondary = await tx
    .select()
    .from(taskTags)
    .where(
      and(
        inArray(taskTags.tagId, removed),
        inArray(taskTags.workspaceId, memberWorkspaces(tx, userId, actor.workspaceId)),
      ),
    );
  const secondaryTasks = [...new Set(secondary.map((row) => row.taskId))];
  const affected = await tx
    .select()
    .from(tasks)
    .where(
      and(
        inArray(tasks.workspaceId, memberWorkspaces(tx, userId, actor.workspaceId)),
        or(
          inArray(tasks.primaryTagId, removed),
          secondaryTasks.length ? inArray(tasks.id, secondaryTasks) : undefined,
        ),
      ),
    )
    .orderBy(tasks.id)
    .for('update');
  const primary = affected.filter(
    (task) => task.primaryTagId !== null && removed.includes(task.primaryTagId),
  );
  for (const task of affected) {
    const changes: ActivityChange[] = [];
    if (task.primaryTagId !== null && removed.includes(task.primaryTagId))
      changes.push({
        field: 'primaryTagId',
        previous: task.primaryTagId,
        previousName: names.get(task.primaryTagId) ?? null,
        requested: null,
        requestedName: null,
        applied: true,
      });
    for (const row of secondary.filter((row) => row.taskId === task.id))
      changes.push({
        field: 'secondaryTags',
        tagId: row.tagId,
        previous: row.tagId,
        previousName: names.get(row.tagId) ?? null,
        requested: null,
        requestedName: null,
        applied: true,
      });
    await tx.insert(taskActivity).values({
      id: uuidv7(),
      taskId: task.id,
      projectId: task.projectId,
      workspaceId: task.workspaceId,
      userId,
      viaTokenName: actor.viaTokenName,
      viaTokenId: actor.tokenId,
      kind: 'updated',
      changes,
      // As with task writes, timestamp after taking the task's lock.
      createdAt: sql`clock_timestamp()`,
    });
  }
  // Cleanup is derived from current server rows, never from the deleting device's snapshot.
  if (primary.length)
    await tx
      .update(tasks)
      .set({ primaryTagId: null })
      .where(
        and(
          inArray(
            tasks.id,
            primary.map((task) => task.id),
          ),
          inArray(tasks.workspaceId, memberWorkspaces(tx, userId, actor.workspaceId)),
        ),
      );
  await tx
    .delete(tags)
    .where(
      and(
        inArray(tags.id, removed),
        inArray(tags.workspaceId, memberWorkspaces(tx, userId, actor.workspaceId)),
      ),
    );
  const project = await findProject(tx, actor, found.projectId);
  const removedIds = new Set(removed);
  for (const row of rows) {
    if (removedIds.has(row.id)) {
      await recordStructure(
        tx,
        actor,
        'tag',
        { ...row, projectKey: project?.key ?? null },
        'deleted',
        tagFields(row),
        {},
      );
    }
  }
  const txid = await currentTxid(tx);
  return {
    txid,
    ...(primary.length ? { tasksTxid: txid } : {}),
    ...(secondary.length ? { secondaryTagsTxid: txid } : {}),
  };
}
