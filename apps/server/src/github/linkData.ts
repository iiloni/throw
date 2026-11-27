import type { ActivityChange, TaskGithubLink } from '@throw/shared';
import { and, eq, isNull, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import type { Transaction } from '../db/client';
import { projects, taskActivity, type taskGithubLinks, tasks } from '../db/schema';
import type { WriteActor } from '../lib/writeActor';
import { enqueueWebhooks } from '../webhooks/enqueue';
import type { StatusMove } from './statusRules';

export type LinkRow = typeof taskGithubLinks.$inferSelect;
export type LinkTask = {
  taskId: string;
  projectId: string;
  workspaceId: string;
  number: number;
  key: string;
};
export const taskFields = {
  taskId: tasks.id,
  projectId: tasks.projectId,
  workspaceId: tasks.workspaceId,
  number: tasks.number,
  key: projects.key,
};
const parent = alias(tasks, 'github_parent');
export const activeTask = (tx: Transaction) =>
  and(
    isNull(tasks.deletedAt),
    isNull(projects.deletedAt),
    notExists(
      tx
        .select({ id: parent.id })
        .from(parent)
        .where(and(eq(parent.id, tasks.parentId), sql`${parent.deletedAt} IS NOT NULL`)),
    ),
  );
export function publicLink(row: LinkRow): TaskGithubLink {
  const {
    runs: _runs,
    reviews: _reviews,
    headSha: _head,
    sourceUpdatedAt: _source,
    createdAt,
    updatedAt,
    mergedAt,
    ...link
  } = row;
  return {
    ...link,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    mergedAt: mergedAt?.toISOString() ?? null,
  };
}
export function linkChange(
  link: LinkRow,
  previous: LinkRow['state'] | null,
  next: LinkRow['state'] | null,
): ActivityChange {
  const name = (state: LinkRow['state'] | null) =>
    state && `${link.repo}#${link.number} (${state})`;
  return {
    field: 'relations',
    relationId: link.id,
    previous,
    requested: next,
    previousName: name(previous),
    requestedName: name(next),
    applied: true,
  };
}

export async function recordLink(
  tx: Transaction,
  task: LinkTask,
  link: LinkRow,
  previous: LinkRow['state'] | null,
  next: LinkRow['state'] | null,
  actor?: WriteActor,
) {
  await recordGithubChange(tx, task, { link: linkChange(link, previous, next) }, actor);
}

/**
 * Records what one delivery did to a task as one history entry and one task update webhook:
 * a link that was added or changed state, and the status a rule moved the task to.
 * Without an actor the change is GitHub's (ADR 0017).
 */
export async function recordGithubChange(
  tx: Transaction,
  task: LinkTask,
  { link, move }: { link?: ActivityChange; move?: StatusMove | null },
  actor?: WriteActor,
) {
  const changes = [link, move?.item].filter((item) => item !== undefined);
  if (!changes.length) return;
  await tx.insert(taskActivity).values({
    id: uuidv7(),
    workspaceId: task.workspaceId,
    projectId: task.projectId,
    taskId: task.taskId,
    userId: actor?.userId ?? null,
    viaTokenName: actor ? actor.viaTokenName : 'GitHub',
    viaTokenId: actor?.tokenId,
    kind: 'updated',
    changes,
    // The lane position a move took, for the change feed, without a reorder line in history.
    feedPosition: move?.position ?? undefined,
    createdAt: sql`clock_timestamp()`,
  });
  const values = move?.position ? [...changes, move.position] : changes;
  await enqueueWebhooks(tx, actor ?? { integration: 'github' }, {
    event: 'task.updated',
    entityType: 'task',
    kind: 'updated',
    workspaceId: task.workspaceId,
    projectId: task.projectId,
    projectKey: task.key,
    taskId: task.taskId,
    taskNumber: task.number,
    changedFields: values.map((item) => item.field),
    ...(move ? { statusTo: move.statusTo } : {}),
    values,
  });
}
