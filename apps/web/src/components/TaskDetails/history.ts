import {
  type ActivityChange,
  type ActivityEntry,
  priorityName,
  prioritySchema,
  sizeLabel,
  sizeSchema,
  type TaskRelationRole,
} from '@throw/shared';

export type HistoryContext = {
  priorityNames: readonly string[];
  parentName: (id: string) => string | undefined;
};

const quote = (value: string) => `“${value || 'Untitled'}”`;
const text = (value: unknown) => (typeof value === 'string' ? value : 'Unknown value');

function value(change: ActivityChange, requested: boolean, context: HistoryContext): string {
  const raw = requested ? change.requested : change.previous;
  const name = requested ? change.requestedName : change.previousName;
  switch (change.field) {
    case 'title':
      return quote(text(raw));
    case 'statusId':
      return name ? quote(name) : 'an unavailable status';
    case 'priority': {
      const rank = prioritySchema.safeParse(raw);
      return rank.success
        ? quote(priorityName(context.priorityNames, rank.data))
        : 'an unknown priority';
    }
    case 'size': {
      const size = sizeSchema.safeParse(raw);
      return size.success ? sizeLabel(size.data) : raw === null ? 'no size' : 'an unknown size';
    }
    case 'parentId':
      return raw === null
        ? 'no parent'
        : (context.parentName(text(raw)) ?? 'an unavailable parent');
    case 'primaryTagId':
    case 'secondaryTags':
      return raw === null ? 'no tag' : name ? quote(name) : 'an unavailable tag';
    case 'description':
      return requested ? 'your description' : 'the existing description';
    case 'trashed':
      return raw ? 'in the trash' : 'out of the trash';
    default:
      return typeof raw === 'string' || typeof raw === 'number'
        ? String(raw)
        : 'the existing value';
  }
}

const labels: Record<string, string> = {
  title: 'Title',
  statusId: 'Status',
  priority: 'Priority',
  size: 'Size',
  parentId: 'Parent',
  primaryTagId: 'Primary tag',
  secondaryTags: 'Tag',
  description: 'Description',
  trashed: 'Trash change',
};

/** How an added relation reads from this task's side, with the other task named. */
const relationAdded: Record<TaskRelationRole, (other: string) => string> = {
  blocks: (other) => `Now blocks ${other}.`,
  blocked_by: (other) => `Marked as blocked by ${other}.`,
  duplicates: (other) => `Marked as a duplicate of ${other}.`,
  duplicated_by: (other) => `${other} was marked as a duplicate of this task.`,
  relates_to: (other) => `Linked to ${other}.`,
};
const relationRemoved: Record<TaskRelationRole, (other: string) => string> = {
  blocks: (other) => `No longer blocks ${other}.`,
  blocked_by: (other) => `No longer blocked by ${other}.`,
  duplicates: (other) => `No longer a duplicate of ${other}.`,
  duplicated_by: (other) => `${other} is no longer a duplicate of this task.`,
  relates_to: (other) => `Unlinked from ${other}.`,
};

function relationSentence(change: ActivityChange) {
  const added = change.requested !== null;
  const other = (added ? change.requestedName : change.previousName) || 'a task';
  const role = change.relation;
  if (!role) return added ? `Linked to ${other}.` : `Unlinked from ${other}.`;
  return (added ? relationAdded : relationRemoved)[role](other);
}

export function changeSentence(change: ActivityChange, context: HistoryContext): string {
  if (change.field === 'position')
    return change.applied ? 'Reordered.' : 'Could not move the task to that position.';
  if (change.field === 'relations') return relationSentence(change);
  const wanted = value(change, true, context);
  const stood = value(change, false, context);
  if (change.reason === 'replaced') return `The requested status was unavailable. Used ${wanted}.`;
  if (change.applied && change.previous === change.requested) {
    if (change.field === 'description') return 'The description was already up to date.';
    if (change.field === 'size' && change.requested === null)
      return 'The task already had no size.';
    if (change.field === 'trashed') return `The task was already ${wanted}.`;
    if (change.field === 'parentId')
      return change.requested === null
        ? 'The task already had no parent.'
        : `The task was already under ${wanted}.`;
    if (change.field === 'primaryTagId' && change.requested === null)
      return 'The task already had no primary tag.';
    if (change.field === 'secondaryTags')
      return change.requested === null
        ? 'The tag was already absent.'
        : `Tag ${wanted} was already assigned.`;
    return `${labels[change.field] ?? 'The field'} was already ${wanted}.`;
  }
  if (!change.applied) {
    const reason =
      change.reason === 'stale'
        ? 'it changed before this update synced'
        : 'the requested value was no longer valid';
    if (change.field === 'size') {
      const attempt = change.requested === null ? 'clear size' : `set size to ${wanted}`;
      return `Could not ${attempt} because ${reason}. Kept ${stood}.`;
    }
    if (change.field === 'description')
      return `Description not applied: wanted your description; kept the existing description because ${reason}.`;
    return `${labels[change.field] ?? 'Change'} not applied: wanted ${wanted}; kept ${stood} because ${reason}.`;
  }
  switch (change.field) {
    case 'title':
      return `Renamed from ${stood} to ${wanted}.`;
    case 'statusId':
      return `Changed status from ${stood} to ${wanted}.`;
    case 'priority':
      return `Changed priority from ${stood} to ${wanted}.`;
    case 'size':
      if (change.requested === null) return 'Cleared size.';
      return change.previous === null
        ? `Set size to ${wanted}.`
        : `Changed size from ${stood} to ${wanted}.`;
    case 'parentId':
      return change.requested === null ? `Removed parent ${stood}.` : `Moved under ${wanted}.`;
    case 'primaryTagId':
      return change.requested === null
        ? `Removed primary tag ${stood}.`
        : `Set primary tag to ${wanted}.`;
    case 'secondaryTags':
      return change.requested === null ? `Removed tag ${stood}.` : `Added tag ${wanted}.`;
    case 'description':
      return 'Changed the description.';
    case 'trashed':
      return change.requested ? 'Moved to the trash.' : 'Restored from the trash.';
    default:
      return 'Changed a task field.';
  }
}

/** One row per server write: compact its fields, never cross a comment or hide a refusal. */
export function entrySentences(entry: ActivityEntry, context: HistoryContext): string[] {
  if (entry.kind !== 'created') {
    const statusChanged = entry.changes.some(
      (change) =>
        change.field === 'statusId' && change.applied && change.previous !== change.requested,
    );
    return entry.changes
      .filter((change) => !(change.field === 'position' && change.applied && statusChanged))
      .map((change) => changeSentence(change, context));
  }
  const title = entry.changes.find((change) => change.field === 'title');
  const status = entry.changes.find((change) => change.field === 'statusId' && change.applied);
  return [
    `Created the task${title ? ` ${value(title, true, context)}` : ''}${status ? ` in ${value(status, true, context)}` : ''}.`,
    ...entry.changes
      .filter((change) => !change.applied || change.reason === 'replaced')
      .map((change) => changeSentence(change, context)),
  ];
}

export { hasCommentText } from '@throw/shared';

/** As much of the time as tells it apart: today's are clock times, this year's leave out the year. */
export function shortTime(at: string, now = new Date()) {
  const date = new Date(at);
  if (date.toDateString() === now.toDateString())
    return date.toLocaleTimeString(undefined, { timeStyle: 'short' });
  return date.toLocaleString(
    undefined,
    date.getFullYear() === now.getFullYear()
      ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
      : { dateStyle: 'medium' },
  );
}
