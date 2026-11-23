import { createContext, useContext } from 'react';

/**
 * The open tasks blocking each blocked task, by their identifiers, as the real boards supply
 * them from synced relations. The prototype has none, so its cards are never blocked.
 */
export const TaskBlockersContext = createContext<ReadonlyMap<string, readonly string[]> | null>(
  null,
);

const none: readonly string[] = [];

export function useTaskBlockers(taskId: string) {
  return useContext(TaskBlockersContext)?.get(taskId) ?? none;
}

/** What a blocked card says: the blocker's identifier, or how many there are. */
export function blockedLabel(blockers: readonly string[]) {
  return blockers.length === 1
    ? `Blocked by ${blockers[0]}`
    : `Blocked by ${blockers.length} tasks`;
}
