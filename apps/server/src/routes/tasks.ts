import { zValidator } from '@hono/zod-validator';
import {
  type ActivityChange,
  createTaskSchema,
  isClosedCategory,
  type RefusedField,
  refusedFieldSchema,
  type UpdateTaskResponse,
  updateTaskSchema,
} from '@throw/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { db, type Transaction } from '../db/client';
import { projects, statuses, taskActivity, tasks } from '../db/schema';
import { requireUser } from '../lib/requireUser';
import { planTaskUpdate } from '../lib/taskUpdate';
import { currentTxid } from '../lib/txid';
import { memberWorkspaces } from '../lib/workspaces';

const idParam = zValidator('param', z.object({ id: z.uuid() }));

/**
 * Locks a task row the user can reach. An update holds its task, and a write that makes a task
 * a parent holds that parent, so two writes cannot nest subtasks two levels deep between them.
 */
async function lockTask(tx: Transaction, userId: string, id: string) {
  const [task] = await tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), inArray(tasks.workspaceId, memberWorkspaces(tx, userId))))
    .for('update', { of: tasks });
  return task;
}

/**
 * When an entry's write was applied. Writes to one task wait for its row lock, and `now()` is
 * when a transaction started, which can put a write that waited before the one it waited for.
 * The time it took is read under the lock, so the log's order is the order writes applied.
 */
const appliedAt = sql`clock_timestamp()`;

/** The fields a recorded entry did not apply, for answering a resent update as the first time. */
function refusedIn(changes: ActivityChange[]): RefusedField[] {
  return changes.flatMap((change) => {
    const refused = refusedFieldSchema.safeParse(change);
    return !change.applied && refused.success ? [refused.data] : [];
  });
}

export const taskRoutes = new Hono<AppEnv>()
  .use(requireUser)
  /**
   * Creates a task with the next number from its project's counter. A create is never dropped
   * for a status deleted meanwhile: the task takes the backlog default (ADR 0005).
   */
  .post('/', zValidator('json', createTaskSchema), async (c) => {
    const userId = c.get('user')!.id;
    const { statusId: requestedStatusId, ...body } = c.req.valid('json');
    const result = await db.transaction(async (tx) => {
      // Holding the project numbers concurrent creates one after another.
      const [project] = await tx
        .select({ id: projects.id, workspaceId: projects.workspaceId })
        .from(projects)
        .where(
          and(
            eq(projects.id, body.projectId),
            inArray(projects.workspaceId, memberWorkspaces(tx, userId)),
          ),
        )
        .for('no key update', { of: projects });
      if (!project) return 'not-found';
      // Clients replay queued writes, so the task may already be here from an earlier try. A
      // replay takes no number.
      const [existing] = await tx
        .select({ projectId: tasks.projectId })
        .from(tasks)
        .where(eq(tasks.id, body.id));
      if (existing) return existing.projectId === project.id ? 'replayed' : 'taken';

      if (body.parentId !== null) {
        const parent = await lockTask(tx, userId, body.parentId);
        if (!parent) return 'not-found';
        if (parent.projectId !== project.id || parent.parentId !== null) return 'bad-parent';
      }

      const projectStatuses = await tx
        .select({
          id: statuses.id,
          name: statuses.name,
          category: statuses.category,
          isDefault: statuses.isDefault,
        })
        .from(statuses)
        .where(eq(statuses.projectId, project.id));
      const requested = projectStatuses.find((status) => status.id === requestedStatusId);
      const status =
        requested ??
        projectStatuses.find((status) => status.category === 'backlog' && status.isDefault);
      if (!status) throw new Error(`Project ${project.id} has no backlog default`);

      const [counter] = await tx
        .update(projects)
        .set({ taskCounter: sql`${projects.taskCounter} + 1` })
        .where(eq(projects.id, project.id))
        .returning({ number: projects.taskCounter });
      await tx.insert(tasks).values({
        ...body,
        workspaceId: project.workspaceId,
        number: counter!.number,
        statusId: status.id,
        closedAt: isClosedCategory(status.category) ? sql`now()` : null,
      });

      const changes: ActivityChange[] = [
        { field: 'title', previous: null, requested: body.title, applied: true },
        {
          field: 'statusId',
          previous: null,
          requested: status.id,
          requestedName: status.name,
          applied: true,
          ...(requestedStatusId !== null && !requested ? { reason: 'replaced' as const } : {}),
        },
        { field: 'priority', previous: null, requested: body.priority, applied: true },
      ];
      if (body.descriptionVersion !== null)
        changes.push({
          field: 'description',
          previous: null,
          requested: body.descriptionVersion,
          applied: true,
        });
      if (body.parentId !== null)
        changes.push({
          field: 'parentId',
          previous: null,
          requested: body.parentId,
          applied: true,
        });
      await tx.insert(taskActivity).values({
        id: body.id,
        workspaceId: project.workspaceId,
        projectId: project.id,
        taskId: body.id,
        userId,
        kind: 'created',
        changes,
        createdAt: appliedAt,
      });
      return currentTxid(tx);
    });
    if (result === 'not-found') return c.json({ error: 'Project or parent not found' }, 404);
    if (result === 'bad-parent')
      return c.json({ error: 'A subtask needs a top-level parent in its project' }, 409);
    if (result === 'taken') return c.json({ error: 'Task id is in use' }, 409);
    if (result === 'replayed') return c.json({ txid: null });
    return c.json({ txid: result }, 201);
  })
  /**
   * Applies the fields of an update that still hold, per field, and records the write in the
   * task's log (ADR 0005). Succeeds even when no field applies.
   */
  .patch('/:id', idParam, zValidator('json', updateTaskSchema), async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const { changeId, changes } = c.req.valid('json');
    const result = await db.transaction(async (tx): Promise<UpdateTaskResponse | string> => {
      const task = await lockTask(tx, userId, id);
      if (!task) return 'not-found';
      // A resent update is recognised by its change id and does nothing. Holding the task
      // first means two copies of one update cannot both get past this.
      const [recorded] = await tx
        .select({ taskId: taskActivity.taskId, changes: taskActivity.changes })
        .from(taskActivity)
        .where(eq(taskActivity.id, changeId));
      if (recorded) {
        return recorded.taskId === id
          ? { txid: null, refused: refusedIn(recorded.changes) }
          : 'taken';
      }

      const projectStatuses = await tx
        .select({ id: statuses.id, name: statuses.name, category: statuses.category })
        .from(statuses)
        .where(eq(statuses.projectId, task.projectId));
      const statusById = new Map(projectStatuses.map((status) => [status.id, status]));
      if (changes.statusId && statusById.has(changes.statusId.after)) {
        // Keeps the status from being deleted before this write commits. One deleted since it
        // was read is gone once the lock is granted, and so not a valid choice.
        const [held] = await tx
          .select({ id: statuses.id })
          .from(statuses)
          .where(eq(statuses.id, changes.statusId.after))
          .for('key share');
        if (!held) statusById.delete(changes.statusId.after);
      }

      let parentAllowed = false;
      const newParentId = changes.parentId?.after;
      if (newParentId && newParentId !== task.parentId) {
        const parent = await lockTask(tx, userId, newParentId);
        const [child] = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(eq(tasks.parentId, id))
          .limit(1);
        parentAllowed =
          parent !== undefined &&
          parent.id !== id &&
          parent.projectId === task.projectId &&
          parent.parentId === null &&
          child === undefined;
      }

      const plan = planTaskUpdate(
        {
          title: task.title,
          descriptionVersion: task.descriptionVersion,
          statusId: task.statusId,
          priority: task.priority,
          parentId: task.parentId,
          position: task.position,
          trashed: task.deletedAt !== null,
        },
        changes,
        { statuses: statusById, parentAllowed },
      );

      const set: PgUpdateSetSource<typeof tasks> = { ...plan.set };
      if (plan.set.statusId !== undefined) {
        const from = statusById.get(task.statusId)!.category;
        const to = statusById.get(plan.set.statusId)!.category;
        // Stamped on entering a closed status, cleared on reopening, kept between closed ones.
        if (!isClosedCategory(to)) set.closedAt = null;
        else if (!isClosedCategory(from)) set.closedAt = sql`now()`;
      }
      if (plan.trashed !== undefined) set.deletedAt = plan.trashed ? sql`now()` : null;

      let txid: number | null = null;
      if (Object.keys(set).length > 0) {
        await tx.update(tasks).set(set).where(eq(tasks.id, id));
        txid = await currentTxid(tx);
      }
      // Written for every update, even one that changed nothing: it is how a resend is known.
      // One that only moved a position is kept for that alone; the log leaves reordering out.
      await tx.insert(taskActivity).values({
        id: changeId,
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        taskId: id,
        userId,
        kind: plan.items.length === 0 ? 'reordered' : 'updated',
        changes: plan.items,
        createdAt: appliedAt,
      });
      return { txid, refused: plan.refused };
    });
    if (result === 'not-found') return c.json({ error: 'Task not found' }, 404);
    if (typeof result === 'string') return c.json({ error: 'Change id is in use' }, 409);
    return c.json(result);
  })
  /**
   * Purges a task in the trash, with its subtasks and log. A task that no longer counts as
   * trashed, restored on another device, is left alone.
   */
  .delete('/:id', idParam, async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const txid = await db.transaction(async (tx) => {
      const task = await lockTask(tx, userId, id);
      if (!task) return null;
      // Holding the parent and project as well means a restore of either cannot commit between
      // this check and the delete.
      const [project] = await tx
        .select({ deletedAt: projects.deletedAt })
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
      return currentTxid(tx);
    });
    // Already gone, perhaps purged by an earlier try of this same queued write.
    return c.json({ txid });
  });
