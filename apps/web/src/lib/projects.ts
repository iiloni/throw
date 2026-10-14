import {
  COLORS,
  comparePositions,
  deriveProjectKey,
  EMPTY_PRIORITY_NAMES,
  type Priority,
  type Project,
  positionBetween,
  priorityNamesSchema,
  projectKeySchema,
  STARTER_STATUSES,
  taskTagKey,
  updateProjectSchema,
} from '@throw/shared';
import { uuidv7 } from 'uuidv7';
import {
  projectsCollection,
  statusesCollection,
  tagsCollection,
  tasksCollection,
  taskTagsCollection,
  write,
} from './collections';

/** A workspace's projects outside the trash, in their arranged order. */
export function projectsIn(projects: readonly Project[], workspaceId: string) {
  return projects
    .filter((project) => project.workspaceId === workspaceId && project.deletedAt === null)
    .sort((a, b) => comparePositions(a.position, b.position));
}

/**
 * Adds a project at the end of its workspace, in the next color nobody there has taken, with
 * one status in each category, so tasks can go in it at once, offline too. `key` is the
 * proposal for its task identifiers; the server settles it when the project syncs, and until
 * then the project has none.
 */
export function createProject(
  workspaceId: string,
  name: string,
  appearance?: Pick<Project, 'color' | 'icon'>,
  key = deriveProjectKey(name),
) {
  const siblings = projectsIn([...projectsCollection.values()], workspaceId);
  const used = new Set(siblings.map((project) => project.color));
  const id = uuidv7();
  write(() => {
    projectsCollection.insert({
      id,
      workspaceId,
      name: name.trim(),
      color: COLORS.find((color) => !used.has(color)) ?? COLORS[siblings.length % COLORS.length]!,
      icon: null,
      position: positionBetween(siblings.at(-1)?.position ?? null, null),
      key: null,
      proposedKey: projectKeySchema.parse(key),
      priorityNames: EMPTY_PRIORITY_NAMES,
      deletedAt: null,
      ...appearance,
    });
    for (const status of STARTER_STATUSES) {
      statusesCollection.insert({
        ...status,
        id: uuidv7(),
        workspaceId,
        projectId: id,
        position: positionBetween(null, null),
        isDefault: true,
      });
    }
  });
  return id;
}

export function updateProject(
  id: string,
  changes: Partial<Pick<Project, 'name' | 'color' | 'icon' | 'position'>>,
) {
  const valid = updateProjectSchema.parse(changes);
  write(() => projectsCollection.update(id, (project) => Object.assign(project, valid)));
}

/**
 * Changes the prefix of the project's task identifiers. Only a project whose key has synced
 * can change it, and the server refuses a key another project in the workspace has.
 */
export function changeProjectKey(id: string, key: string) {
  const valid = projectKeySchema.parse(key);
  if (projectsCollection.get(id)?.key == null) throw new Error('The project has not synced yet');
  write(() =>
    projectsCollection.update(id, (project) => {
      project.key = valid;
    }),
  );
}

/** Names a priority rank in this project. An empty name restores the default. */
export function renamePriority(id: string, rank: Priority, name: string) {
  const project = projectsCollection.get(id);
  if (!project) return;
  const names = priorityNamesSchema.parse(
    project.priorityNames.map((current, index) => (index === rank - 1 ? name : current)),
  );
  write(() =>
    projectsCollection.update(id, (draft) => {
      draft.priorityNames = names;
    }),
  );
}

/**
 * Sends a project to the trash, and everything in it with it, without writing to its rows. The
 * time is a placeholder until the server's arrives.
 */
export function trashProject(id: string) {
  write(() =>
    projectsCollection.update(id, (project) => {
      project.deletedAt = new Date().toISOString();
    }),
  );
}

export function restoreProject(id: string) {
  write(() =>
    projectsCollection.update(id, (project) => {
      project.deletedAt = null;
    }),
  );
}

/** Deletes a project in the trash for good, with its statuses and tasks. */
export function purgeProject(id: string) {
  if (projectsCollection.get(id)?.deletedAt == null) return;
  write(() => deleteProjectRows(id));
}

/** Removes a purged project's rows from the device. Only the project's own delete is sent. */
export function deleteProjectRows(id: string) {
  const tasks = [...tasksCollection.values()].filter((task) => task.projectId === id);
  const statuses = [...statusesCollection.values()].filter((status) => status.projectId === id);
  for (const row of taskTagsCollection.values())
    if (row.projectId === id) taskTagsCollection.delete(taskTagKey(row));
  for (const tag of tagsCollection.values())
    if (tag.projectId === id) tagsCollection.delete(tag.id);
  for (const task of tasks) tasksCollection.delete(task.id);
  for (const status of statuses) statusesCollection.delete(status.id);
  projectsCollection.delete(id);
}

/** Removes a purged task and its subtasks from the device. Only the task's own delete is sent. */
export function deleteTaskRows(id: string) {
  const subtasks = [...tasksCollection.values()].filter((task) => task.parentId === id);
  const removed = new Set([id, ...subtasks.map((task) => task.id)]);
  for (const row of taskTagsCollection.values())
    if (removed.has(row.taskId)) taskTagsCollection.delete(taskTagKey(row));
  for (const task of subtasks) tasksCollection.delete(task.id);
  tasksCollection.delete(id);
}
