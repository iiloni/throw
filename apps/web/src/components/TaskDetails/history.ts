import {
  type ActivityChange,
  type ActivityEntry,
  type Description,
  priorityName,
  prioritySchema,
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
  parentId: 'Parent',
  primaryTagId: 'Primary tag',
  secondaryTags: 'Tag',
  description: 'Description',
  trashed: 'Trash change',
};

export function changeSentence(change: ActivityChange, context: HistoryContext): string {
  const wanted = value(change, true, context);
  const stood = value(change, false, context);
  if (change.reason === 'replaced') return `The requested status was unavailable. Used ${wanted}.`;
  if (change.applied && change.previous === change.requested) {
    if (change.field === 'description') return 'The description was already up to date.';
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
  if (entry.kind !== 'created')
    return entry.changes.map((change) => changeSentence(change, context));
  const title = entry.changes.find((change) => change.field === 'title');
  const status = entry.changes.find((change) => change.field === 'statusId' && change.applied);
  return [
    `Created the task${title ? ` ${value(title, true, context)}` : ''}${status ? ` in ${value(status, true, context)}` : ''}.`,
    ...entry.changes
      .filter((change) => !change.applied || change.reason === 'replaced')
      .map((change) => changeSentence(change, context)),
  ];
}

/** Empty editor scaffolding must not produce a blank comment; includes tables and lists. */
export function hasCommentText(document: Description): boolean {
  function hasText(value: unknown): boolean {
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.some(hasText);
    if (!value || typeof value !== 'object') return false;
    const row = value as Record<string, unknown>;
    return ['text', 'content', 'children', 'rows', 'cells'].some((key) => hasText(row[key]));
  }
  return hasText(document);
}
