import type { CreateStatus, StatusCategory, UpdateStatus } from '@throw/shared';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { statuses, tasks } from '../db/schema';
import { lockBoardProject } from './projectWrites';
import { recordStructure } from './structureActivity';
import { currentTxid } from './txid';
import { memberWorkspaces } from './workspaces';
import type { WriteActor } from './writeActor';

const member = (tx: Transaction, actor: WriteActor) =>
  inArray(statuses.workspaceId, memberWorkspaces(tx, actor.userId, actor.workspaceId));

export async function findStatus(tx: Transaction, actor: WriteActor, id: string) {
  const [status] = await tx
    .select()
    .from(statuses)
    .where(and(eq(statuses.id, id), member(tx, actor)));
  return status;
}

export async function categoryStatuses(
  tx: Transaction,
  actor: WriteActor,
  projectId: string,
  category: StatusCategory,
) {
  return tx
    .select()
    .from(statuses)
    .where(
      and(eq(statuses.projectId, projectId), eq(statuses.category, category), member(tx, actor)),
    );
}

async function clearDefault(
  tx: Transaction,
  actor: WriteActor,
  status: { projectId: string; category: StatusCategory; id: string },
  projectKey: string,
) {
  const cleared = await tx
    .update(statuses)
    .set({ isDefault: false })
    .where(
      and(
        eq(statuses.projectId, status.projectId),
        eq(statuses.category, status.category),
        eq(statuses.isDefault, true),
        ne(statuses.id, status.id),
        member(tx, actor),
      ),
    )
    .returning();
  for (const row of cleared) {
    await recordStructure(
      tx,
      actor,
      'status',
      { ...row, projectKey },
      'updated',
      { isDefault: true },
      { isDefault: false },
    );
  }
}

export class StatusIdTaken extends Error {}

export async function createStatus(tx: Transaction, actor: WriteActor, body: CreateStatus) {
  const project = await lockBoardProject(tx, actor, body.projectId);
  if (!project) return 'no-project';
  const existing = await findStatus(tx, actor, body.id);
  if (existing) {
    if (existing.projectId === project.id) return null;
    throw new StatusIdTaken();
  }
  if (body.isDefault) await clearDefault(tx, actor, body, project.key);
  const [inserted] = await tx
    .insert(statuses)
    .values({ ...body, workspaceId: project.workspaceId })
    .onConflictDoNothing()
    .returning();
  if (!inserted) throw new StatusIdTaken();
  await recordStructure(
    tx,
    actor,
    'status',
    { ...inserted, projectKey: project.key },
    'created',
    {},
    statusFields(inserted),
  );
  return currentTxid(tx);
}

export async function updateStatus(
  tx: Transaction,
  actor: WriteActor,
  id: string,
  changes: UpdateStatus,
) {
  const found = await findStatus(tx, actor, id);
  if (!found) return undefined;
  const project = await lockBoardProject(tx, actor, found.projectId);
  if (!project) return undefined;
  const status = await findStatus(tx, actor, id);
  if (!status) return undefined;
  // Replaying a color edit that already landed produces no new transaction or feed event.
  if (changes.color === status.color) {
    const { color: _color, ...remaining } = changes;
    changes = remaining;
  }
  if (Object.keys(changes).length === 0) return null;
  if (changes.isDefault) await clearDefault(tx, actor, status, project.key);
  const [updated] = await tx
    .update(statuses)
    .set(changes)
    .where(and(eq(statuses.id, id), member(tx, actor)))
    .returning();
  if (!updated) return undefined;
  const kind =
    Object.keys(changes).length === 1 && changes.position !== undefined ? 'reordered' : 'updated';
  await recordStructure(
    tx,
    actor,
    'status',
    { ...updated, projectKey: project.key },
    kind,
    statusFields(status),
    statusFields(updated),
  );
  return currentTxid(tx);
}

function statusFields({
  name,
  color,
  category,
  position,
  isDefault,
}: typeof statuses.$inferSelect) {
  return { name, color, category, position, isDefault };
}

export class StatusDeleteRefused extends Error {}

/** Keep the default and statuses still referenced by tasks, including trashed tasks. */
export async function deleteStatus(tx: Transaction, actor: WriteActor, id: string) {
  const found = await findStatus(tx, actor, id);
  if (!found) return null;
  const project = await lockBoardProject(tx, actor, found.projectId);
  if (!project) return null;
  const status = await findStatus(tx, actor, id);
  if (!status) return null;
  if (status.isDefault) throw new StatusDeleteRefused('Make another status the default first');
  const [used] = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.statusId, id),
        inArray(tasks.workspaceId, memberWorkspaces(tx, actor.userId, actor.workspaceId)),
      ),
    )
    .limit(1);
  if (used) throw new StatusDeleteRefused('Tasks use this status');
  const [deleted] = await tx
    .delete(statuses)
    .where(and(eq(statuses.id, id), member(tx, actor)))
    .returning();
  if (!deleted) return null;
  await recordStructure(
    tx,
    actor,
    'status',
    { ...deleted, projectKey: project.key },
    'deleted',
    statusFields(deleted),
    {},
  );
  return currentTxid(tx);
}
