import {
  type Comment,
  type CreateComment,
  type CreateProject,
  type CreateTask,
  createCommentSchema,
  createProjectSchema,
  createTaskSchema,
  deriveProjectKey,
  type Project,
  positionBetween,
  STARTER_STATUSES,
  type Status,
  type Task,
  type TaskChanges,
  type UpdateComment,
  type UpdateProject,
  type UpdateStatus,
  type UpdateTask,
  updateCommentSchema,
  updateProjectSchema,
  updateStatusSchema,
  updateTaskSchema,
} from '@throw/shared';

// What each queued mutation sends. The outbox keeps a mutation's row before (`original`) and
// after (`modified`) and the fields it changed (`changes`) across reloads, so everything a
// request needs is worked out from those three.

/**
 * A project's create request, with the statuses made with it in the same write. The key is
 * the device's proposal; the server settles it (ADR 0007).
 */
export function projectCreateRequest(project: Project, statuses: readonly Status[]): CreateProject {
  // A create queued before projects had statuses carries none. It gets the starter set, with
  // ids that are the same on every resend.
  const sent: Pick<Status, 'id' | 'name' | 'category' | 'position' | 'isDefault'>[] =
    statuses.length > 0
      ? [...statuses]
      : STARTER_STATUSES.map((status) => ({
          ...status,
          id: derivedId(project.id, status.category),
          position: positionBetween(null, null),
          isDefault: true,
        }));
  return createProjectSchema.parse({
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    color: project.color,
    icon: project.icon,
    position: project.position,
    key: project.proposedKey ?? deriveProjectKey(project.name),
    priorityNames: project.priorityNames,
    statuses: sent.map(({ id, name, category, position, isDefault }) => ({
      id,
      name,
      category,
      position,
      isDefault,
    })),
  });
}

/**
 * A project update, or null when no field the server takes changed. The server stamps the
 * trash time, so the device's placeholder becomes `trashed`.
 */
export function projectUpdateRequest(
  original: Project,
  modified: Project,
  changes: Partial<Project>,
): UpdateProject | null {
  const body: Record<string, unknown> = {};
  for (const field of ['name', 'color', 'icon', 'position', 'priorityNames'] as const) {
    if (field in changes) body[field] = modified[field];
  }
  if ('key' in changes && modified.key !== null && modified.key !== original.key)
    body.key = modified.key;
  if ('deletedAt' in changes && (original.deletedAt === null) !== (modified.deletedAt === null))
    body.trashed = modified.deletedAt !== null;
  return Object.keys(body).length === 0 ? null : updateProjectSchema.parse(body);
}

/**
 * A status update, or null when nothing the server takes changed. A status loses its default
 * flag only as a side effect of another status taking it, which the server does itself.
 */
export function statusUpdateRequest(changes: Partial<Status>): UpdateStatus | null {
  const body: Record<string, unknown> = {};
  if ('name' in changes) body.name = changes.name;
  if ('position' in changes) body.position = changes.position;
  if (changes.isDefault === true) body.isDefault = true;
  return Object.keys(body).length === 0 ? null : updateStatusSchema.parse(body);
}

export function commentCreateRequest(comment: Comment): CreateComment {
  return createCommentSchema.parse({ id: comment.id, taskId: comment.taskId, body: comment.body });
}

/** A comment edit, or null when the body did not change. The server stamps `editedAt`. */
export function commentUpdateRequest(changes: Partial<Comment>): UpdateComment | null {
  return 'body' in changes ? updateCommentSchema.parse({ body: changes.body }) : null;
}

export function taskCreateRequest(task: Task): CreateTask {
  return createTaskSchema.parse({
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    description: task.description,
    descriptionVersion: task.descriptionVersion,
    statusId: task.statusId,
    priority: task.priority,
    position: task.position,
    parentId: task.parentId,
  });
}

/**
 * A task update in ADR 0005's form: each changed field with the value the device held before
 * the change and the value it wants. Null when no field the server takes changed. Server
 * values the device stamps for the time being (`closedAt`, the trash time) are not sent.
 */
export function taskUpdateRequest(
  original: Task,
  modified: Task,
  changes: Partial<Task>,
  changeId: string,
): UpdateTask | null {
  const wire: TaskChanges = {};
  const changed = <K extends keyof Task>(field: K) =>
    field in changes && original[field] !== modified[field];
  if (changed('title')) wire.title = { before: original.title, after: modified.title };
  if (changed('priority')) wire.priority = { before: original.priority, after: modified.priority };
  if (changed('statusId')) wire.statusId = { before: original.statusId, after: modified.statusId };
  if (changed('parentId')) wire.parentId = { before: original.parentId, after: modified.parentId };
  if ('deletedAt' in changes && (original.deletedAt === null) !== (modified.deletedAt === null))
    wire.trashed = { before: original.deletedAt !== null, after: modified.deletedAt !== null };
  if (changed('descriptionVersion')) {
    // Each save names a new version, which is what the server compares (see `saveDescription`).
    if (modified.descriptionVersion === null) throw new Error('A description save needs a version');
    wire.description = {
      before: original.descriptionVersion,
      after: { version: modified.descriptionVersion, document: modified.description },
    };
  } else if (changed('description')) {
    throw new Error('A description save needs a new version');
  }
  // A position means something only in the status, priority and parent it was computed for.
  if (changed('position'))
    wire.position = {
      after: modified.position,
      statusId: modified.statusId,
      priority: modified.priority,
      parentId: modified.parentId,
    };
  if (Object.keys(wire).length === 0) return null;
  return updateTaskSchema.parse({ changeId, changes: wire });
}

/** 53 well-mixed bits of `text` (cyrb53), as 14 hex digits. */
function hash(text: string, seed: number) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/**
 * A UUIDv7 that is the same every time it is derived from the same `seed` and `name`, taking
 * its time from `seed` when that is a UUIDv7.
 */
export function derivedId(seed: string, name: string) {
  const source = `${seed}/${name}`;
  const seedTime = seed.replaceAll('-', '').slice(0, 12);
  const time = /^[0-9a-f]{12}$/i.test(seedTime) ? seedTime.toLowerCase() : hash(source, 3).slice(2);
  const random = hash(source, 1) + hash(source, 2);
  const variant = ((Number.parseInt(random[3]!, 16) & 0x3) | 0x8).toString(16);
  return [
    time.slice(0, 8),
    time.slice(8, 12),
    `7${random.slice(0, 3)}`,
    `${variant}${random.slice(4, 7)}`,
    random.slice(7, 19),
  ].join('-');
}

/**
 * The change id of a task update: the same every time the outbox sends the same write, so the
 * server recognises a resend (ADR 0006). The outbox does not keep a mutation's metadata, so it
 * is derived from what it does keep: the write's idempotency key (a UUIDv7, whose time it
 * takes) and the task. One write changes a task at most once, because changes to one row
 * within a write are merged.
 */
export function changeIdFor(idempotencyKey: string, taskId: string) {
  return derivedId(idempotencyKey, taskId);
}
