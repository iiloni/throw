import { githubItemUrl } from '@throw/shared';
import { and, eq, inArray, or } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { taskGithubLinks as links, projects, tasks } from '../db/schema';
import type { GithubEventHandler } from './dispatch';
import { activeTask, recordLink, taskFields } from './linkData';
import { reconcileSignals } from './linkSignals';

const item = z.object({
  number: z.int().positive().max(2147483647),
  title: z.string(),
  body: z.string().nullish(),
  state: z.enum(['open', 'closed']),
  updated_at: z.iso.datetime(),
});
const pr = item.extend({
  draft: z.boolean().optional(),
  merged: z.boolean().optional(),
  merged_at: z.iso.datetime().nullish(),
  merge_commit_sha: z.string().nullish(),
  head: z.object({ ref: z.string(), sha: z.string() }),
});
export function taskNumbers(key: string, text: string) {
  return [
    ...new Set(
      Array.from(text.matchAll(/\b([a-z][a-z0-9]*)-([1-9]\d*)\b/gi))
        .filter((m) => m[1]!.toUpperCase() === key.toUpperCase())
        .map((m) => Number(m[2]))
        .filter((n) => n <= 2147483647),
    ),
  ];
}
const ignored = (reason: string) => ({ status: 'ignored' as const, reason });
export const handleItem: GithubEventHandler = async (tx, { connection, event, payload }) => {
  const kind = event === 'issues' ? 'issue' : 'pr';
  const pull = kind === 'pr' ? pr.safeParse(payload.pull_request).data : undefined;
  const data = kind === 'issue' ? item.safeParse(payload.issue).data : pull;
  if (!data) return ignored('Missing GitHub item metadata');
  const repo = connection.repository.toLowerCase();
  const { projectId, workspaceId } = connection;
  const [project] = await tx
    .select({ key: projects.key })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) return ignored('Project removed');
  const numbers = taskNumbers(project.key, [pull?.head.ref, data.title, data.body].join(' '));
  const matching = and(
    eq(links.projectId, projectId),
    eq(links.kind, kind),
    eq(links.repo, repo),
    eq(links.number, data.number),
  );
  const rows = await tx
    .select({ task: taskFields, link: links })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(links, and(eq(links.taskId, tasks.id), matching))
    .where(
      and(
        eq(tasks.projectId, projectId),
        activeTask(tx),
        or(
          inArray(tasks.number, numbers),
          inArray(tasks.id, tx.select({ id: links.taskId }).from(links).where(matching)),
        ),
      ),
    )
    .orderBy(tasks.id)
    .for('share', { of: tasks });
  const state =
    pull?.merged || pull?.merged_at
      ? 'merged'
      : data.state === 'closed'
        ? 'closed'
        : pull?.draft
          ? 'draft'
          : 'open';
  const sourceUpdatedAt = new Date(data.updated_at);
  if (rows.some(({ link }) => link?.sourceUpdatedAt && link.sourceUpdatedAt > sourceUpdatedAt))
    return { status: 'ok' };
  const previous = rows.find(({ link }) => link)?.link;
  for (const { task, link } of rows) {
    const metadata = {
      title: data.title,
      state,
      sourceUpdatedAt,
      headSha: pull?.head.sha ?? null,
      branch: pull?.head.ref ?? null,
      mergeCommitSha: pull?.merge_commit_sha ?? null,
      mergedAt: pull?.merged_at ? new Date(pull.merged_at) : null,
    } as const;
    const signals =
      pull && (!link || link.headSha !== pull.head.sha)
        ? await reconcileSignals(tx, connection.id, repo, data.number, pull.head.sha, {
            ...(link ?? previous),
            runs: previous?.headSha === pull.head.sha ? previous.runs : null,
            checksSummary: previous?.headSha === pull.head.sha ? previous.checksSummary : null,
          })
        : {};
    if (!link) {
      const [created] = await tx
        .insert(links)
        .values({
          ...metadata,
          ...signals,
          id: uuidv7(),
          taskId: task.taskId,
          workspaceId,
          projectId,
          repo,
          kind,
          number: data.number,
          url: githubItemUrl(repo, kind, data.number),
        })
        .returning();
      await recordLink(tx, task, created!, null, state);
    } else {
      await tx
        .update(links)
        .set({
          ...metadata,
          ...signals,
        })
        .where(eq(links.id, link.id));
      if (link.state !== state) await recordLink(tx, task, link, link.state, state);
    }
  }
  return { status: 'ok' };
};

const push = z.object({
  after: z.string(),
  ref: z.string().startsWith('refs/heads/'),
  commits: z.array(z.object({ message: z.string() })),
});
/** A push names no PR. Its tip and branch can identify an already linked open PR. */
export const handlePush: GithubEventHandler = async (tx, { connection, payload }) => {
  const data = push.safeParse(payload).data;
  if (!data) return ignored('Missing push metadata');
  const repo = connection.repository.toLowerCase();
  const known = await tx
    .selectDistinctOn([links.number])
    .from(links)
    .where(
      and(
        eq(links.projectId, connection.projectId),
        eq(links.repo, repo),
        eq(links.kind, 'pr'),
        inArray(links.state, ['draft', 'open']),
        eq(links.headSha, data.after),
        eq(links.branch, data.ref.slice('refs/heads/'.length)),
      ),
    );
  if (!known.length) return ignored('No linked pull request has this branch and tip');
  const [project] = await tx
    .select({ key: projects.key })
    .from(projects)
    .where(eq(projects.id, connection.projectId));
  if (!project) return ignored('Project removed');
  const numbers = taskNumbers(
    project.key,
    [data.ref, ...data.commits.map((c) => c.message)].join(' '),
  );
  const mentioned = await tx
    .select(taskFields)
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        eq(tasks.projectId, connection.projectId),
        inArray(tasks.number, numbers),
        activeTask(tx),
      ),
    )
    .orderBy(tasks.id)
    .for('share', { of: tasks });
  for (const source of known) {
    for (const task of mentioned) {
      const [added] = await tx
        .insert(links)
        .values({
          ...source,
          id: uuidv7(),
          taskId: task.taskId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning();
      if (added) await recordLink(tx, task, added, null, added.state);
    }
  }
  return { status: 'ok' };
};
