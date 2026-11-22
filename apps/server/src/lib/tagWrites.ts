import { type CreateTag, type Tag, tagWriteIssue, type UpdateTag } from '@throw/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { projects, tags } from '../db/schema';
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
    .select({ id: projects.id, workspaceId: projects.workspaceId })
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
  const inserted = await tx
    .insert(tags)
    .values(tag)
    .onConflictDoNothing()
    .returning({ id: tags.id });
  if (!inserted.length) throw new TagError('Tag id is in use');
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
  await tx
    .update(tags)
    .set(changes)
    .where(and(eq(tags.id, id), member(tx, actor)));
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
  await tx.execute(sql`
    UPDATE tags SET position = placement.position
    FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb) AS placement(id uuid, position text)
    WHERE tags.id = placement.id AND tags.project_id = ${projectId}
      AND tags.workspace_id IN (${memberWorkspaces(tx, actor.userId, actor.workspaceId)})
  `);
}
