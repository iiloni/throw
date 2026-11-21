import { isDeepStrictEqual } from 'node:util';
import { zValidator } from '@hono/zod-validator';
import { createCommentSchema, updateCommentSchema } from '@throw/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { db, type Transaction } from '../db/client';
import { comments } from '../db/schema';
import { createComment } from '../lib/commentWrites';
import { requireUser } from '../lib/requireUser';
import { currentTxid } from '../lib/txid';
import { memberWorkspaces } from '../lib/workspaces';

const idParam = zValidator('param', z.object({ id: z.uuid() }));

/**
 * When a write was applied, read under its lock. `now()` is when the transaction started, so
 * a write that waited for another would be dated before it.
 */
const appliedAt = sql`clock_timestamp()`;

/** The comment, locked, if the user can reach it. */
async function lockComment(tx: Transaction, userId: string, id: string) {
  const [comment] = await tx
    .select({ userId: comments.userId, body: comments.body })
    .from(comments)
    .where(and(eq(comments.id, id), inArray(comments.workspaceId, memberWorkspaces(tx, userId))))
    .for('update', { of: comments });
  return comment;
}

/**
 * Comments follow the scaffold's rule rather than the task conflict rule: edits apply in the
 * order they arrive (docs/data-model.md). Only the author edits or deletes a comment.
 */
export const commentRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .post('/', zValidator('json', createCommentSchema), async (c) => {
    const userId = c.get('user')!.id;
    const body = c.req.valid('json');
    const result = await createComment({ userId }, body);
    // Also a task purged while the comment waited in an outbox: it is dropped with a notice.
    if (result === 'not-found') return c.json({ error: 'Task not found' }, 404);
    if (result === 'taken') return c.json({ error: 'Comment id is in use' }, 409);
    if (result === 'replayed') return c.json({ txid: null });
    return c.json({ txid: result }, 201);
  })
  .patch('/:id', idParam, zValidator('json', updateCommentSchema), async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const { body } = c.req.valid('json');
    const result = await db.transaction(async (tx) => {
      const comment = await lockComment(tx, userId, id);
      if (!comment) return 'not-found';
      if (comment.userId !== userId) return 'not-author';
      // A resent edit, or one that changes nothing: Electric would stream an update anyway,
      // and `editedAt` would move for nothing.
      if (isDeepStrictEqual(comment.body, body)) return null;
      await tx.update(comments).set({ body, editedAt: appliedAt }).where(eq(comments.id, id));
      return currentTxid(tx);
    });
    if (result === 'not-found') return c.json({ error: 'Comment not found' }, 404);
    if (result === 'not-author') return c.json({ error: 'Only the author can edit it' }, 403);
    return c.json({ txid: result });
  })
  .delete('/:id', idParam, async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const result = await db.transaction(async (tx) => {
      const comment = await lockComment(tx, userId, id);
      // Already gone, perhaps deleted by an earlier try of this same queued write.
      if (!comment) return null;
      if (comment.userId !== userId) return 'not-author';
      await tx.delete(comments).where(eq(comments.id, id));
      return currentTxid(tx);
    });
    if (result === 'not-author') return c.json({ error: 'Only the author can delete it' }, 403);
    return c.json({ txid: result });
  });
