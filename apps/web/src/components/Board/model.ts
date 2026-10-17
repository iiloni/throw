import {
  type Color,
  comparePositions,
  compareTasks as compareTaskRows,
  positionBetween,
  taskIdentifier,
} from '@throw/shared';

export { DEFAULT_PRIORITY, DEFAULT_PRIORITY_NAMES, PRIORITIES, type Priority } from '@throw/shared';

import { DEFAULT_PRIORITY_NAMES, PRIORITIES, type Priority } from '@throw/shared';

/**
 * Presentation data shared by the synced board and the development prototype. Ranks and
 * ordering follow the shared task model; timestamps are milliseconds for motion and grouping.
 */

export type Category = 'backlog' | 'active' | 'done' | 'cancelled';
export const CATEGORIES: Category[] = ['backlog', 'active', 'done', 'cancelled'];

export type Status = {
  id: string;
  name: string;
  category: Category;
  isDefault: boolean;
};

export type Tag = {
  id: string;
  name: string;
  parentId: string | null;
  /** Set on root tags; children show their root's color. */
  color?: Color;
};

export type Task = {
  id: string;
  number: number | null;
  title: string;
  statusId: string;
  priority: Priority;
  position: string;
  primaryTagId: string | null;
  /** The synced adapter resolves this through the shared tag helper, including partial sync. */
  primaryTagColor?: Color | null;
  secondaryTagIds: string[];
  parentId: string | null;
  /** When the task entered a done or cancelled status. */
  closedAt: number | null;
  description?: string;
};

export type Project = {
  id: string;
  key: string | null;
  name: string;
  color: Color;
  icon: string | null;
  /** In board order: by category, then as arranged within it. */
  statuses: Status[];
  tags: Tag[];
  /** Overrides for the five rank names; an empty entry shows the default. */
  priorityNames: (string | null)[];
};

export function priorityName(project: Project, priority: Priority) {
  return project.priorityNames[priority - 1] || DEFAULT_PRIORITY_NAMES[priority - 1]!;
}

export function isClosed(category: Category) {
  return category === 'done' || category === 'cancelled';
}

export function statusById(project: Project, id: string) {
  return project.statuses.find((status) => status.id === id);
}

/** The color a card takes: its primary tag's root. */
export function taskColor(project: Project, task: Task): Color | null {
  if (task.primaryTagColor !== undefined) return task.primaryTagColor;
  let tag = project.tags.find((item) => item.id === task.primaryTagId);
  while (tag?.parentId) {
    const parent = project.tags.find((item) => item.id === tag?.parentId);
    if (!parent) break;
    tag = parent;
  }
  return tag?.color ?? null;
}

export function identifier(project: Project, task: Task) {
  return taskIdentifier(project, task);
}

/** Priority first, then manual order. The order of every column and gallery. */
export function compareTasks(a: Task, b: Task) {
  return compareTaskRows(a, b);
}

/** Closed work reads newest first. */
export function compareClosed(a: Task, b: Task) {
  return (b.closedAt ?? 0) - (a.closedAt ?? 0) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

export function subtasksOf(tasks: Task[], parentId: string) {
  return tasks
    .filter((task) => task.parentId === parentId)
    .sort(
      (a, b) =>
        comparePositions(a.position, b.position) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

/** Where a move puts a task. */
export type Placement = {
  /** Omit to keep the task's status, as when reordering a gallery of mixed statuses. */
  statusId?: string;
  priority: Priority;
  /**
   * Index among `peers`: the tasks shown in the destination's priority zone, in order,
   * without the moved task.
   */
  index: number;
  peers: Task[];
};

function withStatus(project: Project, task: Task, statusId: string, now: number): Task {
  if (statusId === task.statusId) return task;
  const from = statusById(project, task.statusId);
  const to = statusById(project, statusId);
  if (!to) return task;
  const wasClosed = from ? isClosed(from.category) : false;
  const closes = isClosed(to.category);
  return {
    ...task,
    statusId,
    // Stamped on entering a closed category and cleared on reopening; moving between two
    // closed statuses keeps the first time.
    closedAt: closes ? (wasClosed ? task.closedAt : now) : null,
  };
}

/** Moves one task to an exact place in a priority zone. */
export function placeTask(
  project: Project,
  tasks: Task[],
  taskId: string,
  placement: Placement,
  now = Date.now(),
): Task[] {
  const peers = placement.peers.filter((task) => task.id !== taskId);
  const index = Math.max(0, Math.min(placement.index, peers.length));
  const position = positionBetween(
    peers[index - 1]?.position ?? null,
    peers[index]?.position ?? null,
  );
  return tasks.map((task) => {
    if (task.id !== taskId) return task;
    const moved = placement.statusId ? withStatus(project, task, placement.statusId, now) : task;
    return { ...moved, priority: placement.priority, position };
  });
}

/**
 * Sends tasks to a status without choosing a place: each keeps its priority and lands at the
 * top of that priority's zone, in the order given.
 */
export function sendToStatus(
  project: Project,
  tasks: Task[],
  taskIds: string[],
  statusId: string,
  now = Date.now(),
): Task[] {
  let next = tasks;
  // Last first, so the first id ends up on top.
  for (const taskId of [...taskIds].reverse()) {
    const task = next.find((item) => item.id === taskId);
    if (!task || task.statusId === statusId) continue;
    const peers = next
      .filter(
        (item) =>
          item.statusId === statusId &&
          item.priority === task.priority &&
          item.parentId === task.parentId,
      )
      .sort(compareTasks);
    next = placeTask(
      project,
      next,
      taskId,
      { statusId, priority: task.priority, index: 0, peers },
      now,
    );
  }
  return next;
}

export type PriorityGroup = { priority: Priority; tasks: Task[] };

/** Splits an ordered list into the five priority zones, empty ones included. */
export function groupByPriority(tasks: Task[]): PriorityGroup[] {
  return PRIORITIES.map((priority) => ({
    priority,
    tasks: tasks.filter((task) => task.priority === priority),
  }));
}

export type BoardData = { project: Project; tasks: Task[]; hiddenTasks?: Task[] };

/** Statuses in their board groups, closed ones together, keeping the order they come in. */
export function byCategory<T extends { category: Category }>(statuses: readonly T[]) {
  const groups: { name: string; statuses: T[] }[] = [
    { name: 'Backlog', statuses: [] },
    { name: 'Active', statuses: [] },
    { name: 'Closed', statuses: [] },
  ];
  const slot: Record<Category, number> = { backlog: 0, active: 1, done: 2, cancelled: 2 };
  for (const status of statuses) groups[slot[status.category]]!.statuses.push(status);
  return groups;
}
