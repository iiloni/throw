import { githubItemUrl } from '@throw/shared';
import { and, eq, inArray, or } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { githubConnections, taskGithubLinks as links, projects, tasks } from '../db/schema';
import type { GithubEventHandler } from './dispatch';
import { activeTask, type LinkRow, recordLink, taskFields } from './linkData';

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
    if (!link) {
      const [created] = await tx
        .insert(links)
        .values({
          ...metadata,
          reviews: previous?.reviews,
          reviewDecision: previous?.reviewDecision,
          runs: previous?.headSha === metadata.headSha ? previous?.runs : null,
          checksSummary: previous?.headSha === metadata.headSha ? previous?.checksSummary : null,
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
          updatedAt: new Date(),
          ...(link.headSha !== metadata.headSha ? { runs: null, checksSummary: null } : {}),
        })
        .where(eq(links.id, link.id));
      if (link.state !== state) await recordLink(tx, task, link, link.state, state);
    }
  }
  return { status: 'ok' };
};

const review = z.object({
  id: z.int().positive(),
  user: z.object({ id: z.int().positive() }),
  state: z.string(),
});
const run = z.object({
  id: z.int().positive(),
  head_sha: z.string(),
  check_suite: z.object({ id: z.int().positive() }).optional(),
  name: z.string().optional(),
  status: z.string(),
  conclusion: z.string().nullable(),
  completed_at: z.iso.datetime().nullish(),
  started_at: z.iso.datetime().nullish(),
  updated_at: z.iso.datetime().nullish(),
  pull_requests: z.array(z.object({ number: z.int() })).optional(),
});
type Runs = NonNullable<LinkRow['runs']>;
export function summarize(runs: Runs): NonNullable<LinkRow['checksSummary']> {
  const states = Object.values(runs).map((r) => r.state);
  const count = (value: (typeof states)[number]) => states.filter((s) => s === value).length;
  const passed = count('passing'),
    failed = count('failing'),
    pending = count('pending');
  return {
    passed,
    failed,
    pending,
    state: failed ? 'failing' : pending ? 'pending' : passed ? 'passing' : 'neutral',
  };
}
export const handleSignal: GithubEventHandler = async (tx, { connection, event, payload }) => {
  const reviewing = event === 'pull_request_review';
  const r = reviewing ? review.safeParse(payload.review).data : null;
  const target = reviewing
    ? item.pick({ number: true }).safeParse(payload.pull_request).data
    : null;
  const check = reviewing ? null : run.safeParse(payload[event]).data;
  if (reviewing ? !r || !target : !check) return ignored('Missing GitHub signal metadata');
  const rows = await tx
    .select()
    .from(links)
    .where(
      and(
        eq(links.projectId, connection.projectId),
        eq(links.repo, connection.repository.toLowerCase()),
        eq(links.kind, 'pr'),
        target ? eq(links.number, target.number) : eq(links.headSha, check!.head_sha),
        check?.pull_requests?.length
          ? inArray(
              links.number,
              check.pull_requests.map((p) => p.number),
            )
          : undefined,
      ),
    )
    .for('update');
  for (const row of rows) {
    if (r) {
      const state = r.state.toLowerCase();
      if (!['approved', 'changes_requested', 'dismissed'].includes(state)) continue;
      const reviews = { ...row.reviews };
      const prior = reviews[String(r.user.id)];
      if (prior && (prior.id > r.id || (prior.id === r.id && prior.state === 'pending'))) continue;
      reviews[String(r.user.id)] = {
        id: r.id,
        state:
          state === 'approved'
            ? 'approved'
            : state === 'changes_requested'
              ? 'changes_requested'
              : 'pending',
      };
      const states = Object.values(reviews).map((v) => v.state);
      const reviewDecision = states.includes('changes_requested')
        ? 'changes_requested'
        : states.includes('approved')
          ? 'approved'
          : 'pending';
      await tx
        .update(links)
        .set({ reviews, reviewDecision, updatedAt: new Date() })
        .where(eq(links.id, row.id));
    } else if (check) {
      // Count runs when available. Suites are the fallback for a suite-only subscription.
      const runs = { ...row.runs };
      const suiteId = event === 'check_suite' ? check.id : check.check_suite?.id;
      const key =
        event === 'check_suite'
          ? `suite/${suiteId}`
          : `run/${suiteId ?? 'unknown'}/${check.name ?? check.id}`;
      const prior = runs[key];
      if (prior?.id && prior.id > check.id) continue;
      const at = check.completed_at ?? check.updated_at ?? check.started_at ?? '';
      if (
        prior?.id === check.id &&
        (prior.at > at ||
          (prior.at === at && prior.state !== 'pending' && check.status !== 'completed'))
      )
        continue;
      runs[key] = {
        id: check.id,
        at,
        state:
          check.status !== 'completed'
            ? 'pending'
            : check.conclusion === 'success'
              ? 'passing'
              : ['skipped', 'neutral'].includes(check.conclusion ?? '')
                ? 'neutral'
                : 'failing',
      };
      const covered = new Set(
        Object.keys(runs)
          .filter((k) => k.startsWith('run/'))
          .map((k) => k.split('/')[1]),
      );
      const actual = Object.fromEntries(
        Object.entries(runs).filter(([k]) => !k.startsWith('suite/') || !covered.has(k.slice(6))),
      );
      await tx
        .update(links)
        .set({
          runs,
          checksSummary: summarize(actual),
          updatedAt: new Date(),
        })
        .where(eq(links.id, row.id));
    }
  }
  return { status: 'ok' };
};

// Serialize deliveries and manual additions on the connection before reading prior state.
export const connected =
  (handler: GithubEventHandler): GithubEventHandler =>
  async (tx, event) => {
    const [current] = await tx
      .select()
      .from(githubConnections)
      .where(eq(githubConnections.id, event.connection.id))
      .for('no key update');
    if (
      !current?.enabled ||
      current.repository.toLowerCase() !== event.connection.repository.toLowerCase()
    )
      return ignored('Connection changed');
    return handler(tx, event);
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
