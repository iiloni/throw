import { isDeepStrictEqual } from 'node:util';
import type { CommentBody, CreateComment } from '@throw/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db, type Transaction } from '../db/client';
import { commentActivity, comments, tasks } from '../db/schema';
import { currentTxid } from './txid';
import { memberWorkspaces } from './workspaces';
import type { WriteActor } from './writeActor';

export function createComment(actor: WriteActor, body: CreateComment) {
  const { userId, workspaceId, viaTokenName, tokenId } = actor;
  return db.transaction(async (tx) => {
    // A purge cannot remove the task between this read and the insert.
    const [task] = await tx
      .select({ workspaceId: tasks.workspaceId, projectId: tasks.projectId })
      .from(tasks)
      .where(
        and(
          eq(tasks.id, body.taskId),
          inArray(tasks.workspaceId, memberWorkspaces(tx, userId, workspaceId)),
        ),
      )
      .for('key share', { of: tasks });
    if (!task) return 'not-found';
    // Concurrent retries can both hold key-share on the task. The comment's id
    // arbitrates the insert, and a replay never changes its timestamp or author.
    const [inserted] = await tx
      .insert(comments)
      .values({
        ...body,
        ...task,
        userId,
        viaTokenName,
        viaTokenId: tokenId,
        createdAt: sql`clock_timestamp()`,
      })
      .onConflictDoNothing({ target: comments.id })
      .returning();
    if (inserted) {
      await tx.insert(commentActivity).values({
        id: uuidv7(),
        workspaceId: inserted.workspaceId,
        projectId: inserted.projectId,
        taskId: inserted.taskId,
        commentId: inserted.id,
        kind: 'created',
        afterBody: inserted.body,
        userId,
        viaTokenName,
        viaTokenId: tokenId,
        txid: inserted.txid,
        createdAt: inserted.createdAt,
      });
      return currentTxid(tx);
    }
    const [existing] = await tx
      .select({ taskId: comments.taskId })
      .from(comments)
      .where(eq(comments.id, body.id));
    return existing?.taskId === body.taskId ? 'replayed' : 'taken';
  });
}

/**
 * When a write was applied, read under its lock. `now()` is when the transaction started, so
 * a write that waited for another would be dated before it.
 */
const appliedAt = sql`clock_timestamp()`;

/** The comment, locked, if the user can reach it. */
async function lockComment(tx: Transaction, actor: WriteActor, id: string) {
  const workspace = memberWorkspaces(tx, actor.userId, actor.workspaceId);
  // A purge locks the task and cascades to comments. Take the same order before inserting
  // history, whose task foreign key also needs a lock on the task.
  const [task] = await tx
    .select({ id: tasks.id })
    .from(comments)
    .innerJoin(
      tasks,
      and(eq(tasks.id, comments.taskId), eq(tasks.workspaceId, comments.workspaceId)),
    )
    .where(and(eq(comments.id, id), inArray(comments.workspaceId, workspace)))
    .for('key share', { of: tasks });
  if (!task) return undefined;

  const [comment] = await tx
    .select()
    .from(comments)
    .where(
      and(
        eq(comments.id, id),
        eq(comments.taskId, task.id),
        inArray(comments.workspaceId, workspace),
      ),
    )
    .for('update', { of: comments });
  return comment;
}

function recordCommentEdit(
  tx: Transaction,
  actor: WriteActor,
  comment: typeof comments.$inferSelect,
  body: CommentBody | null,
) {
  return tx.insert(commentActivity).values({
    id: uuidv7(),
    workspaceId: comment.workspaceId,
    projectId: comment.projectId,
    taskId: comment.taskId,
    commentId: comment.id,
    kind: body === null ? 'deleted' : 'updated',
    beforeBody: comment.body,
    afterBody: body,
    userId: actor.userId,
    viaTokenName: actor.viaTokenName,
    viaTokenId: actor.tokenId,
  });
}

export function updateComment(actor: WriteActor, id: string, body: CommentBody) {
  return db.transaction(async (tx) => {
    const comment = await lockComment(tx, actor, id);
    if (!comment) return 'not-found';
    if (comment.userId !== actor.userId) return 'not-author';
    if (isDeepStrictEqual(comment.body, body)) return null;
    await tx.update(comments).set({ body, editedAt: appliedAt }).where(eq(comments.id, id));
    await recordCommentEdit(tx, actor, comment, body);
    return currentTxid(tx);
  });
}

export function deleteComment(actor: WriteActor, id: string) {
  return db.transaction(async (tx) => {
    const comment = await lockComment(tx, actor, id);
    if (!comment) return null;
    if (comment.userId !== actor.userId) return 'not-author';
    await tx.delete(comments).where(eq(comments.id, id));
    await recordCommentEdit(tx, actor, comment, null);
    return currentTxid(tx);
  });
}
