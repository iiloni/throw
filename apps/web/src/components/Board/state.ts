import { positionBetween } from '@throw/shared';
import { z } from 'zod';
import { usePersistentState } from '@/lib/storage';
import { createStore } from '@/lib/store';
import type { BoardData } from './model';
import {
  type Category,
  compareClosed,
  compareTasks,
  DEFAULT_PRIORITY,
  isClosed,
  type Priority,
  type Project,
  placeTask,
  sendToStatus,
  type Task,
} from './model';

/**
 * How the board looks and behaves, as the person using it prefers. Kept on the device.
 */
export const boardSettingsSchema = z.object({
  /** Name the priority zones in a column at rest. Off: they show only under a held card. */
  zoneLabels: z.boolean().default(false),
  /** Mark a card's priority on the card itself. */
  cardPriority: z.boolean().default(false),
  /** Zones and columns sit on a faint surface of their own. */
  surfaces: z.boolean().default(true),
  /**
   * A column under a held card: `compact` folds every priority but one into rails, `full`
   * keeps the column's layout and dims the other priorities.
   */
  heldColumn: z.enum(['compact', 'full']).default('compact'),
  /**
   * Each of the backlog and closed rails: `sticky` keeps it at the window's edge with the
   * columns scrolling beneath, `bound` puts it at its end of the columns and scrolls it too.
   */
  backlogRail: z.enum(['sticky', 'bound']).default('sticky'),
  closedRail: z.enum(['sticky', 'bound']).default('sticky'),
  /**
   * Draw scrollbars. Off, a faded edge is all that says a list goes on; some people need the
   * bar itself.
   */
  scrollbars: z.boolean().default(false),
});
export type BoardSettings = z.infer<typeof boardSettingsSchema>;

export function useBoardSettings() {
  return usePersistentState(
    'throw-board-settings',
    boardSettingsSchema,
    boardSettingsSchema.parse({}),
  );
}

/** A side zone is a strip, a single column, or a gallery across the whole board. */
export type ZoneState = 'strip' | 'panel' | 'full';

export type BoardState = {
  boards: BoardData[];
  /** Null only in the mock prototype. The drag step will extend this boundary. */
  actions: BoardActions | null;
  awaitingTasks: boolean;
  projectId: string;
  backlog: ZoneState;
  closed: ZoneState;
  /** A status id, or null for every status in the zone. */
  backlogFilter: string | null;
  closedFilter: string | null;
  subtasksAsCards: boolean;
  selection: string[];
  openTaskId: string | null;
  /** Cards whose subtask underlay is unfolded. */
  expanded: string[];
  /** A card picked up from the keyboard, and the tasks as they were before. */
  carrying: { taskId: string; before: Task[] } | null;
  announcement: string;
  /** A task just created, whose title is waiting to be written. */
  newTaskId: string | null;
};

export function initialBoard(boards: BoardData[] = []): BoardState {
  return {
    boards,
    projectId: boards[0]?.project.id ?? '',
    actions: null,
    awaitingTasks: false,
    backlog: window.innerWidth >= 1180 ? 'panel' : 'strip',
    closed: 'strip',
    backlogFilter: null,
    closedFilter: null,
    subtasksAsCards: false,
    selection: [],
    openTaskId: null,
    expanded: [],
    carrying: null,
    announcement: '',
    newTaskId: null,
  };
}

export const board = createStore<BoardState>(initialBoard());

export function update(change: Partial<BoardState> | ((state: BoardState) => Partial<BoardState>)) {
  const state = board.get();
  board.set({ ...state, ...(typeof change === 'function' ? change(state) : change) });
}

export type BoardActions = {
  create(statusId?: string): string;
  rename(taskId: string, title: string): void;
  send(taskIds: string[], statusId: string): void;
};

/** Sync replaces data only: open panes, filters and underlays remain device UI state. */
export function receiveBoard(data: BoardData, actions: BoardActions, awaitingTasks = false) {
  const before = board.get();
  if (before.projectId !== data.project.id || before.actions === null) {
    board.set({ ...initialBoard([data]), actions, awaitingTasks });
  } else {
    const exists = (id: string) => data.tasks.some((task) => task.id === id);
    update({
      boards: [data],
      actions,
      awaitingTasks,
      openTaskId: before.openTaskId && exists(before.openTaskId) ? before.openTaskId : null,
      expanded: before.expanded.filter(exists),
      selection: before.selection.filter(exists),
    });
  }
}

export function current(state: BoardState = board.get()): BoardData {
  return state.boards.find((item) => item.project.id === state.projectId) ?? state.boards[0]!;
}

function setTasks(tasks: Task[]) {
  update((state) => ({
    boards: state.boards.map((item) =>
      item.project.id === state.projectId ? { ...item, tasks } : item,
    ),
  }));
}

export function selectProject(projectId: string) {
  update({
    projectId,
    backlogFilter: null,
    closedFilter: null,
    selection: [],
    openTaskId: null,
    carrying: null,
  });
}

/**
 * Lists are where cards can be placed: one per active status, plus the backlog gallery.
 * The closed zone is ordered by time, so cards are sent to it, never placed in it.
 */
export type ListId = 'backlog' | 'closed' | `status:${string}`;

export function listStatusId(listId: ListId) {
  return listId.startsWith('status:') ? listId.slice('status:'.length) : undefined;
}

function statusIdsIn(project: Project, categories: Category[], filter: string | null) {
  return project.statuses
    .filter((status) => categories.includes(status.category))
    .filter((status) => filter === null || status.id === filter)
    .map((status) => status.id);
}

/** The cards a list shows, in order. */
export function listTasks(state: BoardState, listId: ListId): Task[] {
  const { project, tasks } = current(state);
  const statusIds =
    listId === 'backlog'
      ? statusIdsIn(project, ['backlog'], state.backlogFilter)
      : listId === 'closed'
        ? statusIdsIn(project, ['done', 'cancelled'], state.closedFilter)
        : [listStatusId(listId)];
  return tasks
    .filter((task) => statusIds.includes(task.statusId))
    .filter((task) => state.subtasksAsCards || task.parentId === null)
    .sort(listId === 'closed' ? compareClosed : compareTasks);
}

export function countIn(state: BoardState, statusId: string) {
  return current(state).tasks.filter(
    (task) => task.statusId === statusId && (state.subtasksAsCards || task.parentId === null),
  ).length;
}

export function placeInList(taskId: string, listId: ListId, priority: Priority, index: number) {
  const state = board.get();
  const { project, tasks } = current(state);
  const peers = listTasks(state, listId).filter((task) => task.priority === priority);
  setTasks(
    placeTask(project, tasks, taskId, { statusId: listStatusId(listId), priority, index, peers }),
  );
}

export function sendTasks(taskIds: string[], statusId: string) {
  if (board.get().actions) return board.get().actions!.send(taskIds, statusId);
  const { project, tasks } = current();
  setTasks(sendToStatus(project, tasks, taskIds, statusId));
}

export function setSubtaskStatus(taskId: string, statusId: string) {
  sendTasks([taskId], statusId);
}

/**
 * A new task at the top of the default priority in a status: by default the backlog's
 * default status, as the spec has it, or the column it was made from.
 */
export function createTask(statusId?: string) {
  const actions = board.get().actions;
  if (actions) {
    const id = actions.create(statusId);
    update({
      openTaskId: id,
      newTaskId: id,
      ...(statusId === undefined ? { backlogFilter: null } : {}),
    });
    return;
  }
  const { project, tasks } = current();
  const status =
    project.statuses.find((item) => item.id === statusId) ??
    project.statuses.find((item) => item.category === 'backlog' && item.isDefault);
  if (!status) return;
  const peers = tasks
    .filter((task) => task.statusId === status.id && task.priority === DEFAULT_PRIORITY)
    .sort(compareTasks);
  const number = Math.max(0, ...tasks.map((task) => task.number ?? 0)) + 1;
  const task: Task = {
    id: `${project.id}:task-${number}`,
    number,
    title: 'New task',
    statusId: status.id,
    priority: DEFAULT_PRIORITY,
    position: positionBetween(null, peers[0]?.position ?? null),
    primaryTagId: null,
    secondaryTagIds: [],
    parentId: null,
    closedAt: null,
  };
  setTasks([...tasks, task]);
  update({ openTaskId: task.id, newTaskId: task.id });
}

export function renameTask(taskId: string, title: string) {
  if (board.get().actions) return board.get().actions!.rename(taskId, title);
  const { tasks } = current();
  setTasks(tasks.map((task) => (task.id === taskId ? { ...task, title } : task)));
}

export function restoreTasks(tasks: Task[]) {
  setTasks(tasks);
}

export function toggleSelected(taskId: string) {
  update((state) => ({
    selection: state.selection.includes(taskId)
      ? state.selection.filter((id) => id !== taskId)
      : [...state.selection, taskId],
  }));
}

export function toggleExpanded(taskId: string) {
  update((state) => ({
    expanded: state.expanded.includes(taskId)
      ? state.expanded.filter((id) => id !== taskId)
      : [...state.expanded, taskId],
  }));
}

/** Opens whichever zone holds a status, so a card sent there from the keyboard stays in view. */
export function revealStatus(statusId: string) {
  const status = current().project.statuses.find((item) => item.id === statusId);
  if (!status) return;
  if (status.category === 'backlog') {
    update((state) => ({
      backlog: state.backlog === 'strip' ? 'panel' : state.backlog,
      backlogFilter: null,
    }));
  } else if (isClosed(status.category)) {
    update((state) => ({
      closed: state.closed === 'strip' ? 'panel' : state.closed,
      closedFilter: null,
    }));
  }
}
