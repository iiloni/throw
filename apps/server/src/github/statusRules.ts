import {
  type ActivityChange,
  GITHUB_STATUS_TRIGGERS,
  type GithubStatusRules,
  type GithubStatusTrigger,
  isClosedCategory,
  type StatusCategory,
  type TaskGithubLink,
} from '@throw/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { Transaction } from '../db/client';
import { githubConnections, statuses, tasks } from '../db/schema';
import { positionInLane } from '../lib/taskPlacement';

type Row = typeof githubConnections.$inferSelect;
type LinkState = TaskGithubLink['state'];

/** Each rule's column on `github_connections`. */
export const statusRuleColumns = {
  prDraftOpened: 'prDraftOpenedStatusId',
  prReadyForReview: 'prReadyForReviewStatusId',
  prMerged: 'prMergedStatusId',
  prClosed: 'prClosedStatusId',
  issueClosed: 'issueClosedStatusId',
} as const satisfies Record<GithubStatusTrigger, keyof Row>;

export function statusRulesOf(row: Pick<Row, (typeof statusRuleColumns)[GithubStatusTrigger]>) {
  return Object.fromEntries(
    GITHUB_STATUS_TRIGGERS.map((trigger) => [trigger, row[statusRuleColumns[trigger]]]),
  ) as GithubStatusRules;
}

/** The columns a partial rules update writes. */
export function statusRuleSet(rules: Partial<GithubStatusRules>) {
  return Object.fromEntries(
    GITHUB_STATUS_TRIGGERS.filter((trigger) => rules[trigger] !== undefined).map((trigger) => [
      statusRuleColumns[trigger],
      rules[trigger],
    ]),
  ) as Partial<Pick<Row, (typeof statusRuleColumns)[GithubStatusTrigger]>>;
}

export async function loadStatusRules(tx: Transaction, connectionId: string) {
  const [row] = await tx
    .select({
      prDraftOpenedStatusId: githubConnections.prDraftOpenedStatusId,
      prReadyForReviewStatusId: githubConnections.prReadyForReviewStatusId,
      prMergedStatusId: githubConnections.prMergedStatusId,
      prClosedStatusId: githubConnections.prClosedStatusId,
      issueClosedStatusId: githubConnections.issueClosedStatusId,
    })
    .from(githubConnections)
    .where(eq(githubConnections.id, connectionId));
  return row ? statusRulesOf(row) : null;
}

// The actions that change a pull request's or issue's state. Others (`edited`, `synchronize`,
// `labeled`…) refresh a link without moving its task, even when they first link it.
const PR_ACTIONS: Record<string, readonly LinkState[]> = {
  opened: ['draft', 'open'],
  reopened: ['draft', 'open'],
  ready_for_review: ['open'],
  converted_to_draft: ['draft'],
  closed: ['merged', 'closed'],
};
const ISSUE_ACTIONS: Record<string, readonly LinkState[]> = { closed: ['closed'] };

/**
 * Which rule a delivery fires for one task, or null (ADR 0017). A rule fires only when the
 * delivery's action changed the item's state, or first linked it in that state. With several
 * linked pull requests, the task follows them together: a draft does not pull it back while
 * another is ready for review, and it moves on a close only when the last open one closes,
 * as merged when any of them merged. Issues follow the same rule for closing.
 *
 * `others` holds the states of the task's other links of the same kind.
 */
export function statusTrigger(input: {
  kind: TaskGithubLink['kind'];
  action: string | undefined;
  state: LinkState;
  previous: LinkState | null;
  others: readonly LinkState[];
}): GithubStatusTrigger | null {
  const { kind, action, state, previous, others } = input;
  if (previous === state || action === undefined) return null;
  const actions = kind === 'pr' ? PR_ACTIONS : ISSUE_ACTIONS;
  if (!Object.hasOwn(actions, action) || !actions[action]!.includes(state)) return null;
  const stillOpen = others.some((other) => other === 'open' || other === 'draft');
  if (kind === 'issue') return stillOpen ? null : 'issueClosed';
  if (state === 'draft') return others.includes('open') ? null : 'prDraftOpened';
  if (state === 'open') return 'prReadyForReview';
  if (stillOpen) return null;
  return state === 'merged' || others.includes('merged') ? 'prMerged' : 'prClosed';
}

export type StatusMove = {
  item: ActivityChange;
  statusTo: { id: string; name: string; category: StatusCategory };
  position: ActivityChange | null;
};

/**
 * Moves a locked, active task to a rule's status as a board move does: `closedAt` is stamped
 * on entering a closed category and cleared on leaving one, and a top-level task going to an
 * open lane takes the top of that lane. A closed lane sorts by closing time and a subtask
 * keeps its place among its siblings. Null when the task is already there or the status is
 * no longer the project's.
 */
export async function moveForRule(
  tx: Transaction,
  task: { taskId: string; projectId: string; workspaceId: string },
  statusId: string,
): Promise<StatusMove | null> {
  const [current] = await tx
    .select({
      statusId: tasks.statusId,
      priority: tasks.priority,
      parentId: tasks.parentId,
      position: tasks.position,
    })
    .from(tasks)
    .where(eq(tasks.id, task.taskId));
  if (!current || current.statusId === statusId) return null;
  const found = await tx
    .select({ id: statuses.id, name: statuses.name, category: statuses.category })
    .from(statuses)
    .where(
      and(
        eq(statuses.projectId, task.projectId),
        inArray(statuses.id, [current.statusId, statusId]),
      ),
    );
  const from = found.find((status) => status.id === current.statusId);
  const to = found.find((status) => status.id === statusId);
  if (!from || !to) return null;

  const set: PgUpdateSetSource<typeof tasks> = { statusId };
  if (!isClosedCategory(to.category)) set.closedAt = null;
  else if (!isClosedCategory(from.category)) set.closedAt = sql`now()`;
  let position: ActivityChange | null = null;
  if (current.parentId === null && !isClosedCategory(to.category)) {
    const next = await positionInLane(
      tx,
      { workspaceId: task.workspaceId },
      { projectId: task.projectId, statusId, priority: current.priority, parentId: null },
      task.taskId,
    );
    if (next !== null && next !== current.position) {
      set.position = next;
      position = { field: 'position', previous: current.position, requested: next, applied: true };
    }
  }
  await tx.update(tasks).set(set).where(eq(tasks.id, task.taskId));
  return {
    item: {
      field: 'statusId',
      previous: current.statusId,
      requested: statusId,
      previousName: from.name,
      requestedName: to.name,
      applied: true,
    },
    statusTo: to,
    position,
  };
}
