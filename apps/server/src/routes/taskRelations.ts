import { zValidator } from '@hono/zod-validator';
import { createTaskRelationSchema, relationConflictMessage } from '@throw/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { requireUser } from '../lib/requireUser';
import { createTaskRelation, deleteTaskRelation } from '../lib/taskRelationWrites';

const idParam = zValidator('param', z.object({ id: z.uuid() }));

/**
 * Links between tasks of one workspace, across its projects. Both writes are safe to replay,
 * and each records an entry on both tasks' logs.
 */
export const taskRelationRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .post('/', zValidator('json', createTaskRelationSchema), async (c) => {
    const userId = c.get('user')!.id;
    const result = await createTaskRelation({ userId }, c.req.valid('json'));
    // Also a task purged while the link waited in an outbox: it is dropped with a notice.
    if (result === 'not-found') return c.json({ error: 'Task not found' }, 404);
    if (result === 'other-workspace')
      return c.json({ error: 'Related tasks must share a workspace' }, 409);
    if (result === 'taken') return c.json({ error: 'Relation id is in use' }, 409);
    if (result === 'reverse') return c.json({ error: relationConflictMessage.reverse }, 409);
    return result.txid === null ? c.json({ txid: null }) : c.json({ txid: result.txid }, 201);
  })
  .delete('/:id', idParam, async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    return c.json({ txid: await deleteTaskRelation({ userId }, id) });
  });
