import type { ActivityChange, TaskGithubLink } from '@throw/shared';
import { and, eq, isNull, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import type { Transaction } from '../db/client';
import { projects, taskActivity, type taskGithubLinks, tasks } from '../db/schema';
import type { WriteActor } from '../lib/writeActor';
import { enqueueWebhooks } from '../webhooks/enqueue';

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
export async function recordLink(
  tx: Transaction,
  task: LinkTask,
  link: LinkRow,
  previous: LinkRow['state'] | null,
  next: LinkRow['state'] | null,
  actor?: WriteActor,
) {
  const name = (state: LinkRow['state'] | null) =>
    state && `${link.repo}#${link.number} (${state})`;
  const item: ActivityChange = {
    field: 'relations',
    relationId: link.id,
    previous,
    requested: next,
    previousName: name(previous),
    requestedName: name(next),
    applied: true,
  };
  await tx.insert(taskActivity).values({
    id: uuidv7(),
    workspaceId: task.workspaceId,
    projectId: task.projectId,
    taskId: task.taskId,
    userId: actor?.userId ?? null,
    viaTokenName: actor ? actor.viaTokenName : 'GitHub',
    viaTokenId: actor?.tokenId,
    kind: 'updated',
    changes: [item],
    createdAt: sql`clock_timestamp()`,
  });
  await enqueueWebhooks(tx, actor ?? { integration: 'github' }, {
    event: 'task.updated',
    entityType: 'task',
    kind: 'updated',
    workspaceId: task.workspaceId,
    projectId: task.projectId,
    projectKey: task.key,
    taskId: task.taskId,
    taskNumber: task.number,
    changedFields: ['relations'],
    values: [item],
  });
}
