import type {
  ActivityChange,
  Description,
  Priority,
  RefusalReason,
  RefusedField,
  StatusCategory,
  TaskChanges,
  TaskField,
} from '@throw/shared';

/** The fields of a task the conflict rule compares, as the server holds them now. */
export interface TaskState {
  title: string;
  descriptionVersion: string | null;
  statusId: string;
  priority: Priority;
  parentId: string | null;
  position: string;
  primaryTagId: string | null;
  /** The task's own trash state, not its parent's or project's. */
  trashed: boolean;
}

export interface UpdateContext {
  /** The statuses of the task's project. A status missing here was deleted. */
  statuses: ReadonlyMap<string, { name: string; category: StatusCategory }>;
  /** Whether the requested parent keeps subtasks one level deep. Unused when none is asked. */
  parentAllowed: boolean;
  tags?: ReadonlyMap<string, { name: string }>;
}

/** What to write: only the columns whose value changes. */
export interface TaskUpdatePlan {
  set: {
    title?: string;
    description?: Description;
    descriptionVersion?: string;
    statusId?: string;
    priority?: Priority;
    parentId?: string | null;
    position?: string;
    primaryTagId?: string | null;
  };
  /** The task's own trash state when it changes. */
  trashed?: boolean;
  /** The activity entry's changes: every field the write named, position excepted. */
  items: ActivityChange[];
  refused: RefusedField[];
}

type Outcome = { applied: true } | { applied: false; reason: RefusalReason };

/**
 * ADR 0005's rule for one field. A field whose value is already the wanted one counts as
 * applied, though nothing changes: refusing it would report a conflict over an edit that
 * stands. Otherwise the device must have seen the current value, and the value must be valid.
 */
function decide<T>(current: T, before: T, after: T, valid: boolean): Outcome {
  if (current === after) return { applied: true };
  if (current !== before) return { applied: false, reason: 'stale' };
  if (!valid) return { applied: false, reason: 'invalid' };
  return { applied: true };
}

/**
 * Works out which fields of an update apply to a task, per field. Nothing is substituted: a
 * field that does not apply leaves the server's value. A position applies only when, after
 * the rest of the write, the task is in the status, priority and parent it was computed for.
 */
export function planTaskUpdate(
  current: TaskState,
  changes: TaskChanges,
  context: UpdateContext,
): TaskUpdatePlan {
  const plan: TaskUpdatePlan = { set: {}, items: [], refused: [] };
  const statusName = (id: string | null) =>
    id === null ? null : (context.statuses.get(id)?.name ?? null);

  const record = (
    field: TaskField,
    outcome: Outcome,
    item: Omit<ActivityChange, 'field' | 'applied'>,
  ) => {
    plan.items.push({
      field,
      ...item,
      applied: outcome.applied,
      ...(outcome.applied ? {} : { reason: outcome.reason }),
    });
    if (!outcome.applied) plan.refused.push({ field, reason: outcome.reason });
  };

  if (changes.title) {
    const { before, after } = changes.title;
    const outcome = decide(current.title, before, after, true);
    record('title', outcome, { previous: current.title, requested: after });
    if (outcome.applied && after !== current.title) plan.set.title = after;
  }

  if (changes.description) {
    const { before, after } = changes.description;
    const outcome = decide(current.descriptionVersion, before, after.version, true);
    record('description', outcome, {
      previous: current.descriptionVersion,
      requested: after.version,
      ...(outcome.applied ? {} : { rejectedDocument: after.document }),
    });
    if (outcome.applied && after.version !== current.descriptionVersion) {
      plan.set.description = after.document;
      plan.set.descriptionVersion = after.version;
    }
  }

  if (changes.statusId) {
    const { before, after } = changes.statusId;
    const outcome = decide(current.statusId, before, after, context.statuses.has(after));
    record('statusId', outcome, {
      previous: current.statusId,
      requested: after,
      previousName: statusName(current.statusId),
      requestedName: statusName(after),
    });
    if (outcome.applied && after !== current.statusId) plan.set.statusId = after;
  }

  if (changes.priority) {
    const { before, after } = changes.priority;
    const outcome = decide(current.priority, before, after, true);
    record('priority', outcome, { previous: current.priority, requested: after });
    if (outcome.applied && after !== current.priority) plan.set.priority = after;
  }

  if (changes.parentId) {
    const { before, after } = changes.parentId;
    const outcome = decide(
      current.parentId,
      before,
      after,
      after === null || context.parentAllowed,
    );
    record('parentId', outcome, { previous: current.parentId, requested: after });
    if (outcome.applied && after !== current.parentId) plan.set.parentId = after;
  }

  if (changes.primaryTagId) {
    const { before, after } = changes.primaryTagId;
    const outcome = decide(
      current.primaryTagId,
      before,
      after,
      after === null || !!context.tags?.has(after),
    );
    record('primaryTagId', outcome, {
      previous: current.primaryTagId,
      requested: after,
      previousName:
        current.primaryTagId === null
          ? null
          : (context.tags?.get(current.primaryTagId)?.name ?? null),
      requestedName: after === null ? null : (context.tags?.get(after)?.name ?? null),
    });
    if (outcome.applied && after !== current.primaryTagId) plan.set.primaryTagId = after;
  }

  if (changes.trashed) {
    const { before, after } = changes.trashed;
    const outcome = decide(current.trashed, before, after, true);
    record('trashed', outcome, { previous: current.trashed, requested: after });
    if (outcome.applied && after !== current.trashed) plan.trashed = after;
  }

  if (changes.position) {
    const { after, ...computedFor } = changes.position;
    const statusId = plan.set.statusId ?? current.statusId;
    const priority = plan.set.priority ?? current.priority;
    const parentId = plan.set.parentId !== undefined ? plan.set.parentId : current.parentId;
    if (
      computedFor.statusId === statusId &&
      computedFor.priority === priority &&
      computedFor.parentId === parentId &&
      after !== current.position
    )
      plan.set.position = after;
  }

  return plan;
}
