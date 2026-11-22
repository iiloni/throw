import { zValidator } from '@hono/zod-validator';
import { createStatusSchema, updateStatusSchema } from '@throw/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { db } from '../db/client';
import { statuses, tasks } from '../db/schema';
import { isPgError, PG_FOREIGN_KEY_VIOLATION } from '../lib/pgError';
import { lockBoardProject } from '../lib/projectWrites';
import { requireUser } from '../lib/requireUser';
import { createStatus, findStatus, StatusIdTaken, updateStatus } from '../lib/statusWrites';
import { currentTxid } from '../lib/txid';

const idParam = zValidator('param', z.object({ id: z.uuid() }));

class Refused extends Error {}

export const statusRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .post('/', zValidator('json', createStatusSchema), async (c) => {
    const actor = { userId: c.get('user')!.id };
    const body = c.req.valid('json');
    try {
      const txid = await db.transaction((tx) => createStatus(tx, actor, body));
      if (txid === 'no-project') return c.json({ error: 'Project not found' }, 404);
      return c.json({ txid }, txid === null ? 200 : 201);
    } catch (error) {
      if (error instanceof StatusIdTaken) return c.json({ error: 'Status id is in use' }, 409);
      throw error;
    }
  })
  .patch('/:id', idParam, zValidator('json', updateStatusSchema), async (c) => {
    const actor = { userId: c.get('user')!.id };
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const txid = await db.transaction((tx) => updateStatus(tx, actor, id, body));
    if (txid === undefined) return c.json({ error: 'Status not found' }, 404);
    return c.json({ txid });
  })
  /**
   * Deletes a status. Refused while it is its category's default, which also keeps a status in
   * every category, or while any task uses it, counting tasks in the trash.
   */
  .delete('/:id', idParam, async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    try {
      const txid = await db.transaction(async (tx) => {
        const found = await findStatus(tx, { userId }, id);
        if (!found || !(await lockBoardProject(tx, { userId }, found.projectId))) return null;
        const status = await findStatus(tx, { userId }, id);
        // Already gone, perhaps deleted by an earlier try of this same queued write.
        if (!status) return null;
        if (status.isDefault) throw new Refused('Make another status the default first');
        const [used] = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(eq(tasks.statusId, id))
          .limit(1);
        if (used) throw new Refused('Tasks use this status');
        await tx.delete(statuses).where(eq(statuses.id, id));
        return currentTxid(tx);
      });
      return c.json({ txid });
    } catch (error) {
      if (error instanceof Refused) return c.json({ error: error.message }, 409);
      // A task moved into the status while it was being deleted.
      if (isPgError(error, PG_FOREIGN_KEY_VIOLATION))
        return c.json({ error: 'Tasks use this status' }, 409);
      throw error;
    }
  });
