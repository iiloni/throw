import type { ActivityEntry, Comment } from '@throw/shared';

/** One item of a task's timeline: a log entry, or a comment. */
export type TimelineItem =
  | { type: 'entry'; id: string; entry: ActivityEntry }
  | {
      type: 'comment';
      id: string;
      comment: Comment;
      /** Written on this device and not yet received by the server. */
      pending: boolean;
    };

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A task's log and comments in one list, oldest first, in the server's order: by `createdAt`,
 * then `id` (docs/data-model.md). A comment the server has not received yet has no time; it
 * will be dated after everything the device has seen, so it goes last, in the order it was
 * written (its id is a UUIDv7 made on the device). Entries that name no field are left out.
 */
export function taskTimeline(
  entries: Iterable<ActivityEntry>,
  comments: Iterable<Comment>,
): TimelineItem[] {
  const dated: { at: string; item: TimelineItem }[] = [];
  const pending: TimelineItem[] = [];
  for (const entry of entries) {
    if (entry.changes.length > 0)
      dated.push({ at: entry.createdAt, item: { type: 'entry', id: entry.id, entry } });
  }
  for (const comment of comments) {
    const item = {
      type: 'comment',
      id: comment.id,
      comment,
      pending: comment.createdAt === null,
    } as const;
    if (comment.createdAt === null) pending.push(item);
    else dated.push({ at: comment.createdAt, item });
  }
  dated.sort((a, b) => compare(a.at, b.at) || compare(a.item.id, b.item.id));
  pending.sort((a, b) => compare(a.id, b.id));
  return [...dated.map(({ item }) => item), ...pending];
}
