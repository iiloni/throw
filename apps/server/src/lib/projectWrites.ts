import {
  type CreateProject,
  EMPTY_PRIORITY_NAMES,
  settleProjectKey,
  type UpdateProject,
} from '@throw/shared';
import { and, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { projects, statuses, workspaces } from '../db/schema';
import { recordStructure } from './structureActivity';
import { lockTagTree } from './tagTree';
import { currentTxid } from './txid';
import { memberWorkspaces } from './workspaces';
import type { WriteActor } from './writeActor';

const projectMember = (tx: Transaction, actor: WriteActor) =>
  inArray(projects.workspaceId, memberWorkspaces(tx, actor.userId, actor.workspaceId));

export async function findProject(tx: Transaction, actor: WriteActor, id: string) {
  const [project] = await tx
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), projectMember(tx, actor)));
  return project;
}

/** Serializes project keys and rail writes across all clients in a workspace. */
export async function lockProjectWorkspace(
  tx: Transaction,
  actor: WriteActor,
  workspaceId: string,
) {
  const [workspace] = await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(
      and(
        eq(workspaces.id, workspaceId),
        inArray(workspaces.id, memberWorkspaces(tx, actor.userId, actor.workspaceId)),
      ),
    )
    .for('no key update', { of: workspaces });
  return workspace;
}

/** Serializes status changes with other status writers and task creation. */
export async function lockBoardProject(tx: Transaction, actor: WriteActor, id: string) {
  const [project] = await tx
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), projectMember(tx, actor)))
    .for('no key update', { of: projects });
  return project;
}

export async function railProjects(tx: Transaction, actor: WriteActor, workspaceId: string) {
  return tx
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        projectMember(tx, actor),
        isNull(projects.deletedAt),
      ),
    );
}

/** Thrown inside a transaction to roll back a project whose starter IDs clashed. */
export class StarterStatusIdTaken extends Error {}

export async function createProject(tx: Transaction, actor: WriteActor, body: CreateProject) {
  const { key, statuses: firstStatuses, priorityNames, ...project } = body;
  if (!(await lockProjectWorkspace(tx, actor, project.workspaceId))) return 'no-workspace';
  if (await findProject(tx, actor, project.id)) return null;

  // Projects in the trash also reserve their keys (ADR 0007).
  const taken = await tx
    .select({ key: projects.key })
    .from(projects)
    .where(and(eq(projects.workspaceId, project.workspaceId), projectMember(tx, actor)));
  const [inserted] = await tx
    .insert(projects)
    .values({
      ...project,
      key: settleProjectKey(key, new Set(taken.map((row) => row.key))),
      priorityNames: priorityNames ?? EMPTY_PRIORITY_NAMES,
    })
    .onConflictDoNothing()
    .returning();
  if (!inserted) return (await findProject(tx, actor, project.id)) ? null : 'taken';

  const initial = await tx
    .insert(statuses)
    .values(
      firstStatuses.map((status) => ({
        ...status,
        workspaceId: project.workspaceId,
        projectId: project.id,
      })),
    )
    .onConflictDoNothing()
    .returning();
  if (initial.length !== firstStatuses.length) throw new StarterStatusIdTaken();
  await logProject(tx, actor, 'created', undefined, inserted);
  for (const {
    id,
    workspaceId,
    projectId,
    createdAt: _,
    updatedAt: _updatedAt,
    ...fields
  } of initial) {
    await recordStructure(
      tx,
      actor,
      'status',
      { id, workspaceId, projectId, projectKey: inserted.key },
      'created',
      {},
      fields,
    );
  }
  return currentTxid(tx);
}

export async function updateProject(
  tx: Transaction,
  actor: WriteActor,
  id: string,
  body: UpdateProject,
) {
  const found = await findProject(tx, actor, id);
  if (!found || !(await lockProjectWorkspace(tx, actor, found.workspaceId))) return 'not-found';
  const project = await findProject(tx, actor, id);
  if (!project) return 'not-found';
  const { trashed, ...changes } = body;
  if (changes.key !== undefined && changes.key !== project.key) {
    const [clash] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.workspaceId, project.workspaceId),
          projectMember(tx, actor),
          eq(projects.key, changes.key),
          ne(projects.id, id),
        ),
      );
    if (clash) return 'key-taken';
  }

  const set = {
    ...changes,
    ...(trashed === undefined
      ? {}
      : { deletedAt: trashed ? sql`coalesce(${projects.deletedAt}, now())` : null }),
  };
  if (Object.keys(set).length === 0) return null;
  const [updated] = await tx
    .update(projects)
    .set(set)
    .where(and(eq(projects.id, id), projectMember(tx, actor)))
    .returning();
  if (!updated) return 'not-found';
  const kind =
    Boolean(project.deletedAt) !== Boolean(updated.deletedAt)
      ? updated.deletedAt
        ? 'trashed'
        : 'restored'
      : Object.keys(set).length === 1 && changes.position !== undefined
        ? 'reordered'
        : 'updated';
  await logProject(tx, actor, kind, project, updated);
  return currentTxid(tx);
}

type ProjectRow = typeof projects.$inferSelect;

function projectFields(row?: ProjectRow) {
  if (!row) return {};
  const { name, key, color, icon, position, priorityNames, deletedAt } = row;
  return { name, key, color, icon, position, priorityNames, trashed: deletedAt !== null };
}

function logProject(
  tx: Transaction,
  actor: WriteActor,
  kind: 'created' | 'updated' | 'reordered' | 'trashed' | 'restored' | 'deleted',
  before: ProjectRow | undefined,
  after?: ProjectRow,
) {
  const { id, workspaceId, key } = (after ?? before)!;
  return recordStructure(
    tx,
    actor,
    'project',
    { id, workspaceId, projectId: id, projectKey: key },
    kind,
    projectFields(before),
    projectFields(after),
  );
}

/** Purge only projects still in the trash when the queued write arrives. */
export async function deleteProject(tx: Transaction, actor: WriteActor, id: string) {
  await lockTagTree(tx, id);
  const [deleted] = await tx
    .delete(projects)
    .where(and(eq(projects.id, id), projectMember(tx, actor), isNotNull(projects.deletedAt)))
    .returning();
  if (!deleted) return null;
  await logProject(tx, actor, 'deleted', deleted);
  return currentTxid(tx);
}
