import { isDeepStrictEqual } from 'node:util';
import type { ActivityChange, WebhookEvent, WebhookPayload } from '@throw/shared';

/**
 * Quiet windows (ADR 0015): how a webhook that waits for changes to pause folds them into one
 * delivery, and works out what is left to say once undone changes cancel out. Pure, so the
 * queue in `enqueue.ts` only stores and schedules what this decides.
 */

/** One value a change set: a task field, or one of its tags or relations. */
export type FieldValue = { key: string; field: string; from: unknown; to: unknown };

/** What a waiting task delivery has folded so far. Stored with it, never sent. */
export type WebhookFold = {
  /** Each value before the window's first change to it, and after the latest. */
  values: Record<string, { field: string; from: unknown; to: unknown }>;
  /** Fields a change named without values to compare. They always count as changed. */
  sticky: string[];
  /** A task created in the window: the fields it was created with, and whether it was blank. */
  created?: { fields: string[]; blank: boolean };
};

/**
 * `wait` sends once the webhook has been quiet for its window. `hold` keeps the delivery
 * unsent but open to later changes: an undone edit, or a created task that is blank or in the
 * trash. `drop` removes it: a task created and purged within the window was never announced.
 */
export type FoldOutcome = 'wait' | 'hold' | 'drop';

export type Folded = { payload: WebhookPayload; fold: WebhookFold | null; outcome: FoldOutcome };

/** The title a board's `+` gives a task before anyone names it. */
export const BLANK_TASK_TITLE = 'New task';

/**
 * What a quiet window folds a change into. Comments are never folded: each is its own
 * delivery, which still waits for the webhook to go quiet.
 */
export function coalesceKeyOf(change: {
  event: WebhookEvent;
  workspaceId: string;
  projectId: string | null;
  taskId?: string;
}) {
  if (change.event === 'structure.updated')
    return `structure:${change.projectId ?? change.workspaceId}`;
  if (change.event.startsWith('task.') && change.taskId) return `task:${change.taskId}`;
  return null;
}

/** The values an activity entry's applied items set, keyed so a later undo meets them. */
export function fieldValues(items: readonly ActivityChange[]): FieldValue[] {
  return items
    .filter((item) => item.applied)
    .map((item) => {
      if (item.field === 'secondaryTags')
        return {
          key: `secondaryTags:${item.tagId}`,
          field: item.field,
          from: item.previous !== null,
          to: item.requested !== null,
        };
      if (item.field === 'relations') {
        const other = item.previous ?? item.requested;
        return {
          key: `relations:${item.relation}:${String(other)}`,
          field: item.field,
          from: item.previous !== null,
          to: item.requested !== null,
        };
      }
      return { key: item.field, field: item.field, from: item.previous, to: item.requested };
    });
}

const union = (first: readonly string[] = [], second: readonly string[] = []) => [
  ...new Set([...first, ...second]),
];

/**
 * Folds the notice part of a change into a delivery that has not been sent. It keeps its ID
 * and how it started: a task created in the window is still announced as created, and a
 * structure notice keeps its first change's entity, as one transaction's notice does. A purge
 * replaces the lot. A change by a person keeps the notice theirs, so an agent that skips its
 * own token writes still looks.
 */
export function mergePayload(waiting: WebhookPayload, next: WebhookPayload): WebhookPayload {
  const actor = waiting.actor.kind === 'user' ? waiting.actor : next.actor;
  if (waiting.event === 'task.deleted') return { ...waiting, actor, occurredAt: next.occurredAt };
  if (next.event === 'task.deleted') return { ...next, deliveryId: waiting.deliveryId, actor };
  const changedFields = union(waiting.changedFields, next.changedFields);
  const statusTo = next.statusTo !== undefined ? next.statusTo : waiting.statusTo;
  const merged: WebhookPayload = {
    ...next,
    deliveryId: waiting.deliveryId,
    actor,
    ...(changedFields.length ? { changedFields } : {}),
    ...(statusTo === undefined ? {} : { statusTo }),
  };
  if (waiting.event === 'task.created')
    return { ...merged, event: 'task.created', kind: 'created' };
  if (waiting.event === 'structure.updated')
    return { ...merged, entityType: waiting.entityType, kind: waiting.kind };
  return merged;
}

function isBlank(values: readonly FieldValue[]) {
  const set = (key: string) => values.some((value) => value.key === key && value.to);
  return (
    values.some((value) => value.key === 'title' && value.to === BLANK_TASK_TITLE) &&
    !set('description') &&
    !set('primaryTagId') &&
    !values.some((value) => value.field === 'secondaryTags' && value.to)
  );
}

function foldValues(
  fold: WebhookFold | null,
  next: WebhookPayload,
  values: readonly FieldValue[] | undefined,
): WebhookFold {
  const creating = next.event === 'task.created';
  const result: WebhookFold = {
    values: { ...fold?.values },
    sticky: [...(fold?.sticky ?? [])],
    ...(fold?.created ? { created: fold.created } : {}),
  };
  if (creating && !result.created)
    result.created = { fields: next.changedFields ?? [], blank: isBlank(values ?? []) };
  for (const value of values ?? []) {
    const prior = result.values[value.key];
    // A task's creation is its starting point: nothing came before it to return to.
    const from = prior ? prior.from : creating ? value.to : value.from;
    result.values[value.key] = { field: value.field, from, to: value.to };
  }
  if (!creating) {
    const valued = new Set(values?.map((value) => value.field));
    result.sticky = union(
      result.sticky,
      (next.changedFields ?? []).filter((field) => !valued.has(field)),
    );
  }
  return result;
}

/** The fields whose folded value differs from where the window started. */
export function netFields(fold: WebhookFold) {
  return union(
    Object.values(fold.values)
      .filter((value) => !isDeepStrictEqual(value.from, value.to))
      .map((value) => value.field),
    fold.sticky,
  );
}

/**
 * Folds a task change into the webhook's waiting delivery for that task, if it has one, and
 * decides what the delivery now says and whether it waits. Changes count by their net effect:
 * marking a task done and back, or removing a tag and adding it again, leaves nothing to send,
 * and only the fields that still differ are listed. A purge replaces what was waiting and
 * waits like any other change, unless the task was created in the window: then nothing is
 * left to say.
 */
export function foldTask(
  waiting: { payload: WebhookPayload; fold: WebhookFold | null } | undefined,
  next: WebhookPayload,
  values: readonly FieldValue[] | undefined,
): Folded {
  const base = waiting ? mergePayload(waiting.payload, next) : next;
  const fold = foldValues(waiting?.fold ?? null, next, values);
  if (base.event === 'task.deleted')
    return { payload: base, fold, outcome: fold.created ? 'drop' : 'wait' };

  const changed = netFields(fold);
  // A device's reorders are not announced on their own, so neither is a position left over
  // from a move that was undone. An agent's reorder is.
  const counted =
    base.actor.kind === 'token' ? changed : changed.filter((field) => field !== 'position');
  const { changedFields: _, statusTo, ...rest } = base;
  if (fold.created) {
    const fields = union(fold.created.fields, changed);
    const quiet = fold.values.trashed?.to === true || (fold.created.blank && !counted.length);
    return {
      payload: { ...rest, changedFields: fields, ...(statusTo === undefined ? {} : { statusTo }) },
      fold,
      outcome: quiet ? 'hold' : 'wait',
    };
  }
  const trashed = fold.values.trashed;
  const kind = changed.includes('trashed')
    ? trashed
      ? trashed.to
        ? 'trashed'
        : 'restored'
      : base.kind
    : changed.length && changed.every((field) => field === 'position')
      ? 'reordered'
      : 'updated';
  return {
    payload: {
      ...rest,
      kind,
      ...(changed.length ? { changedFields: changed } : {}),
      ...(changed.includes('statusId') && statusTo !== undefined ? { statusTo } : {}),
    },
    fold,
    outcome: counted.length ? 'wait' : 'hold',
  };
}

/** Structure notices fold by project: every field listed, nothing cancelled. */
export function foldStructure(
  waiting: { payload: WebhookPayload } | undefined,
  next: WebhookPayload,
): Folded {
  return {
    payload: waiting ? mergePayload(waiting.payload, next) : next,
    fold: null,
    outcome: 'wait',
  };
}
