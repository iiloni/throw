import { z } from 'zod';

/** Five fixed ranks, 1 the most urgent. Projects can rename them, not add or remove any. */
export const PRIORITIES = [1, 2, 3, 4, 5] as const;
export const prioritySchema = z.union(PRIORITIES.map((rank) => z.literal(rank)));
export type Priority = z.infer<typeof prioritySchema>;

/** The rank a new task gets. */
export const DEFAULT_PRIORITY: Priority = 3;

export const DEFAULT_PRIORITY_NAMES = ['Critical', 'High', 'Default', 'Low', 'Very Low'] as const;

/** A project's names for the five ranks, in rank order. An empty name shows the default. */
export const priorityNamesSchema = z.array(z.string().trim().max(30)).length(5);
export type PriorityNames = z.infer<typeof priorityNamesSchema>;

export const EMPTY_PRIORITY_NAMES: PriorityNames = ['', '', '', '', ''];

/** What a project calls a rank. */
export function priorityName(names: readonly string[], rank: Priority) {
  return names[rank - 1] || DEFAULT_PRIORITY_NAMES[rank - 1]!;
}
