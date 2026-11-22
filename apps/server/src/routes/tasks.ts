import { zValidator } from '@hono/zod-validator';
import { createTaskSchema, updateTaskSchema } from '@throw/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { db } from '../db/client';
import { projects, tasks } from '../db/schema';
import { requireUser } from '../lib/requireUser';
import { lockTagTree } from '../lib/tagTree';
import { createTask, lockTask, updateTask } from '../lib/taskWrites';
import { currentTxid } from '../lib/txid';
import { memberWorkspaces } from '../lib/workspaces';
import { enqueueWebhooks } from '../webhooks/enqueue';

const idParam = zValidator('param', z.object({ id: z.uuid() }));

export const taskRoutes = new Hono<AppEnv>()
  .use(requireUser)
  /**
   * Creates a task with the next number from its project's counter. A create is never dropped
   * for a status deleted meanwhile: the task takes the backlog default (ADR 0005).
   */
  .post('/', zValidator('json', createTaskSchema), async (c) => {
    const userId = c.get('user')!.id;
    const result = await createTask({ userId }, c.req.valid('json'));
    if (result === 'not-found') return c.json({ error: 'Project or parent not found' }, 404);
    if (result === 'bad-parent')
      return c.json({ error: 'A subtask needs a top-level parent in its project' }, 409);
    if (result === 'taken') return c.json({ error: 'Task id is in use' }, 409);
    if (result.txid === null) return c.json({ txid: null });
    const { txid, secondaryTagsTxid } = result;
    return c.json({ txid, ...(secondaryTagsTxid === undefined ? {} : { secondaryTagsTxid }) }, 201);
  })
  /**
   * Applies the fields of an update that still hold, per field, and records the write in the
   * task's log (ADR 0005). Succeeds even when no field applies.
   */
  .patch('/:id', idParam, zValidator('json', updateTaskSchema), async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const result = await updateTask({ userId }, id, c.req.valid('json'));
    if (result === 'not-found') return c.json({ error: 'Task not found' }, 404);
    if (typeof result === 'string') return c.json({ error: 'Change id is in use' }, 409);
    const { txid, refused, secondaryTagsTxid } = result;
    return c.json({
      txid,
      refused,
      ...(secondaryTagsTxid === undefined ? {} : { secondaryTagsTxid }),
    });
  })
  /**
   * Purges a task in the trash, with its subtasks and log. A task that no longer counts as
   * trashed, restored on another device, is left alone.
   */
  .delete('/:id', idParam, async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const txid = await db.transaction(async (tx) => {
      const [scope] = await tx
        .select({ projectId: tasks.projectId })
        .from(tasks)
        .where(and(eq(tasks.id, id), inArray(tasks.workspaceId, memberWorkspaces(tx, userId))));
      if (scope) await lockTagTree(tx, scope.projectId);
      const task = await lockTask(tx, { userId }, id);
      if (!task) return null;
      // Holding the parent and project as well means a restore of either cannot commit between
      // this check and the delete.
      const [project] = await tx
        .select({ deletedAt: projects.deletedAt, key: projects.key })
        .from(projects)
        .where(eq(projects.id, task.projectId))
        .for('share');
      const [parent] =
        task.parentId === null
          ? []
          : await tx
              .select({ deletedAt: tasks.deletedAt })
              .from(tasks)
              .where(eq(tasks.id, task.parentId))
              .for('share');
      if (!task.deletedAt && !parent?.deletedAt && !project?.deletedAt) return null;
      await tx.delete(tasks).where(eq(tasks.id, id));
      await enqueueWebhooks(
        tx,
        { userId },
        {
          event: 'task.deleted',
          workspaceId: task.workspaceId,
          projectId: task.projectId,
          projectKey: project?.key ?? null,
          entityType: 'task',
          kind: 'deleted',
          taskId: id,
          taskNumber: task.number,
        },
      );
      return currentTxid(tx);
    });
    // Already gone, perhaps purged by an earlier try of this same queued write.
    return c.json({ txid });
  });
