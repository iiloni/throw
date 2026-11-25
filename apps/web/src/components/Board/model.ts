import {
  type Color,
  comparePositions,
  compareTasks as compareTaskRows,
  positionBetween,
  type Size,
  type TagIconName,
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
  color?: Color | null;
  isDefault: boolean;
};

export type Tag = {
  id: string;
  name: string;
  parentId: string | null;
  /** Set on root tags; children show their root's color. */
  color?: Color;
  /** Set on root tags; children show their root's icon. */
  icon?: TagIconName | null;
};

export type Task = {
  id: string;
  number: number | null;
  title: string;
  statusId: string;
  priority: Priority;
  size: Size | null;
  position: string;
  primaryTagId: string | null;
  /** The synced adapter resolves this through the shared tag helper, including partial sync. */
  primaryTagColor?: Color | null;
  secondaryTagIds: string[];
  parentId: string | null;
  /** When the task entered a done or cancelled status. */
  closedAt: number | null;
  description?: string;
  /**
   * The title and description text as search compares them (`normalizeSearch`). The synced
   * adapter sets it, since it does not carry the description itself; without it, search reads
   * the title and `description`.
   */
  searchText?: string;
  /** Set on the workspace board, which gathers several projects' tasks. */
  projectId?: string;
  /** When the task was created; the Added sort reads it. */
  createdAt?: string;
  /** When the task last changed, from its activity log; the Updated sort reads it. */
  updatedAt?: string;
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
  /**
   * The projects a workspace board gathers. Its own statuses and tags are theirs together,
   * and each task belongs to the member its `projectId` names.
   */
  members?: Project[];
};

/** The project a task belongs to: itself, or on the workspace board, the task's member. */
export function projectOf(project: Project, task: Pick<Task, 'projectId'>): Project {
  return project.members?.find((member) => member.id === task.projectId) ?? project;
}

/**
 * A drop on a whole category rather than one of its statuses, as the workspace board's columns
 * take it: each task goes to its own project's default status there (spec, "The cross-project
 * board").
 */
export type CategoryTarget = `category:${Category}`;

export function categoryTarget(category: Category): CategoryTarget {
  return `category:${category}`;
}

export function targetCategory(statusId: string): Category | null {
  if (!statusId.startsWith('category:')) return null;
  const category = statusId.slice('category:'.length) as Category;
  return CATEGORIES.includes(category) ? category : null;
}

export function defaultStatus(project: Project, category: Category) {
  const statuses = project.statuses.filter((status) => status.category === category);
  return statuses.find((status) => status.isDefault) ?? statuses[0];
}

/**
 * Splits a send into one per status it reaches. A category target sends each task to its own
 * project's default status in that category, and leaves a task already in the category where
 * it is: putting a card back in its own column is not a move.
 */
export function resolveSend(
  project: Project,
  tasks: Task[],
  taskIds: string[],
  statusId: string,
): { statusId: string; taskIds: string[] }[] {
  const category = targetCategory(statusId);
  if (!category) return [{ statusId, taskIds }];
  const sends = new Map<string, string[]>();
  for (const id of taskIds) {
    const task = tasks.find((item) => item.id === id);
    if (!task) continue;
    const own = projectOf(project, task);
    if (statusById(own, task.statusId)?.category === category) continue;
    const target = defaultStatus(own, category);
    if (!target) continue;
    sends.set(target.id, [...(sends.get(target.id) ?? []), id]);
  }
  return [...sends].map(([target, ids]) => ({ statusId: target, taskIds: ids }));
}

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
  return taskIdentifier(projectOf(project, task), task);
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

/** A task's place on the board: what one move writes, all three together (ADR 0008). */
export type Place = { statusId: string; priority: Priority; position: string };

export function placeOf(task: Task): Place {
  return { statusId: task.statusId, priority: task.priority, position: task.position };
}

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

/** The task as it is once moved to `place`. */
export function moveTo(project: Project, task: Task, place: Place, now = Date.now()): Task {
  const moved = withStatus(project, task, place.statusId, now);
  // A subtask's position orders it among its parent's subtasks, not in a column, so a
  // card that stands for one keeps it.
  const position = task.parentId === null ? place.position : task.position;
  return { ...moved, priority: place.priority, position };
}

/** Where a placement puts a task, worked out from the peers it was shown among. */
export function placementPlace(task: Task, placement: Placement): Place {
  const peers = placement.peers.filter((peer) => peer.id !== task.id);
  const index = Math.max(0, Math.min(placement.index, peers.length));
  const before = peers[index - 1];
  const after = peers[index];
  const statusId = placement.statusId ?? task.statusId;
  // Put down where it already was: nothing to write.
  if (
    statusId === task.statusId &&
    placement.priority === task.priority &&
    (!before || compareTasks(before, task) < 0) &&
    (!after || compareTasks(task, after) < 0)
  )
    return placeOf(task);
  return {
    statusId,
    priority: placement.priority,
    position: positionBetween(before?.position ?? null, after?.position ?? null),
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
  return tasks.map((task) =>
    task.id === taskId ? moveTo(project, task, placementPlace(task, placement), now) : task,
  );
}

/**
 * Whether another device moved a task while this one held it: its status, priority or parent
 * is no longer what the person saw when they picked it up. The server would keep its own
 * values over a move made from that view (ADR 0005), so the board does not send one.
 */
export function movedElsewhere(seen: Task, live: Task | undefined) {
  return (
    live === undefined ||
    live.statusId !== seen.statusId ||
    live.priority !== seen.priority ||
    live.parentId !== seen.parentId
  );
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

/**
 * Which of a board's tasks take part in relations its filter can choose, as the real boards
 * derive them from synced relations (`boardRelations`). The prototype has none.
 */
export type BoardRelations = {
  /** Tasks with an open blocker, as the card's blocked badge counts them. */
  blocked: ReadonlySet<string>;
  /** Open tasks blocking another open task that is not in the trash. */
  blocking: ReadonlySet<string>;
  /** Tasks that duplicate, or are duplicated by, a task that is not in the trash. */
  duplicates: ReadonlySet<string>;
};

export type BoardData = {
  project: Project;
  tasks: Task[];
  hiddenTasks?: Task[];
  relations?: BoardRelations;
};

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
