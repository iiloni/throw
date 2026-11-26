import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Transaction } from '../db/client';
import { githubDeliveries, taskGithubLinks as links } from '../db/schema';
import type { GithubEventHandler } from './dispatch';
import type { LinkRow } from './linkData';

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

const signalSchema = z.object({
  event: z.string(),
  review: review.optional(),
  check: run.optional(),
});
type Signal = z.infer<typeof signalSchema>;
type SignalFields = Partial<Pick<LinkRow, 'runs' | 'checksSummary' | 'reviews' | 'reviewDecision'>>;
const reviewKey = (repo: string, n: number) => JSON.stringify([repo, 'pr', n]);
const checkKey = (repo: string, sha: string) => JSON.stringify([repo, 'head', sha]);
function applySignal(row: SignalFields, signal: Signal): SignalFields {
  const { review: r, check, event } = signal;
  if (r) {
    const state = r.state.toLowerCase();
    if (!['approved', 'changes_requested', 'dismissed'].includes(state)) return {};
    const reviews = { ...row.reviews };
    const prior = reviews[String(r.user.id)];
    if (prior && (prior.id > r.id || (prior.id === r.id && prior.state === 'pending'))) return {};
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
    return { reviews, reviewDecision };
  } else if (check) {
    // Count runs when available. Suites are the fallback for a suite-only subscription.
    const runs = { ...row.runs };
    const suiteId = event === 'check_suite' ? check.id : check.check_suite?.id;
    const key =
      event === 'check_suite'
        ? `suite/${suiteId}`
        : `run/${suiteId ?? 'unknown'}/${check.name ?? check.id}`;
    const prior = runs[key];
    if (prior?.id && prior.id > check.id) return {};
    const at = check.completed_at ?? check.updated_at ?? check.started_at ?? '';
    if (
      prior?.id === check.id &&
      (prior.at > at ||
        (prior.at === at && prior.state !== 'pending' && check.status !== 'completed'))
    )
      return {};
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
    return { runs, checksSummary: summarize(actual) };
  }
  return {};
}

export async function reconcileSignals(
  tx: Transaction,
  connectionId: string,
  repo: string,
  number: number,
  head: string | null,
  base: SignalFields,
): Promise<SignalFields> {
  const keys = [reviewKey(repo, number)];
  if (head) keys.push(checkKey(repo, head));
  const receipts = await tx
    .select({ signal: githubDeliveries.signal })
    .from(githubDeliveries)
    .where(
      and(
        eq(githubDeliveries.connectionId, connectionId),
        inArray(githubDeliveries.signalKey, keys),
      ),
    )
    .orderBy(githubDeliveries.receivedAt, githubDeliveries.deliveryId);
  const result: SignalFields = {
    reviews: base.reviews,
    reviewDecision: base.reviewDecision,
    runs: base.runs,
    checksSummary: base.checksSummary,
  };
  for (const receipt of receipts) {
    const signal = signalSchema.parse(receipt.signal);
    const targets = signal.check?.pull_requests;
    if (!targets?.length || targets.some((p) => p.number === number))
      Object.assign(result, applySignal(result, signal));
  }
  return result;
}
export const handleSignal: GithubEventHandler = async (
  tx,
  { connection, deliveryId, event, payload },
) => {
  const reviewing = event === 'pull_request_review';
  const r = reviewing ? review.safeParse(payload.review).data : null;
  const target = reviewing
    ? z.object({ number: z.int().positive() }).safeParse(payload.pull_request).data
    : null;
  const check = reviewing ? null : run.safeParse(payload[event]).data;
  if (reviewing ? !r || !target : !check)
    return { status: 'ignored', reason: 'Missing GitHub signal metadata' };
  const repo = connection.repository.toLowerCase();
  const signal = { event, review: r ?? undefined, check: check ?? undefined };
  await tx
    .update(githubDeliveries)
    .set({
      signalKey: target ? reviewKey(repo, target.number) : checkKey(repo, check!.head_sha),
      signal,
    })
    .where(
      and(
        eq(githubDeliveries.connectionId, connection.id),
        eq(githubDeliveries.deliveryId, deliveryId),
      ),
    );
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
    const patch = applySignal(row, signal);
    if (Object.keys(patch).length) await tx.update(links).set(patch).where(eq(links.id, row.id));
  }
  return { status: 'ok' };
};
