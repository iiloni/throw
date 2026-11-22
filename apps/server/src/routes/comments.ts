import { zValidator } from '@hono/zod-validator';
import { createCommentSchema, updateCommentSchema } from '@throw/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { createComment, deleteComment, updateComment } from '../lib/commentWrites';
import { requireUser } from '../lib/requireUser';

const idParam = zValidator('param', z.object({ id: z.uuid() }));

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
    const result = await updateComment({ userId }, id, body);
    if (result === 'not-found') return c.json({ error: 'Comment not found' }, 404);
    if (result === 'not-author') return c.json({ error: 'Only the author can edit it' }, 403);
    return c.json({ txid: result });
  })
  .delete('/:id', idParam, async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const result = await deleteComment({ userId }, id);
    if (result === 'not-author') return c.json({ error: 'Only the author can delete it' }, 403);
    return c.json({ txid: result });
  });
