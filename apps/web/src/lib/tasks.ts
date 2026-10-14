import {
  closedAtAfter,
  comparePositions,
  compareTasks,
  DEFAULT_PRIORITY,
  type Description,
  descriptionSchema,
  isTaskTrashed,
  type Priority,
  positionBetween,
  prioritySchema,
  type Status,
  type Task,
  taskSchema,
  taskTitleSchema,
} from '@throw/shared';
import { uuidv7 } from 'uuidv7';
import {
  projectsCollection,
  statusesCollection,
  tasksCollection,
  taskTagsCollection,
  write,
} from './collections';
import { deleteProjectRows, deleteTaskRows } from './projects';
import { defaultStatus } from './statuses';
import { requireTag } from './tags';

// Server times (`closedAt`, `deletedAt`, `createdAt`) get a placeholder from the device's
// clock here, so a change shows at once; the synced row brings the server's.
const now = () => new Date().toISOString();

/**
 * A position at the top of a priority in a status column: where a new task or a task sent to
 * a status lands. Trashed tasks are left out.
 */
export function positionAtTop(tasks: Iterable<Task>, statusId: string, priority: Priority): string {
  let first: Task | undefined;
  for (const task of tasks) {
    if (
      task.statusId === statusId &&
      task.priority === priority &&
      task.parentId === null &&
      task.deletedAt === null &&
      (!first || compareTasks(task, first) < 0)
    )
      first = task;
  }
  return positionBetween(null, first?.position ?? null);
}

/** A position after a parent's last subtask. */
export function positionAfterSubtasks(tasks: Iterable<Task>, parentId: string): string {
  let last: string | null = null;
  for (const task of tasks)
    if (task.parentId === parentId && (last === null || comparePositions(task.position, last) > 0))
      last = task.position;
  return positionBetween(last, null);
}

function requireStatus(statusId: string, projectId: string): Status {
  const status = statusesCollection.get(statusId);
  if (!status || status.projectId !== projectId) throw new Error('Status not in this project');
  return status;
}

/** A subtask's parent: a top-level task of the same project, and not the task itself. */
function requireParent(parentId: string, task: Pick<Task, 'id' | 'projectId'>) {
  const parent = tasksCollection.get(parentId);
  if (
    !parent ||
    parent.projectId !== task.projectId ||
    parent.parentId !== null ||
    parent.id === task.id
  )
    throw new Error('A subtask needs a top-level parent in its project');
  for (const other of tasksCollection.values())
    if (other.parentId === task.id) throw new Error('A task with subtasks cannot be a subtask');
  return parent;
}

export interface NewTask {
  title?: string;
  /** The backlog's default status when left out. */
  statusId?: string;
  priority?: Priority;
  parentId?: string | null;
  /** At the top of its priority, or after its parent's subtasks, when left out. */
  position?: string;
  description?: Description;
  primaryTagId?: string | null;
  secondaryTagIds?: string[];
}

/**
 * Creates a task, offline too. It has no number, and so no identifier, until it syncs
 * (ADR 0007). Returns its id.
 */
export function createTask(projectId: string, fields: NewTask = {}) {
  const project = projectsCollection.get(projectId);
  if (!project) throw new Error('Project not found');
  const status = fields.statusId
    ? requireStatus(fields.statusId, projectId)
    : defaultStatus([...statusesCollection.values()], projectId);
  if (!status) throw new Error('The project has no backlog status');
  const id = uuidv7();
  const parentId = fields.parentId ?? null;
  if (parentId !== null) requireParent(parentId, { id, projectId });
  const priority = prioritySchema.parse(fields.priority ?? DEFAULT_PRIORITY);
  const description = descriptionSchema.parse(fields.description ?? null);
  const primaryTagId = fields.primaryTagId ?? null;
  if (primaryTagId) requireTag(primaryTagId, projectId);
  const secondaryTagIds = [...new Set(fields.secondaryTagIds ?? [])];
  for (const tagId of secondaryTagIds) requireTag(tagId, projectId);
  const created = now();
  const task = taskSchema.parse({
    id,
    workspaceId: project.workspaceId,
    projectId,
    number: null,
    primaryTagId,
    title: fields.title ?? '',
    description,
    descriptionVersion: description === null ? null : uuidv7(),
    statusId: status.id,
    priority,
    position:
      fields.position ??
      (parentId === null
        ? positionAtTop(tasksCollection.values(), status.id, priority)
        : positionAfterSubtasks(tasksCollection.values(), parentId)),
    parentId,
    closedAt: closedAtAfter(null, null, status.category, created),
    deletedAt: null,
    createdAt: created,
  } satisfies Task);
  write(() => {
    tasksCollection.insert(task);
    for (const tagId of secondaryTagIds)
      taskTagsCollection.insert({ taskId: id, tagId, projectId, workspaceId: project.workspaceId });
  });
  return id;
}

export interface TaskEdit {
  primaryTagId?: string | null;
  title?: string;
  priority?: Priority;
  statusId?: string;
  /** Null makes a subtask a top-level task. */
  parentId?: string | null;
  position?: string;
}

/**
 * The changes an edit makes to a task, with the placeholders the server will replace:
 * `closedAt` follows the status's category. A task that gains or loses a parent goes to the
 * end of its new parent's subtasks or the top of its priority, unless a position is given.
 */
export function taskEditChanges(
  task: Task,
  edit: TaskEdit,
  statuses: { get(id: string): Status | undefined },
  tasks: Iterable<Task>,
  time = now(),
): Partial<Task> {
  const changes: Partial<Task> = {};
  if (edit.primaryTagId !== undefined) changes.primaryTagId = edit.primaryTagId;
  if (edit.title !== undefined) changes.title = taskTitleSchema.parse(edit.title);
  if (edit.priority !== undefined) changes.priority = prioritySchema.parse(edit.priority);
  if (edit.statusId !== undefined && edit.statusId !== task.statusId) {
    const from = statuses.get(task.statusId);
    const to = statuses.get(edit.statusId);
    if (!to || to.projectId !== task.projectId) throw new Error('Status not in this project');
    changes.statusId = to.id;
    changes.closedAt = closedAtAfter(task.closedAt, from?.category ?? null, to.category, time);
  }
  if (edit.parentId !== undefined && edit.parentId !== task.parentId) {
    changes.parentId = edit.parentId;
    if (edit.position === undefined)
      changes.position =
        edit.parentId === null
          ? positionAtTop(
              tasks,
              changes.statusId ?? task.statusId,
              changes.priority ?? task.priority,
            )
          : positionAfterSubtasks(tasks, edit.parentId);
  }
  if (edit.position !== undefined) changes.position = edit.position;
  return changes;
}

/**
 * Changes a task's fields. Each changed field is sent with the value this device held, and
 * the server leaves a field another device changed first (ADR 0005).
 */
export function updateTask(id: string, edit: TaskEdit) {
  const task = tasksCollection.get(id);
  if (!task) throw new Error('Task not found');
  if (edit.parentId) requireParent(edit.parentId, task);
  if (edit.primaryTagId) requireTag(edit.primaryTagId, task.projectId);
  const changes = taskEditChanges(task, edit, statusesCollection, tasksCollection.values());
  if (Object.keys(changes).length === 0) return;
  write(() => tasksCollection.update(id, (draft) => Object.assign(draft, changes)));
}

/**
 * Places a task: a drop on the board sets its status, priority and position in one write
 * (ADR 0008). The position applies only if the task is still in that status and priority.
 */
export function moveTask(
  id: string,
  place: { statusId: string; priority: Priority; position: string },
) {
  updateTask(id, place);
}

/**
 * Sends a task to a status at the top of its priority, as a drop on a status target does. A
 * subtask keeps its place among its parent's subtasks.
 */
export function sendTask(id: string, statusId: string) {
  const task = tasksCollection.get(id);
  if (!task) throw new Error('Task not found');
  updateTask(
    id,
    task.parentId === null
      ? { statusId, position: positionAtTop(tasksCollection.values(), statusId, task.priority) }
      : { statusId },
  );
}

/**
 * Saves a description under a new version. The server compares versions, so a save made on
 * an older version than the server's is kept in the log instead of applied (ADR 0005).
 */
export function saveDescription(id: string, document: Description) {
  const valid = descriptionSchema.parse(document);
  write(() =>
    tasksCollection.update(id, (task) => {
      task.description = valid;
      task.descriptionVersion = uuidv7();
    }),
  );
}

/**
 * Sends a task to the trash. Its subtasks count as trashed with it, without being written to.
 */
export function trashTask(id: string) {
  write(() =>
    tasksCollection.update(id, (task) => {
      task.deletedAt = now();
    }),
  );
}

/** Restores a task. A subtask trashed on its own stays in the trash. */
export function restoreTask(id: string) {
  write(() =>
    tasksCollection.update(id, (task) => {
      task.deletedAt = null;
    }),
  );
}

/** Whether a task counts as trashed: it, its parent or its project is in the trash. */
export function taskInTrash(task: Task) {
  const parent = task.parentId === null ? null : tasksCollection.get(task.parentId);
  return isTaskTrashed(task, parent, projectsCollection.get(task.projectId));
}

/** Deletes a trashed task for good, with its subtasks. */
export function purgeTask(id: string) {
  const task = tasksCollection.get(id);
  if (!task || !taskInTrash(task)) return;
  write(() => deleteTaskRows(id));
}

/**
 * What the trash of a workspace lists: projects in the trash, and tasks trashed on their own
 * whose project and parent are not. Everything under a listed item goes with it.
 */
export function trashedItems(workspaceId: string) {
  const projects = [...projectsCollection.values()].filter(
    (project) => project.workspaceId === workspaceId && project.deletedAt !== null,
  );
  const tasks = [...tasksCollection.values()].filter(
    (task) =>
      task.workspaceId === workspaceId &&
      task.deletedAt !== null &&
      !projectsCollection.get(task.projectId)?.deletedAt &&
      (task.parentId === null || !tasksCollection.get(task.parentId)?.deletedAt),
  );
  return { projects, tasks };
}

/**
 * Empties a workspace's trash as this device sees it, in one write. The server purges only
 * what is still in the trash when the write arrives, so an item restored on another device in
 * the meantime is kept.
 */
export function emptyTrash(workspaceId: string) {
  const { projects, tasks } = trashedItems(workspaceId);
  if (projects.length === 0 && tasks.length === 0) return;
  write(() => {
    for (const task of tasks) deleteTaskRows(task.id);
    for (const project of projects) deleteProjectRows(project.id);
  });
}
