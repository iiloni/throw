import {
  compareStatuses,
  positionBetween,
  type Status,
  type StatusCategory,
  statusSchema,
  type Task,
} from '@throw/shared';
import { uuidv7 } from 'uuidv7';
import { statusesCollection, tasksCollection, write } from './collections';

/** A project's statuses by category (backlog, active, done, cancelled), then position. */
export function statusesOf(statuses: readonly Status[], projectId: string) {
  return statuses.filter((status) => status.projectId === projectId).sort(compareStatuses);
}

/** The status a task takes when it is dropped on a category, or created without one. */
export function defaultStatus(
  statuses: readonly Status[],
  projectId: string,
  category: StatusCategory = 'backlog',
) {
  return statuses.find(
    (status) => status.projectId === projectId && status.category === category && status.isDefault,
  );
}

/** Adds a status at the end of its category. */
export function createStatus(projectId: string, name: string, category: StatusCategory) {
  const siblings = statusesOf([...statusesCollection.values()], projectId);
  const first = siblings[0];
  if (!first) throw new Error('Project not found');
  const last = siblings.filter((status) => status.category === category).at(-1);
  const id = uuidv7();
  const status = statusSchema.parse({
    id,
    workspaceId: first.workspaceId,
    projectId,
    name,
    category,
    position: positionBetween(last?.position ?? null, null),
    isDefault: false,
  });
  write(() => statusesCollection.insert(status));
  return id;
}

export function renameStatus(id: string, name: string) {
  const valid = statusSchema.shape.name.parse(name);
  write(() =>
    statusesCollection.update(id, (status) => {
      status.name = valid;
    }),
  );
}

/** Moves a status between two others of its category (null for either end). */
export function moveStatus(id: string, before: Status | null, after: Status | null) {
  const position = positionBetween(before?.position ?? null, after?.position ?? null);
  write(() =>
    statusesCollection.update(id, (status) => {
      status.position = position;
    }),
  );
}

/** Makes a status its category's default. The server clears the previous default itself. */
export function makeDefaultStatus(id: string) {
  const status = statusesCollection.get(id);
  if (!status || status.isDefault) return;
  const previous = defaultStatus(
    [...statusesCollection.values()],
    status.projectId,
    status.category,
  );
  write(() => {
    if (previous)
      statusesCollection.update(previous.id, (draft) => {
        draft.isDefault = false;
      });
    statusesCollection.update(id, (draft) => {
      draft.isDefault = true;
    });
  });
}

/**
 * Why a status cannot be deleted, or null when it can: the default cannot go (which also keeps
 * a status in every category), nor can a status any task uses, counting the trash.
 */
export function statusDeletionIssue(status: Status, tasks: Iterable<Task>) {
  if (status.isDefault) return 'Make another status the default first.';
  for (const task of tasks) if (task.statusId === status.id) return 'Tasks use this status.';
  return null;
}

/** Deletes a status, unless `statusDeletionIssue` says it cannot be. Returns the issue. */
export function deleteStatus(id: string) {
  const status = statusesCollection.get(id);
  if (!status) return null;
  const issue = statusDeletionIssue(status, tasksCollection.values());
  if (!issue) write(() => statusesCollection.delete(id));
  return issue;
}
