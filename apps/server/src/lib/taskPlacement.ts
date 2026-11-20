import { type Priority, positionBetween, positionSchema } from '@throw/shared';
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { tasks } from '../db/schema';
import { memberWorkspaces } from './workspaces';
import type { WriteActor } from './writeActor';

type Lane = { projectId: string; statusId: string; priority: Priority; parentId: string | null };
export type RelativePlacement = { side: 'before' | 'after'; neighborId: string };

/** The project's write lock holds while the neighbors and resulting position are chosen. */
export async function positionInLane(
  tx: Transaction,
  actor: WriteActor,
  lane: Lane,
  taskId: string,
  relative?: RelativePlacement,
): Promise<string | null> {
  const scope = and(
    eq(tasks.projectId, lane.projectId),
    inArray(tasks.workspaceId, memberWorkspaces(tx, actor.userId, actor.workspaceId)),
    ne(tasks.id, taskId),
    lane.parentId === null || relative ? isNull(tasks.deletedAt) : undefined,
    lane.parentId === null
      ? and(
          isNull(tasks.parentId),
          eq(tasks.statusId, lane.statusId),
          eq(tasks.priority, lane.priority),
        )
      : eq(tasks.parentId, lane.parentId),
  );
  // Fractional indices sort by code unit, independently of the database locale.
  const position = sql`${tasks.position} COLLATE "C"`;
  const ascending = relative ? relative.side === 'after' : lane.parentId === null;
  const sort = ascending ? asc : desc;
  let neighbor: { position: string } | undefined;
  if (relative) {
    [neighbor] = await tx
      .select({ position: tasks.position })
      .from(tasks)
      .where(and(scope, eq(tasks.id, relative.neighborId)));
    if (!neighbor) return null;
  }
  const boundary =
    neighbor && relative
      ? sql`(${position}, ${tasks.id}) ${ascending ? sql`>` : sql`<`} (${neighbor.position}, ${relative.neighborId}::uuid)`
      : undefined;
  const [adjacent] = await tx
    .select({ position: tasks.position })
    .from(tasks)
    .where(and(scope, boundary))
    .orderBy(sort(position), sort(tasks.id))
    .limit(1);

  const [lower, upper] = ascending
    ? [neighbor?.position ?? null, adjacent?.position ?? null]
    : [adjacent?.position ?? null, neighbor?.position ?? null];
  if (lower !== null && lower === upper) return null;
  try {
    return positionSchema.safeParse(positionBetween(lower, upper)).data ?? null;
  } catch {
    // An older app could supply a syntactically valid string that is not a fractional key.
    return null;
  }
}
