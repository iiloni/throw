import {
  type ActivityChange,
  type createTaskRelationSchema,
  relationConflict,
  relationRole,
  type TaskRelation,
} from '@throw/shared';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { z } from 'zod';
import { db, type Transaction } from '../db/client';
import { projects, taskActivity, taskRelations, tasks } from '../db/schema';
import { enqueueWebhooks } from '../webhooks/enqueue';
import { currentTxid } from './txid';
import { memberWorkspaces } from './workspaces';
import type { WriteActor } from './writeActor';

type RelationRow = typeof taskRelations.$inferSelect;
type Pair = Pick<TaskRelation, 'sourceTaskId' | 'targetTaskId' | 'kind'>;

/** Read under the tasks' locks, as task writes time their entries (see `taskWrites`). */
const appliedAt = sql`clock_timestamp()`;

/**
 * Holds both tasks, in id order so two writes over one pair cannot deadlock, and serializes
 * relation writes on the pair: two devices adding A blocks B and B blocks A at once cannot
 * both pass the reverse check. Key share keeps a purge from removing either task meanwhile
 * while leaving their fields free to change.
 */
async function lockPair(tx: Transaction, actor: WriteActor, a: string, b: string) {
  const [low, high] = a < b ? [a, b] : [b, a];
  const rows = await tx
    .select({
      id: tasks.id,
      workspaceId: tasks.workspaceId,
      projectId: tasks.projectId,
      number: tasks.number,
      key: projects.key,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        inArray(tasks.id, [low, high]),
        inArray(tasks.workspaceId, memberWorkspaces(tx, actor.userId, actor.workspaceId)),
      ),
    )
    .orderBy(tasks.id)
    .for('key share', { of: tasks });
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`relations/${low}/${high}`}, 0))`,
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return { source: byId.get(a), target: byId.get(b) };
}

type LockedTask = NonNullable<Awaited<ReturnType<typeof lockPair>>['source']>;

/**
 * One entry on each task, so both timelines, the change feed and webhooks say what changed.
 * Ids are the server's: a relation is replayed by its own id, not its entries'.
 */
async function recordRelation(
  tx: Transaction,
  actor: WriteActor,
  relation: RelationRow,
  ends: { source: LockedTask; target: LockedTask },
  added: boolean,
) {
  const label = (task: LockedTask) => `${task.key}-${task.number}`;
  for (const [task, other] of [
    [ends.source, ends.target],
    [ends.target, ends.source],
  ] as const) {
    const seen = relationRole(relation, task.id)!;
    const item: ActivityChange = {
      field: 'relations',
      relationId: relation.id,
      relation: seen.role,
      previous: added ? null : other.id,
      requested: added ? other.id : null,
      previousName: added ? null : label(other),
      requestedName: added ? label(other) : null,
      applied: true,
    };
    await tx.insert(taskActivity).values({
      id: uuidv7(),
      workspaceId: task.workspaceId,
      projectId: task.projectId,
      taskId: task.id,
      userId: actor.userId,
      viaTokenName: actor.viaTokenName,
      viaTokenId: actor.tokenId,
      kind: 'updated',
      changes: [item],
      createdAt: appliedAt,
    });
    await enqueueWebhooks(tx, actor, {
      event: 'task.updated',
      workspaceId: task.workspaceId,
      projectId: task.projectId,
      entityType: 'task',
      kind: 'updated',
      taskId: task.id,
      taskNumber: task.number,
      changedFields: ['relations'],
    });
  }
}

export type CreateRelationResult =
  | { txid: number; relation: RelationRow }
  /** A replay, or the same link made by another relation; `relation` is the stored one. */
  | { txid: null; relation: RelationRow }
  | 'not-found'
  | 'other-workspace'
  | 'taken'
  | 'reverse';

/**
 * Links two tasks of one workspace. A create resent with its id answers as before, and one
 * for a link that already exists under another id (two devices offline) changes nothing.
 */
export function createTaskRelation(
  actor: WriteActor,
  input: z.output<typeof createTaskRelationSchema>,
): Promise<CreateRelationResult> {
  return db.transaction(async (tx) => {
    const ends = await lockPair(tx, actor, input.sourceTaskId, input.targetTaskId);
    if (!ends.source || !ends.target) return 'not-found';
    if (ends.source.workspaceId !== ends.target.workspaceId) return 'other-workspace';
    const pairRows = await tx
      .select()
      .from(taskRelations)
      .where(
        or(
          and(
            eq(taskRelations.sourceTaskId, input.sourceTaskId),
            eq(taskRelations.targetTaskId, input.targetTaskId),
          ),
          and(
            eq(taskRelations.sourceTaskId, input.targetTaskId),
            eq(taskRelations.targetTaskId, input.sourceTaskId),
          ),
        ),
      );
    const [byId] = await tx.select().from(taskRelations).where(eq(taskRelations.id, input.id));
    if (byId) {
      const same =
        byId.sourceTaskId === input.sourceTaskId &&
        byId.targetTaskId === input.targetTaskId &&
        byId.kind === input.kind;
      return same ? { txid: null, relation: byId } : 'taken';
    }
    const conflict = relationConflict(pairRows, input);
    if (conflict === 'exists') {
      const stored = pairRows.find(
        (row) =>
          row.kind === input.kind &&
          row.sourceTaskId === input.sourceTaskId &&
          row.targetTaskId === input.targetTaskId,
      )!;
      return { txid: null, relation: stored };
    }
    if (conflict === 'reverse') return 'reverse';
    const [relation] = await tx
      .insert(taskRelations)
      .values({
        id: input.id,
        workspaceId: ends.source.workspaceId,
        sourceTaskId: input.sourceTaskId,
        targetTaskId: input.targetTaskId,
        kind: input.kind,
      })
      .returning();
    await recordRelation(tx, actor, relation!, { source: ends.source, target: ends.target }, true);
    return { txid: await currentTxid(tx), relation: relation! };
  });
}

/** Unlinks two tasks. A relation that is not there, or not reachable, answers null. */
export function deleteTaskRelation(actor: WriteActor, id: string) {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select()
      .from(taskRelations)
      .where(
        and(
          eq(taskRelations.id, id),
          inArray(taskRelations.workspaceId, memberWorkspaces(tx, actor.userId, actor.workspaceId)),
        ),
      );
    if (!found) return null;
    const ends = await lockPair(tx, actor, found.sourceTaskId, found.targetTaskId);
    if (!ends.source || !ends.target) return null;
    // A delete that waited on another for this pair finds the row gone.
    const [relation] = await tx.delete(taskRelations).where(eq(taskRelations.id, id)).returning();
    if (!relation) return null;
    await recordRelation(tx, actor, relation, { source: ends.source, target: ends.target }, false);
    return currentTxid(tx);
  });
}

/** The relation linking `pair` as stored, if the actor can reach it. */
export async function findTaskRelation(actor: WriteActor, pair: Pair) {
  const [row] = await db
    .select({ id: taskRelations.id })
    .from(taskRelations)
    .where(
      and(
        eq(taskRelations.sourceTaskId, pair.sourceTaskId),
        eq(taskRelations.targetTaskId, pair.targetTaskId),
        eq(taskRelations.kind, pair.kind),
        inArray(taskRelations.workspaceId, memberWorkspaces(db, actor.userId, actor.workspaceId)),
      ),
    );
  return row?.id ?? null;
}
