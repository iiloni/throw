import { z } from 'zod';
import { taskFieldSchema } from './tasks';

/**
 * One field in an activity entry. The server writes entries; no device does (ADR 0006).
 *
 * `previous` is what the server held before the write (null on a `created` entry) and
 * `requested` what the write asked for. Statuses keep their names so an entry still reads
 * after one is deleted. A description item holds versions, not text, except that a
 * description that was not applied keeps the device's document in `rejectedDocument`.
 * `replaced` is used on a `created` entry for a status that no longer existed, when the task
 * took the backlog default; `requested` is then the status it took.
 */
export const activityChangeSchema = z.object({
  field: taskFieldSchema,
  previous: z.unknown(),
  requested: z.unknown(),
  previousName: z.string().nullable().optional(),
  requestedName: z.string().nullable().optional(),
  applied: z.boolean(),
  reason: z.enum(['stale', 'invalid', 'replaced']).optional(),
  rejectedDocument: z.unknown().optional(),
});
export type ActivityChange = z.infer<typeof activityChangeSchema>;

export const activityKindSchema = z.enum(['created', 'updated']);
export type ActivityKind = z.infer<typeof activityKindSchema>;
