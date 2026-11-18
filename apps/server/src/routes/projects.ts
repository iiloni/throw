import { zValidator } from '@hono/zod-validator';
import {
  createProjectSchema,
  EMPTY_PRIORITY_NAMES,
  settleProjectKey,
  updateProjectSchema,
} from '@throw/shared';
import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { db, type Transaction } from '../db/client';
import { projects, statuses, workspaces } from '../db/schema';
import { requireUser } from '../lib/requireUser';
import { lockTagTree } from '../lib/tagTree';
import { currentTxid } from '../lib/txid';
import { isMember, memberWorkspaces } from '../lib/workspaces';

const idParam = zValidator('param', z.object({ id: z.uuid() }));

/** Keys are settled one write at a time per workspace, so two clashing proposals cannot both win. */
async function lockKeys(tx: Transaction, workspaceId: string) {
  await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .for('no key update');
}

/** Thrown inside a transaction to roll it back and answer 409. */
class IdTaken extends Error {}

export const projectRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .post('/', zValidator('json', createProjectSchema), async (c) => {
    const userId = c.get('user')!.id;
    const { key, statuses: firstStatuses, priorityNames, ...project } = c.req.valid('json');
    try {
      const result = await db.transaction(async (tx) => {
        if (!(await isMember(tx, userId, project.workspaceId))) return 'no-workspace';
        await lockKeys(tx, project.workspaceId);
        // Clients replay queued writes, so the project may already be here from an earlier try.
        const [existing] = await tx
          .select({ workspaceId: projects.workspaceId })
          .from(projects)
          .where(eq(projects.id, project.id));
        if (existing) {
          return (await isMember(tx, userId, existing.workspaceId)) ? 'replayed' : 'taken';
        }
        // Two devices can propose the same key offline. Refusing one would drop the project and
        // every task queued under it, so the later one gets a number (ADR 0007).
        const taken = await tx
          .select({ key: projects.key })
          .from(projects)
          .where(eq(projects.workspaceId, project.workspaceId));
        await tx.insert(projects).values({
          ...project,
          key: settleProjectKey(key, new Set(taken.map((row) => row.key))),
          priorityNames: priorityNames ?? EMPTY_PRIORITY_NAMES,
        });
        const inserted = await tx
          .insert(statuses)
          .values(
            firstStatuses.map((status) => ({
              ...status,
              workspaceId: project.workspaceId,
              projectId: project.id,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: statuses.id });
        if (inserted.length !== firstStatuses.length) throw new IdTaken();
        return currentTxid(tx);
      });
      if (result === 'no-workspace') return c.json({ error: 'Workspace not found' }, 404);
      if (result === 'taken') return c.json({ error: 'Project id is in use' }, 409);
      if (result === 'replayed') return c.json({ txid: null });
      return c.json({ txid: result }, 201);
    } catch (error) {
      if (error instanceof IdTaken) return c.json({ error: 'Status id is in use' }, 409);
      throw error;
    }
  })
  .patch('/:id', idParam, zValidator('json', updateProjectSchema), async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const { trashed, ...changes } = c.req.valid('json');
    const result = await db.transaction(async (tx) => {
      const member = and(
        eq(projects.id, id),
        inArray(projects.workspaceId, memberWorkspaces(tx, userId)),
      );
      const [project] = await tx
        .select({ workspaceId: projects.workspaceId, key: projects.key })
        .from(projects)
        .where(member);
      if (!project) return 'not-found';
      if (changes.key !== undefined && changes.key !== project.key) {
        await lockKeys(tx, project.workspaceId);
        // Projects in the trash keep their keys.
        const [clash] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.workspaceId, project.workspaceId),
              eq(projects.key, changes.key),
              ne(projects.id, id),
            ),
          );
        if (clash) return 'key-taken';
      }
      const set = {
        ...changes,
        // The server's clock; trashing a project already in the trash keeps its time.
        ...(trashed === undefined
          ? {}
          : { deletedAt: trashed ? sql`coalesce(${projects.deletedAt}, now())` : null }),
      };
      if (Object.keys(set).length === 0) return null;
      // A purge on another device may have removed it since it was read.
      const updated = await tx
        .update(projects)
        .set(set)
        .where(member)
        .returning({ id: projects.id });
      return updated.length === 0 ? 'not-found' : currentTxid(tx);
    });
    if (result === 'not-found') return c.json({ error: 'Project not found' }, 404);
    if (result === 'key-taken') return c.json({ error: 'Another project has this key' }, 409);
    return c.json({ txid: result });
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
