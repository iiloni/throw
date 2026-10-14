import { zValidator } from '@hono/zod-validator';
import { createStatusSchema, type StatusCategory, updateStatusSchema } from '@throw/shared';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { db, type Transaction } from '../db/client';
import { projects, statuses, tasks } from '../db/schema';
import { isPgError, PG_FOREIGN_KEY_VIOLATION } from '../lib/pgError';
import { requireUser } from '../lib/requireUser';
import { currentTxid } from '../lib/txid';
import { memberWorkspaces } from '../lib/workspaces';

const idParam = zValidator('param', z.object({ id: z.uuid() }));

/**
 * Locks a project the user can reach. Status writes take it so that the rules over a
 * project's statuses (one default per category, none left empty) hold under concurrent
 * writes; task creation takes it too.
 */
async function lockProject(tx: Transaction, userId: string, projectId: string) {
  const [project] = await tx
    .select({ id: projects.id, workspaceId: projects.workspaceId })
    .from(projects)
    .where(
      and(eq(projects.id, projectId), inArray(projects.workspaceId, memberWorkspaces(tx, userId))),
    )
    .for('no key update', { of: projects });
  return project;
}

/** The status, if the user can reach it. */
async function findStatus(tx: Transaction, userId: string, id: string) {
  const [status] = await tx
    .select()
    .from(statuses)
    .where(and(eq(statuses.id, id), inArray(statuses.workspaceId, memberWorkspaces(tx, userId))));
  return status;
}

/** Clears the default of a status's category, before another status takes it. */
function clearDefault(
  tx: Transaction,
  status: { projectId: string; category: StatusCategory; id: string },
) {
  return tx
    .update(statuses)
    .set({ isDefault: false })
    .where(
      and(
        eq(statuses.projectId, status.projectId),
        eq(statuses.category, status.category),
        eq(statuses.isDefault, true),
        ne(statuses.id, status.id),
      ),
    );
}

/** Thrown inside a transaction to roll it back and answer 409. */
class Refused extends Error {}

export const statusRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .post('/', zValidator('json', createStatusSchema), async (c) => {
    const userId = c.get('user')!.id;
    const body = c.req.valid('json');
    const result = await db.transaction(async (tx) => {
      const project = await lockProject(tx, userId, body.projectId);
      if (!project) return 'no-project';
      // Clients replay queued writes, so the status may already be here from an earlier try.
      const [existing] = await tx
        .select({ projectId: statuses.projectId })
        .from(statuses)
        .where(eq(statuses.id, body.id));
      if (existing) return existing.projectId === project.id ? 'replayed' : 'taken';
      if (body.isDefault) await clearDefault(tx, body);
      await tx.insert(statuses).values({ ...body, workspaceId: project.workspaceId });
      return currentTxid(tx);
    });
    if (result === 'no-project') return c.json({ error: 'Project not found' }, 404);
    if (result === 'taken') return c.json({ error: 'Status id is in use' }, 409);
    if (result === 'replayed') return c.json({ txid: null });
    return c.json({ txid: result }, 201);
  })
  .patch('/:id', idParam, zValidator('json', updateStatusSchema), async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const changes = c.req.valid('json');
    const txid = await db.transaction(async (tx) => {
      const found = await findStatus(tx, userId, id);
      if (!found || !(await lockProject(tx, userId, found.projectId))) return undefined;
      const status = await findStatus(tx, userId, id);
      if (!status) return undefined;
      if (Object.keys(changes).length === 0) return null;
      if (changes.isDefault) await clearDefault(tx, status);
      await tx.update(statuses).set(changes).where(eq(statuses.id, id));
      return currentTxid(tx);
    });
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
        const found = await findStatus(tx, userId, id);
        if (!found || !(await lockProject(tx, userId, found.projectId))) return null;
        const status = await findStatus(tx, userId, id);
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
