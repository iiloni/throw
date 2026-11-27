import type { CreateGithubRelease, GithubRelease } from '@throw/shared';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db, type Transaction } from '../db/client';
import {
  taskGithubReleases as bindings,
  projects,
  githubReleases as releases,
  tasks,
} from '../db/schema';
import { memberWorkspaces } from '../lib/workspaces';
import type { WriteActor } from '../lib/writeActor';
import { activeTask } from './linkData';
import { LinkError } from './manualLinks';

export type ReleaseRow = typeof releases.$inferSelect;
export function publicRelease(row: ReleaseRow): GithubRelease {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
  };
}

async function memberProject(tx: Transaction, actor: WriteActor, projectId: string) {
  const [project] = await tx
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        isNull(projects.deletedAt),
        inArray(projects.workspaceId, memberWorkspaces(tx, actor.userId, actor.workspaceId)),
      ),
    )
    .for('share');
  if (!project) throw new LinkError('Project not found', 404);
  return project;
}
export function listReleases(actor: WriteActor, projectId: string) {
  return db.transaction(async (tx) => {
    await memberProject(tx, actor, projectId);
    const rows = await tx
      .select()
      .from(releases)
      .where(eq(releases.projectId, projectId))
      .orderBy(desc(releases.publishedAt), releases.tagName);
    return { releases: rows.map(publicRelease) };
  });
}
export const releaseUrl = (repo: string, tag: string) =>
  `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`;
export function createRelease(actor: WriteActor, projectId: string, input: CreateGithubRelease) {
  return db.transaction(async (tx) => {
    const { workspaceId } = await memberProject(tx, actor, projectId);
    const repo = input.repo.toLowerCase();
    const [row] = await tx
      .insert(releases)
      .values({
        id: uuidv7(),
        projectId,
        workspaceId,
        repo,
        tagName: input.tagName,
        name: input.name,
        targetCommitish: input.targetCommitish,
        source: 'manual',
        isDraft: input.isDraft ?? false,
        isPrerelease: input.isPrerelease ?? false,
        publishedAt: input.isDraft ? null : new Date(input.publishedAt ?? Date.now()),
        url: releaseUrl(repo, input.tagName),
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new LinkError('Release tag already exists in this repository', 409);
    return publicRelease(row);
  });
}

export function setReleaseBinding(
  actor: WriteActor,
  projectId: string,
  releaseId: string,
  taskId: string,
  bind: boolean,
) {
  return db.transaction(async (tx) => {
    const { workspaceId } = await memberProject(tx, actor, projectId);
    const [release] = await tx
      .select({ id: releases.id })
      .from(releases)
      .where(and(eq(releases.id, releaseId), eq(releases.projectId, projectId)))
      .for('share');
    if (!release) throw new LinkError('Release not found', 404);
    const [task] = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), activeTask(tx)))
      .for('share', { of: tasks });
    if (!task) throw new LinkError('Task not found', 404);
    if (bind)
      await tx
        .insert(bindings)
        .values({ id: uuidv7(), workspaceId, projectId, releaseId, taskId, matchedBy: 'manual' })
        .onConflictDoUpdate({
          target: [bindings.taskId, bindings.releaseId],
          set: { matchedBy: 'manual' },
        });
    else
      await tx
        .delete(bindings)
        .where(and(eq(bindings.taskId, taskId), eq(bindings.releaseId, releaseId)));
    return { bound: bind };
  });
}
