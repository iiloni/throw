import { and, desc, eq, gt, isNotNull, lt, lte, notExists } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import type { Transaction } from '../db/client';
import {
  taskGithubReleases as bindings,
  githubConnections,
  githubTagPushes,
  taskGithubLinks as links,
  projects,
  githubReleases as releases,
  tasks,
} from '../db/schema';
import { decryptSecret } from '../webhooks/signing';
import { containsMerge } from './compare';
import { githubSecretKey } from './config';
import type { GithubEventHandler } from './dispatch';
import { activeTask } from './linkData';
import { type ReleaseRow, releaseUrl } from './releases';

const releaseEvent = z.object({
  action: z.enum([
    'created',
    'published',
    'released',
    'edited',
    'deleted',
    'prereleased',
    'unpublished',
  ]),
  release: z.object({
    tag_name: z.string().min(1),
    name: z.string().nullable().optional(),
    target_commitish: z.string().optional(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    published_at: z.iso.datetime().nullable(),
  }),
});
const tagEvent = z.object({
  ref: z.string().startsWith('refs/tags/').min(11),
  before: z.string().optional(),
  after: z.string(),
  deleted: z.boolean(),
  repository: z.object({ pushed_at: z.number().int().positive().optional() }),
});

async function bindMerged(tx: Transaction, row: ReleaseRow, connectionId: string) {
  if (!row.publishedAt || row.isDraft) return;
  const scope = and(
    eq(releases.projectId, row.projectId),
    eq(releases.repo, row.repo),
    eq(releases.isDraft, false),
  );
  const [previous] = await tx
    .select()
    .from(releases)
    .where(and(scope, lt(releases.publishedAt, row.publishedAt)))
    .orderBy(desc(releases.publishedAt))
    .limit(1);
  const [connection] = await tx
    .select({ encrypted: githubConnections.encryptedToken })
    .from(githubConnections)
    .where(eq(githubConnections.id, connectionId));
  const token = connection?.encrypted && decryptSecret(connection.encrypted, githubSecretKey);
  const candidates = await tx
    .select({ taskId: tasks.id, sha: links.mergeCommitSha, mergedAt: links.mergedAt })
    .from(links)
    .innerJoin(tasks, eq(tasks.id, links.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        eq(tasks.projectId, row.projectId),
        eq(links.repo, row.repo),
        eq(links.kind, 'pr'),
        eq(links.state, 'merged'),
        lte(links.mergedAt, row.publishedAt),
        !token && previous?.publishedAt ? gt(links.mergedAt, previous.publishedAt) : undefined,
        activeTask(tx),
        notExists(
          tx
            .select({ id: bindings.id })
            .from(bindings)
            .innerJoin(releases, eq(releases.id, bindings.releaseId))
            .where(and(eq(bindings.taskId, tasks.id), scope, isNotNull(releases.publishedAt))),
        ),
      ),
    );
  const deadline = AbortSignal.timeout(4000);
  const results = new Map<string, boolean | null>();
  for (const { taskId, sha, mergedAt } of candidates) {
    let included: boolean | null = null;
    if (token && sha && /^[a-f0-9]{40}$/i.test(sha)) {
      if (!results.has(sha) && !deadline.aborted) {
        results.set(sha, await containsMerge(row.repo, row.tagName, sha, token, deadline));
      }
      included = results.get(sha) ?? null;
    }
    const withinWindow =
      !previous?.publishedAt || (mergedAt !== null && mergedAt > previous.publishedAt);
    if (included ?? withinWindow)
      await tx
        .insert(bindings)
        .values({
          id: uuidv7(),
          workspaceId: row.workspaceId,
          projectId: row.projectId,
          releaseId: row.id,
          taskId,
          matchedBy: included ? 'ancestry' : 'window',
        })
        .onConflictDoNothing();
  }
}
export const handleRelease: GithubEventHandler = async (tx, { connection, event, payload }) => {
  const repo = connection.repository.toLowerCase();
  const { workspaceId, projectId } = connection;
  const tag = event === 'push' ? tagEvent.safeParse(payload).data : undefined;
  const release = event === 'release' ? releaseEvent.safeParse(payload).data : undefined;
  if (!tag && !release) return { status: 'ignored', reason: 'Unrecognized release or tag payload' };
  const tagName = release?.release.tag_name ?? tag!.ref.slice(10);
  const scope = and(
    eq(releases.projectId, projectId),
    eq(releases.repo, repo),
    eq(releases.tagName, tagName),
  );
  const [existing] = await tx.select().from(releases).where(scope).for('update');
  const tagSha =
    existing?.observedTagSha ?? (existing?.source === 'tag' ? existing.targetCommitish : null);
  if (tag) {
    // The receiver holds the connection lock until this transaction commits.
    const [prior] = await tx
      .select()
      .from(githubTagPushes)
      .where(
        and(
          eq(githubTagPushes.projectId, projectId),
          eq(githubTagPushes.repo, repo),
          eq(githubTagPushes.tagName, tagName),
        ),
      );
    const pushedAt = tag.repository.pushed_at ? new Date(tag.repository.pushed_at * 1000) : null;
    const previous = prior?.pushedAt;
    if (previous && pushedAt && pushedAt < previous) return { status: 'ok' };
    // GitHub reports whole seconds. At a tie (or without a source time), only
    // advance from the target GitHub actually replaced.
    if (
      (prior || tagSha) &&
      (!pushedAt || (previous && +pushedAt === +previous)) &&
      tag.before !== (tagSha ?? '0'.repeat(40))
    )
      return { status: 'ok' };
    const watermark = pushedAt ?? previous ?? null;
    await tx
      .insert(githubTagPushes)
      .values({ projectId, repo, tagName, pushedAt: watermark })
      .onConflictDoUpdate({
        target: [githubTagPushes.projectId, githubTagPushes.repo, githubTagPushes.tagName],
        set: { pushedAt: watermark },
      });
  }
  if (tag && existing && existing.source !== 'tag') {
    await tx
      .update(releases)
      .set({ observedTagSha: tag.deleted ? null : tag.after })
      .where(scope);
    return { status: 'ok' };
  }
  if (release?.action === 'deleted' && existing && tagSha) {
    if (existing.source === 'tag' && existing.publishedAt === null) return { status: 'ok' };
    await tx.delete(bindings).where(eq(bindings.releaseId, existing.id));
    await tx
      .update(releases)
      .set({
        source: 'tag',
        targetCommitish: tagSha,
        observedTagSha: tagSha,
        name: null,
        isDraft: false,
        isPrerelease: false,
        publishedAt: null,
      })
      .where(scope);
    return { status: 'ok' };
  }
  if (tag?.deleted || release?.action === 'deleted') {
    await tx.delete(releases).where(scope);
    return { status: 'ok' };
  }
  const draft = release?.action === 'unpublished' || (release?.release.draft ?? false);
  const publishedAt = draft
    ? null
    : release
      ? release.release.published_at
        ? new Date(release.release.published_at)
        : null
      : existing
        ? existing.publishedAt
        : new Date(tag?.repository.pushed_at ? tag.repository.pushed_at * 1000 : Date.now());
  const fields = {
    observedTagSha: tag?.after ?? tagSha,
    source: tag ? ('tag' as const) : ('release' as const),
    name: release?.release.name ?? null,
    targetCommitish: tag?.after ?? release?.release.target_commitish ?? null,
    isDraft: draft,
    isPrerelease: release?.release.prerelease ?? false,
    publishedAt,
    url: releaseUrl(repo, tagName),
  };
  const [row] = await tx
    .insert(releases)
    .values({ id: uuidv7(), workspaceId, projectId, repo, tagName, ...fields })
    .onConflictDoUpdate({
      target: [releases.projectId, releases.repo, releases.tagName],
      set: fields,
    })
    .returning();
  if (!existing?.publishedAt || (existing.source === 'tag' && release))
    await bindMerged(tx, row!, connection.id);
  return { status: 'ok' };
};
