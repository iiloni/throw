import type { CreateStatus, StatusCategory, UpdateStatus } from '@throw/shared';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { statuses } from '../db/schema';
import { lockBoardProject } from './projectWrites';
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

function clearDefault(
  tx: Transaction,
  actor: WriteActor,
  status: { projectId: string; category: StatusCategory; id: string },
) {
  return tx
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
    );
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
  if (body.isDefault) await clearDefault(tx, actor, body);
  const inserted = await tx
    .insert(statuses)
    .values({ ...body, workspaceId: project.workspaceId })
    .onConflictDoNothing()
    .returning({ id: statuses.id });
  if (!inserted.length) throw new StatusIdTaken();
  return currentTxid(tx);
}

export async function updateStatus(
  tx: Transaction,
  actor: WriteActor,
  id: string,
  changes: UpdateStatus,
) {
  const found = await findStatus(tx, actor, id);
  if (!found || !(await lockBoardProject(tx, actor, found.projectId))) return undefined;
  const status = await findStatus(tx, actor, id);
  if (!status) return undefined;
  if (Object.keys(changes).length === 0) return null;
  if (changes.isDefault) await clearDefault(tx, actor, status);
  await tx
    .update(statuses)
    .set(changes)
    .where(and(eq(statuses.id, id), member(tx, actor)));
  return currentTxid(tx);
}
