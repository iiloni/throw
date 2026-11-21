import {
  type ActivityChange,
  type createTaskSchema,
  isClosedCategory,
  type Priority,
  type RefusedField,
  refusedFieldSchema,
  type UpdateTask,
} from '@throw/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import { db, type Transaction } from '../db/client';
import { projects, statuses, taskActivity, tasks, taskTags } from '../db/schema';
import { planSecondaryTags } from './secondaryTags';
import { lockTagTree, projectTags } from './tagTree';
import { positionInLane, type RelativePlacement } from './taskPlacement';
import { planTaskUpdate } from './taskUpdate';
import { currentTxid } from './txid';
import { memberWorkspaces } from './workspaces';
import type { WriteActor } from './writeActor';

/**
 * Locks a task row the user can reach. An update holds its task, and a write that makes a task
 * a parent holds that parent, so two writes cannot nest subtasks two levels deep between them.
 */
export async function lockTask(tx: Transaction, { userId, workspaceId }: WriteActor, id: string) {
  const [task] = await tx
    .select()
    .from(tasks)
    .where(
      and(eq(tasks.id, id), inArray(tasks.workspaceId, memberWorkspaces(tx, userId, workspaceId))),
    )
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

/** Creates a task and assigns its number in the same transaction. */
export function createTask(actor: WriteActor, input: z.output<typeof createTaskSchema>) {
  const { userId, workspaceId, viaTokenName } = actor;
  const {
    statusId: requestedStatusId,
    primaryTagId: requestedPrimary,
    secondaryTagIds,
    ...body
  } = input;
  return db.transaction(async (tx) => {
    await lockTagTree(tx, body.projectId);
    // Holding the project numbers concurrent creates one after another.
    const [project] = await tx
      .select({ id: projects.id, workspaceId: projects.workspaceId })
      .from(projects)
      .where(
        and(
          eq(projects.id, body.projectId),
          inArray(projects.workspaceId, memberWorkspaces(tx, userId, workspaceId)),
        ),
      )
      .for('no key update', { of: projects });
    if (!project) return 'not-found';
    // Clients replay queued writes, so the task may already be here from an earlier try. A
    // replay takes no number.
    const [existing] = await tx
      .select({ projectId: tasks.projectId, changes: taskActivity.changes })
      .from(tasks)
      .leftJoin(taskActivity, eq(tasks.id, taskActivity.id))
      .where(eq(tasks.id, body.id));
    if (existing) {
      if (existing.projectId !== project.id) return 'taken';
      return { txid: null, changes: existing.changes ?? [] };
    }

    if (body.parentId !== null) {
      const parent = await lockTask(tx, actor, body.parentId);
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

    const tagById = new Map(
      (await projectTags(tx, userId, project.id)).map((tag) => [tag.id, tag]),
    );
    const primaryTagId =
      requestedPrimary && tagById.has(requestedPrimary) ? requestedPrimary : null;
    const validSecondary = secondaryTagIds.filter((tagId) => tagById.has(tagId));
    const [counter] = await tx
      .update(projects)
      .set({ taskCounter: sql`${projects.taskCounter} + 1` })
      .where(eq(projects.id, project.id))
      .returning({ number: projects.taskCounter });
    const position =
      viaTokenName === undefined
        ? body.position
        : ((await positionInLane(tx, actor, { ...body, statusId: status.id }, body.id)) ??
          body.position);
    await tx.insert(tasks).values({
      ...body,
      position,
      workspaceId: project.workspaceId,
      number: counter!.number,
      primaryTagId,
      statusId: status.id,
      closedAt: isClosedCategory(status.category) ? sql`now()` : null,
    });

    if (validSecondary.length)
      await tx.insert(taskTags).values(
        validSecondary.map((tagId) => ({
          taskId: body.id,
          tagId,
          workspaceId: project.workspaceId,
          projectId: project.id,
        })),
      );
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
    if (requestedPrimary)
      changes.push({
        field: 'primaryTagId',
        previous: null,
        requested: requestedPrimary,
        previousName: null,
        requestedName: tagById.get(requestedPrimary)?.name ?? null,
        applied: primaryTagId !== null,
        ...(primaryTagId === null ? { reason: 'invalid' as const } : {}),
      });
    for (const tagId of secondaryTagIds)
      changes.push({
        field: 'secondaryTags',
        tagId,
        previous: null,
        requested: tagId,
        previousName: null,
        requestedName: tagById.get(tagId)?.name ?? null,
        applied: tagById.has(tagId),
        ...(!tagById.has(tagId) ? { reason: 'invalid' as const } : {}),
      });
    await tx.insert(taskActivity).values({
      id: body.id,
      workspaceId: project.workspaceId,
      projectId: project.id,
      taskId: body.id,
      userId,
      viaTokenName,
      kind: 'created',
      changes,
      createdAt: appliedAt,
    });
    const txid = await currentTxid(tx);
    return { txid, changes, ...(validSecondary.length ? { secondaryTagsTxid: txid } : {}) };
  });
}

/** Applies the task conflict rule and records the result under the change id. */
type MovePosition = {
  before: { statusId: string; priority: Priority; parentId: string | null };
  relative?: RelativePlacement | null;
};

export function updateTask(actor: WriteActor, id: string, input: UpdateTask, move?: MovePosition) {
  const { userId, workspaceId, viaTokenName } = actor;
  const { changeId, changes } = input;
  return db.transaction(async (tx) => {
    const [scope] = await tx
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(
        and(
          eq(tasks.id, id),
          inArray(tasks.workspaceId, memberWorkspaces(tx, userId, workspaceId)),
        ),
      );
    if (scope) await lockTagTree(tx, scope.projectId);
    const task = await lockTask(tx, actor, id);
    if (!task) return 'not-found';
    // A resent update is recognised by its change id and does nothing. Holding the task
    // first means two copies of one update cannot both get past this.
    const [recorded] = await tx
      .select({ taskId: taskActivity.taskId, changes: taskActivity.changes })
      .from(taskActivity)
      .where(eq(taskActivity.id, changeId));
    if (recorded) {
      return recorded.taskId === id
        ? { txid: null, refused: refusedIn(recorded.changes), changes: recorded.changes }
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
      const parent = await lockTask(tx, actor, newParentId);
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

    const tagById = new Map(
      (await projectTags(tx, userId, task.projectId)).map((tag) => [tag.id, tag]),
    );
    const plan = planTaskUpdate(
      {
        title: task.title,
        primaryTagId: task.primaryTagId,
        descriptionVersion: task.descriptionVersion,
        statusId: task.statusId,
        priority: task.priority,
        parentId: task.parentId,
        position: task.position,
        trashed: task.deletedAt !== null,
      },
      changes,
      { statuses: statusById, parentAllowed, tags: tagById },
    );

    let positionItem: ActivityChange | undefined;
    // Status-only moves keep a subtask in its place. The board's closed zone sorts by time.
    if (move) {
      const statusId = plan.set.statusId ?? task.statusId;
      const category = statusById.get(statusId)!.category;
      const closedLane = task.parentId === null && isClosedCategory(category);
      if (
        move.relative !== undefined ||
        (plan.set.statusId && task.parentId === null && !closedLane)
      ) {
        const statusRefusal = plan.refused.find((field) => field.field === 'statusId');
        const stale =
          task.statusId !== move.before.statusId ||
          task.priority !== move.before.priority ||
          task.parentId !== move.before.parentId;
        const position =
          stale || statusRefusal || move.relative === null || closedLane
            ? null
            : await positionInLane(tx, actor, { ...task, statusId }, id, move.relative);
        if (position !== null && position !== task.position) plan.set.position = position;
        positionItem = {
          field: 'position',
          previous: task.position,
          requested: position,
          applied: position !== null,
          ...(position === null
            ? { reason: stale ? 'stale' : (statusRefusal?.reason ?? 'invalid') }
            : {}),
        };
      }
    }

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
    const secondaryRows = changes.secondaryTags
      ? await tx
          .select()
          .from(taskTags)
          .where(
            and(
              eq(taskTags.taskId, id),
              inArray(taskTags.workspaceId, memberWorkspaces(tx, userId, workspaceId)),
            ),
          )
      : [];
    const secondary = planSecondaryTags(
      new Set(secondaryRows.map((row) => row.tagId)),
      changes.secondaryTags ?? [],
      tagById,
    );
    plan.items.push(...secondary.items);
    plan.refused.push(...secondary.refused);
    for (const { tagId, present } of secondary.operations) {
      if (present)
        await tx.insert(taskTags).values({
          taskId: id,
          tagId,
          projectId: task.projectId,
          workspaceId: task.workspaceId,
        });
      else
        await tx
          .delete(taskTags)
          .where(
            and(
              eq(taskTags.taskId, id),
              eq(taskTags.tagId, tagId),
              inArray(taskTags.workspaceId, memberWorkspaces(tx, userId, workspaceId)),
            ),
          );
    }
    // Store the position outcome for replay. Only actual MCP reorders get a history row of their own.
    const kind =
      plan.items.length || (viaTokenName && plan.set.position !== undefined)
        ? 'updated'
        : 'reordered';
    if (positionItem) plan.items.push(positionItem);
    await tx.insert(taskActivity).values({
      id: changeId,
      workspaceId: task.workspaceId,
      projectId: task.projectId,
      taskId: id,
      userId,
      viaTokenName,
      kind,
      changes: plan.items,
      createdAt: appliedAt,
    });
    return {
      txid,
      refused: plan.refused,
      changes: plan.items,
      ...(secondary.operations.length ? { secondaryTagsTxid: await currentTxid(tx) } : {}),
    };
  });
}
