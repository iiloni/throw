import type { TaskGithubLink } from '@throw/shared';
import { createContext, useContext } from 'react';

/**
 * Each task's linked pull requests, sorted (`pullRequestsByTask`), as the real boards supply
 * them from the synced links (ADR 0017). The prototype has none, so its cards show no mark.
 */
export const TaskPullRequestsContext = createContext<ReadonlyMap<
  string,
  readonly TaskGithubLink[]
> | null>(null);

const none: readonly TaskGithubLink[] = [];

export function useTaskPullRequests(taskId: string) {
  return useContext(TaskPullRequestsContext)?.get(taskId) ?? none;
}
