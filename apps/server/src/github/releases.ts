import type { CreateGithubRelease, GithubRelease } from '@throw/shared';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db, type Transaction } from '../db/client';
import {
  taskGithubReleases as bindings,
  projects,
  githubReleases as releases,
  tasks,
} from '../db/schema';
import { currentTxid } from '../lib/txid';
import { memberWorkspaces } from '../lib/workspaces';
import type { WriteActor } from '../lib/writeActor';
import { activeTask } from './linkData';
import { LinkError } from './manualLinks';

export type ReleaseRow = typeof releases.$inferSelect;
export function publicRelease({ observedTagSha: _tag, ...row }: ReleaseRow): GithubRelease {
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
export function listReleases(
  actor: WriteActor,
  projectId: string,
  page?: { limit: number; cursor?: { id: string; publishedAt: string | null } },
) {
  return db.transaction(async (tx) => {
    await memberProject(tx, actor, projectId);
    const date = sql`coalesce(${releases.publishedAt},'-infinity'::timestamptz)`;
    const cursor = page?.cursor;
    const query = tx
      .select()
      .from(releases)
      .where(
        and(
          eq(releases.projectId, projectId),
          cursor
            ? sql`(${date},${releases.id}) < (coalesce(${cursor.publishedAt}::timestamptz,'-infinity'::timestamptz),${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(date), desc(releases.id));
    const rows = await (page ? query.limit(page.limit + 1) : query);
    const items = rows.slice(0, page?.limit).map(publicRelease);
    const last = items.at(-1);
    return {
      releases: items,
      nextCursor:
        page && rows.length > page.limit && last
          ? { id: last.id, publishedAt: last.publishedAt }
          : null,
    };
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
    if (row) return { ...publicRelease(row), txid: await currentTxid(tx) };
    const [existing] = await tx
      .select()
      .from(releases)
      .where(
        and(
          eq(releases.projectId, projectId),
          eq(releases.repo, repo),
          eq(releases.tagName, input.tagName),
        ),
      );
    if (
      existing?.source === 'manual' &&
      existing.name === (input.name ?? null) &&
      existing.targetCommitish === (input.targetCommitish ?? null) &&
      existing.isDraft === (input.isDraft ?? false) &&
      existing.isPrerelease === (input.isPrerelease ?? false) &&
      (!input.publishedAt ||
        input.isDraft ||
        existing.publishedAt?.getTime() === Date.parse(input.publishedAt))
    )
      return { ...publicRelease(existing), txid: null };
    throw new LinkError('Release tag already exists in this repository', 409);
  });
}

export function setReleaseBinding(
  actor: WriteActor,
  expectedProjectId: string | undefined,
  releaseId: string,
  taskId: string,
  bind: boolean,
) {
  return db.transaction(async (tx) => {
    const [release] = await tx
      .select({ projectId: projects.id, workspaceId: projects.workspaceId })
      .from(releases)
      .innerJoin(projects, eq(projects.id, releases.projectId))
      .where(
        and(
          eq(releases.id, releaseId),
          expectedProjectId ? eq(projects.id, expectedProjectId) : undefined,
          isNull(projects.deletedAt),
          inArray(projects.workspaceId, memberWorkspaces(tx, actor.userId, actor.workspaceId)),
        ),
      )
      .for('share');
    if (!release) throw new LinkError('Release not found', 404);
    const { projectId, workspaceId } = release;
    const [task] = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), activeTask(tx)))
      .for('share', { of: tasks });
    if (!task) throw new LinkError('Task not found', 404);
    const changed = bind
      ? await tx
          .insert(bindings)
          .values({ id: uuidv7(), workspaceId, projectId, releaseId, taskId, matchedBy: 'manual' })
          .onConflictDoUpdate({
            target: [bindings.taskId, bindings.releaseId],
            set: { matchedBy: 'manual' },
            setWhere: ne(bindings.matchedBy, 'manual'),
          })
          .returning({ id: bindings.id })
      : await tx
          .delete(bindings)
          .where(and(eq(bindings.taskId, taskId), eq(bindings.releaseId, releaseId)))
          .returning({ id: bindings.id });
    return { bound: bind, txid: changed.length ? await currentTxid(tx) : null };
  });
}
