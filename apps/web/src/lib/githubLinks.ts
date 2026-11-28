import { parseGithubLink, sameGithubRepository, type TaskGithubLink } from '@throw/shared';
import { useEffect, useMemo } from 'react';
import { ApiError, api } from './api';
import { awaitGithubLinksTxid } from './collections';
import { CompatibilityError } from './compatibility';
import { createStore } from './store';

/**
 * A task's pull request and issue links (ADR 0017, THR-124): how cards and the task pane word
 * and colour them, and the online-only actions that add and remove them.
 */

type Kind = TaskGithubLink['kind'];
type State = TaskGithubLink['state'];
type Checks = NonNullable<TaskGithubLink['checksSummary']>;
type Review = NonNullable<TaskGithubLink['reviewDecision']>;

export const githubStateLabel: Record<State, string> = {
  draft: 'Draft',
  open: 'Open',
  merged: 'Merged',
  closed: 'Closed',
};

export const githubReviewLabel: Record<Review, string> = {
  approved: 'Approved',
  changes_requested: 'Changes requested',
  pending: 'Review pending',
};

export const githubKindLabel: Record<Kind, string> = { pr: 'Pull request', issue: 'Issue' };

/** A project color (`data-color`) for each state, as GitHub tells them apart. */
export type GithubTone = 'green' | 'gray' | 'violet' | 'red';

/**
 * Open is green and a draft gray; a merged pull request and a closed issue (most often done)
 * are violet, and a pull request closed without merging is red. An open pull request whose
 * checks fail takes red too, since that is what needs attention.
 */
export function githubTone(
  link: Pick<TaskGithubLink, 'kind' | 'state' | 'checksSummary'>,
): GithubTone {
  if (link.state === 'merged') return 'violet';
  if (link.state === 'closed') return link.kind === 'issue' ? 'violet' : 'red';
  if (link.kind === 'pr' && link.checksSummary?.state === 'failing') return 'red';
  return link.state === 'draft' ? 'gray' : 'green';
}

/** Whether the item is still being worked on. */
export const githubActive = (link: Pick<TaskGithubLink, 'state'>) =>
  link.state === 'open' || link.state === 'draft';

/** The checks in words, failures first, leaving out counts of none: `1 failed, 4 passed`. */
export function githubChecksText(checks: Checks) {
  const parts = [
    checks.failed && `${checks.failed} failed`,
    checks.pending && `${checks.pending} pending`,
    checks.passed && `${checks.passed} passed`,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'No checks';
}

/** `owner/repo#12`, as GitHub refers to an item. */
export const githubReference = (link: Pick<TaskGithubLink, 'repo' | 'number'>) =>
  `${link.repo}#${link.number}`;

/** What a screen reader hears for a link: kind, reference, title, state, review and checks. */
export function githubLinkLabel(link: TaskGithubLink) {
  return [
    `${githubKindLabel[link.kind]} ${githubReference(link)}: ${link.title}`,
    githubStateLabel[link.state],
    link.kind === 'pr' && link.reviewDecision && githubReviewLabel[link.reviewDecision],
    link.kind === 'pr' && link.checksSummary && `checks ${githubChecksText(link.checksSummary)}`,
  ]
    .filter(Boolean)
    .join(', ');
}

const stateRank: Record<State, number> = { open: 0, draft: 1, merged: 2, closed: 3 };

/**
 * A task's links in the order the pane lists them and a card picks its mark from: pull
 * requests before issues, work in progress before finished work, then the newest.
 */
export function compareGithubLinks(a: TaskGithubLink, b: TaskGithubLink) {
  return (
    (a.kind === b.kind ? 0 : a.kind === 'pr' ? -1 : 1) ||
    stateRank[a.state] - stateRank[b.state] ||
    b.updatedAt.localeCompare(a.updatedAt) ||
    b.number - a.number ||
    a.id.localeCompare(b.id)
  );
}

export const sortGithubLinks = (links: readonly TaskGithubLink[]) =>
  [...links].sort(compareGithubLinks);

/** Each task's pull requests, sorted, for board cards. Issues stay in the task pane. */
export function pullRequestsByTask(
  links: readonly TaskGithubLink[],
): ReadonlyMap<string, readonly TaskGithubLink[]> {
  const byTask = new Map<string, TaskGithubLink[]>();
  for (const link of links) {
    if (link.kind !== 'pr') continue;
    const list = byTask.get(link.taskId);
    if (list) list.push(link);
    else byTask.set(link.taskId, [link]);
  }
  for (const list of byTask.values()) list.sort(compareGithubLinks);
  return byTask;
}

/**
 * What a pasted link would add to a task: the item, or why it cannot be added here. Null when
 * the text is not a GitHub pull request or issue address at all, so a search goes on as one.
 */
export function pastedGithubLink(
  text: string,
  repository: string,
  links: readonly Pick<TaskGithubLink, 'repo' | 'kind' | 'number'>[],
) {
  const item = parseGithubLink(text.trim());
  if (!item) return null;
  if (!sameGithubRepository(item.repo, repository))
    return { ...item, problem: `This project follows ${repository}.` } as const;
  const linked = links.some(
    (link) =>
      sameGithubRepository(link.repo, item.repo) &&
      link.kind === item.kind &&
      link.number === item.number,
  );
  return { ...item, problem: linked ? 'Already linked to this task.' : null } as const;
}

/** The connected repository of each project the device has asked about, while it links. */
const repositories = createStore<ReadonlyMap<string, { repository: string | null; at: number }>>(
  new Map(),
);
const FRESH_MS = 60_000;

function remember(projectId: string, repository: string | null) {
  repositories.set(new Map(repositories.get()).set(projectId, { repository, at: Date.now() }));
}

const asking = new Map<string, Promise<void>>();

/** Asks the server once at a time per project, however many pickers want to know. */
function ask(projectId: string) {
  if (asking.has(projectId)) return;
  const request = api
    .githubConnection(projectId, AbortSignal.timeout(10_000))
    .then(({ connection }) =>
      remember(projectId, connection?.enabled ? connection.repository : null),
    )
    .catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) remember(projectId, null);
    })
    .finally(() => asking.delete(projectId));
  asking.set(projectId, request);
}

/**
 * The repository a project can link pull requests and issues from, or null: none connected,
 * the connection is off, the server is older than the integration, or the device cannot ask.
 * Asked again after a minute; a failed request keeps what was known.
 */
export function useGithubRepository(projectId: string) {
  const known = repositories.use().get(projectId);
  const fresh = known !== undefined && Date.now() - known.at < FRESH_MS;
  useEffect(() => {
    if (!fresh) ask(projectId);
  }, [projectId, fresh]);
  return known?.repository ?? null;
}

export class GithubLinkError extends Error {}

function linkErrorMessage(error: unknown, adding: boolean) {
  if (error instanceof CompatibilityError) return 'Update Throw to change GitHub links.';
  if (error instanceof ApiError) {
    if (error.status === 409) return 'Only items from the connected repository can be linked.';
    if (error.status === 400) return 'Paste the address of a pull request or an issue.';
    if (error.status === 404)
      return adding ? 'This task can no longer be linked.' : 'This server has no GitHub links.';
    return adding ? 'The link could not be added. Try again.' : 'The link could not be removed.';
  }
  return 'Could not reach the server. Try again once you are connected.';
}

/**
 * Links a pasted pull request or issue to the task and waits for the link to sync. A refusal
 * because the connection went away forgets the repository, so the picker stops offering it.
 */
export async function linkGithub(taskId: string, projectId: string, url: string) {
  try {
    const { txid } = await api.linkGithub(taskId, { url });
    if (txid !== null) await awaitGithubLinksTxid(txid);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) remember(projectId, null);
    throw new GithubLinkError(linkErrorMessage(error, true));
  }
}

/**
 * Links being removed. They leave the pane and the cards at once, as a write through the
 * outbox would, and come back only if the server refuses. They stay hidden a while after the
 * stream drops them, since a list emptied by sync holds its last rows (`steadyRows`).
 */
const removed = createStore<ReadonlySet<string>>(new Set());
const HIDDEN_AFTER_MS = 10_000;

function setRemoved(linkId: string, hidden: boolean) {
  const next = new Set(removed.get());
  if (hidden) next.add(linkId);
  else next.delete(linkId);
  removed.set(next);
}

/** The links without those being removed. */
export function useShownGithubLinks(links: readonly TaskGithubLink[]) {
  const hidden = removed.use();
  return useMemo(
    () => (hidden.size ? links.filter((link) => !hidden.has(link.id)) : links),
    [links, hidden],
  );
}

/** Removes a link, which works after the project disconnects too. */
export async function unlinkGithub(taskId: string, linkId: string) {
  setRemoved(linkId, true);
  try {
    const { txid } = await api.unlinkGithub(taskId, linkId);
    if (txid !== null) await awaitGithubLinksTxid(txid);
    setTimeout(() => setRemoved(linkId, false), HIDDEN_AFTER_MS);
  } catch (error) {
    setRemoved(linkId, false);
    throw new GithubLinkError(linkErrorMessage(error, false));
  }
}

/** For tests: forget what was learnt about projects' connections. */
export function resetGithubRepositories() {
  repositories.set(new Map());
  removed.set(new Set());
}
