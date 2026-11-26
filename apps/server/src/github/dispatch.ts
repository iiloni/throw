import type { Transaction } from '../db/client';
import { connected, handleItem, handlePush, handleSignal } from './linkEvents';

/** A verified delivery for a connection's repository, as handlers receive it. */
export type GithubEvent = {
  connection: { id: string; workspaceId: string; projectId: string; repository: string };
  /** `X-GitHub-Event`, such as `pull_request`. */
  event: string;
  /** `X-GitHub-Delivery`: the same on GitHub's redeliveries, which are not handled twice. */
  deliveryId: string;
  /** The parsed body. Handlers validate the parts they read with Zod. */
  payload: Record<string, unknown>;
};

export type GithubHandled = { status: 'ok' } | { status: 'ignored'; reason: string };

/**
 * Handles one event inside the transaction that records the delivery, so a write it makes and
 * the delivery's deduplication commit or roll back together. A handler that throws fails the
 * delivery (500) and leaves it unrecorded, so GitHub's redelivery tries again.
 */
export type GithubEventHandler = (tx: Transaction, event: GithubEvent) => Promise<GithubHandled>;

export type GithubHandlers = Readonly<Partial<Record<string, GithubEventHandler>>>;

/**
 * What Throw does with each GitHub event (ADR 0017). The integration's later parts add theirs
 * here: pull requests and branches, issues, releases.
 */
export const githubHandlers: GithubHandlers = {
  push: connected(handlePush),
  pull_request: connected(handleItem),
  issues: connected(handleItem),
  pull_request_review: connected(handleSignal),
  check_run: connected(handleSignal),
  check_suite: connected(handleSignal),
  // GitHub's test when a webhook is made or pinged from its settings. Recording it is enough.
  ping: async () => ({ status: 'ok' }),
};

export async function dispatchGithubEvent(
  tx: Transaction,
  event: GithubEvent,
  handlers: GithubHandlers = githubHandlers,
): Promise<GithubHandled> {
  const handler = Object.hasOwn(handlers, event.event) ? handlers[event.event] : undefined;
  if (!handler) return { status: 'ignored', reason: `Throw does not use ${event.event} events` };
  return handler(tx, event);
}
