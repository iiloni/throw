import type { CreateComment } from '@throw/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { comments, tasks } from '../db/schema';
import { currentTxid } from './txid';
import { memberWorkspaces } from './workspaces';
import type { WriteActor } from './writeActor';

export function createComment(
  { userId, workspaceId, viaTokenName }: WriteActor,
  body: CreateComment,
) {
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
      .values({ ...body, ...task, userId, viaTokenName, createdAt: sql`clock_timestamp()` })
      .onConflictDoNothing({ target: comments.id })
      .returning({ id: comments.id });
    if (inserted) return currentTxid(tx);
    const [existing] = await tx
      .select({ taskId: comments.taskId })
      .from(comments)
      .where(eq(comments.id, body.id));
    return existing?.taskId === body.taskId ? 'replayed' : 'taken';
  });
}
