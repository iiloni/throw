import { zValidator } from '@hono/zod-validator';
import { createProjectSchema, updateProjectSchema } from '@throw/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { db } from '../db/client';
import { projects } from '../db/schema';
import { requireUser } from '../lib/requireUser';
import { currentTxid } from '../lib/txid';
import { isMember, memberWorkspaces } from '../lib/workspaces';

const idParam = zValidator('param', z.object({ id: z.uuid() }));

export const projectRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .post('/', zValidator('json', createProjectSchema), async (c) => {
    const userId = c.get('user')!.id;
    const body = c.req.valid('json');
    const result = await db.transaction(async (tx) => {
      if (!(await isMember(tx, userId, body.workspaceId))) return 'no-workspace';
      const inserted = await tx
        .insert(projects)
        .values(body)
        // Clients replay queued writes, so the project may already be here from an earlier try.
        .onConflictDoNothing()
        .returning({ id: projects.id });
      if (inserted.length > 0) return currentTxid(tx);
      const [existing] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.id, body.id),
            inArray(projects.workspaceId, memberWorkspaces(tx, userId)),
          ),
        );
      return existing ? 'replayed' : 'taken';
    });
    if (result === 'no-workspace') return c.json({ error: 'Workspace not found' }, 404);
    if (result === 'taken') return c.json({ error: 'Project id is in use' }, 409);
    if (result === 'replayed') return c.json({ txid: null });
    return c.json({ txid: result }, 201);
  })
  .patch('/:id', idParam, zValidator('json', updateProjectSchema), async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const txid = await db.transaction(async (tx) => {
      const updated = await tx
        .update(projects)
        .set(body)
        .where(
          and(eq(projects.id, id), inArray(projects.workspaceId, memberWorkspaces(tx, userId))),
        )
        .returning({ id: projects.id });
      return updated.length === 0 ? null : currentTxid(tx);
    });
    if (txid === null) return c.json({ error: 'Project not found' }, 404);
    return c.json({ txid });
  })
  .delete('/:id', idParam, async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const txid = await db.transaction(async (tx) => {
      const deleted = await tx
        .delete(projects)
        .where(
          and(eq(projects.id, id), inArray(projects.workspaceId, memberWorkspaces(tx, userId))),
        )
        .returning({ id: projects.id });
      return deleted.length === 0 ? null : currentTxid(tx);
    });
    // Already gone, perhaps deleted by an earlier try of this same queued write.
    return c.json({ txid });
  });
