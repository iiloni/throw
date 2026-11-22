import { zValidator } from '@hono/zod-validator';
import { createProjectSchema, updateProjectSchema } from '@throw/shared';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { db } from '../db/client';
import { projects } from '../db/schema';
import { createProject, StarterStatusIdTaken, updateProject } from '../lib/projectWrites';
import { requireUser } from '../lib/requireUser';
import { lockTagTree } from '../lib/tagTree';
import { currentTxid } from '../lib/txid';
import { memberWorkspaces } from '../lib/workspaces';

const idParam = zValidator('param', z.object({ id: z.uuid() }));

export const projectRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .post('/', zValidator('json', createProjectSchema), async (c) => {
    const actor = { userId: c.get('user')!.id };
    const body = c.req.valid('json');
    try {
      const txid = await db.transaction((tx) => createProject(tx, actor, body));
      if (txid === 'no-workspace') return c.json({ error: 'Workspace not found' }, 404);
      if (txid === 'taken') return c.json({ error: 'Project id is in use' }, 409);
      return c.json({ txid }, txid === null ? 200 : 201);
    } catch (error) {
      if (error instanceof StarterStatusIdTaken)
        return c.json({ error: 'Status id is in use' }, 409);
      throw error;
    }
  })
  .patch('/:id', idParam, zValidator('json', updateProjectSchema), async (c) => {
    const actor = { userId: c.get('user')!.id };
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const txid = await db.transaction((tx) => updateProject(tx, actor, id, body));
    if (txid === 'not-found') return c.json({ error: 'Project not found' }, 404);
    if (txid === 'key-taken') return c.json({ error: 'Another project has this key' }, 409);
    return c.json({ txid });
  })
  /**
   * Purges a project from the trash, with everything in it. A project that is no longer in the
   * trash, restored on another device, is left alone.
   */
  .delete('/:id', idParam, async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const txid = await db.transaction(async (tx) => {
      await lockTagTree(tx, id);
      const deleted = await tx
        .delete(projects)
        .where(
          and(
            eq(projects.id, id),
            inArray(projects.workspaceId, memberWorkspaces(tx, userId)),
            isNotNull(projects.deletedAt),
          ),
        )
        .returning({ id: projects.id });
      return deleted.length === 0 ? null : currentTxid(tx);
    });
    // Already gone, perhaps purged by an earlier try of this same queued write.
    return c.json({ txid });
  });
