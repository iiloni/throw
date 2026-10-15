import { z } from 'zod';
import { timestampSchema } from './sync';
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
 *
 * Fields can be added to the log without a schema change (docs/data-model.md, "Activity
 * entry"), so a device must expect items whose field it does not know.
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

/**
 * `created` and `updated` entries are the task's log. A `reordered` entry records an update
 * that only moved a position: the log leaves reordering out, but the server still needs its
 * change id to recognise a resend, so it is kept on the server and never synced.
 */
export const activityKindSchema = z.enum(['created', 'updated', 'reordered']);
export type ActivityKind = z.infer<typeof activityKindSchema>;

/** The kinds a device syncs and shows. */
export const SYNCED_ACTIVITY_KINDS = ['created', 'updated'] as const satisfies ActivityKind[];

/** An entry of a task's log as a device holds it. Devices only read entries. */
export const activityEntrySchema = z.object({
  /** The task's id for its `created` entry, otherwise the update's change id. */
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  taskId: z.uuid(),
  /** Who sent the write; null once their account is deleted. */
  userId: z.string().nullable(),
  kind: z.enum(SYNCED_ACTIVITY_KINDS),
  /** One item per field the write named, position excepted. */
  changes: z.array(activityChangeSchema),
  /** When the server applied the write. */
  createdAt: timestampSchema,
});
export type ActivityEntry = z.infer<typeof activityEntrySchema>;
