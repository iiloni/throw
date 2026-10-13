import { zValidator } from '@hono/zod-validator';
import { createWorkspaceSchema, updateWorkspaceSchema } from '@throw/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { db } from '../db/client';
import { workspaceMembers, workspaces } from '../db/schema';
import { requireUser } from '../lib/requireUser';
import { currentTxid } from '../lib/txid';
import { isMember, memberWorkspaces } from '../lib/workspaces';

const idParam = zValidator('param', z.object({ id: z.uuid() }));

export const workspaceRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .post('/', zValidator('json', createWorkspaceSchema), async (c) => {
    const userId = c.get('user')!.id;
    const body = c.req.valid('json');
    const result = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(workspaces)
        .values(body)
        // Clients replay queued writes, so the workspace may already be here from an earlier try.
        .onConflictDoNothing()
        .returning({ id: workspaces.id });
      if (inserted.length === 0) {
        return (await isMember(tx, userId, body.id)) ? 'replayed' : 'taken';
      }
      await tx.insert(workspaceMembers).values({ workspaceId: body.id, userId, role: 'owner' });
      return currentTxid(tx);
    });
    if (result === 'taken') return c.json({ error: 'Workspace id is in use' }, 409);
    if (result === 'replayed') return c.json({ txid: null });
    return c.json({ txid: result }, 201);
  })
  .patch('/:id', idParam, zValidator('json', updateWorkspaceSchema), async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const txid = await db.transaction(async (tx) => {
      const updated = await tx
        .update(workspaces)
        .set(body)
        .where(and(eq(workspaces.id, id), inArray(workspaces.id, memberWorkspaces(tx, userId))))
        .returning({ id: workspaces.id });
      return updated.length === 0 ? null : currentTxid(tx);
    });
    if (txid === null) return c.json({ error: 'Workspace not found' }, 404);
    return c.json({ txid });
  })
  .delete('/:id', idParam, async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const txid = await db.transaction(async (tx) => {
      const deleted = await tx
        .delete(workspaces)
        .where(and(eq(workspaces.id, id), inArray(workspaces.id, memberWorkspaces(tx, userId))))
        .returning({ id: workspaces.id });
      return deleted.length === 0 ? null : currentTxid(tx);
    });
    // Already gone, perhaps deleted by an earlier try of this same queued write.
    return c.json({ txid });
  });
