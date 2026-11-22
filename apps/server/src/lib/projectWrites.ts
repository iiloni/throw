import {
  type CreateProject,
  EMPTY_PRIORITY_NAMES,
  settleProjectKey,
  type UpdateProject,
} from '@throw/shared';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { projects, statuses, workspaces } from '../db/schema';
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
  const inserted = await tx
    .insert(projects)
    .values({
      ...project,
      key: settleProjectKey(key, new Set(taken.map((row) => row.key))),
      priorityNames: priorityNames ?? EMPTY_PRIORITY_NAMES,
    })
    .onConflictDoNothing()
    .returning({ id: projects.id });
  if (!inserted.length) return (await findProject(tx, actor, project.id)) ? null : 'taken';

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
    .returning({ id: statuses.id });
  if (initial.length !== firstStatuses.length) throw new StarterStatusIdTaken();
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
  const updated = await tx
    .update(projects)
    .set(set)
    .where(and(eq(projects.id, id), projectMember(tx, actor)))
    .returning({ id: projects.id });
  return updated.length === 0 ? 'not-found' : currentTxid(tx);
}
