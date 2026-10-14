import { z } from 'zod';
import { usePersistentState } from '@/lib/storage';
import { createStore } from '@/lib/store';
import { type BoardData, mockBoards } from './mockData';
import {
  type Category,
  compareClosed,
  compareTasks,
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
};

function initial(): BoardState {
  const boards = mockBoards();
  return {
    boards,
    projectId: boards[0]!.project.id,
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
  };
}

export const board = createStore<BoardState>(initial());

export function update(change: Partial<BoardState> | ((state: BoardState) => Partial<BoardState>)) {
  const state = board.get();
  board.set({ ...state, ...(typeof change === 'function' ? change(state) : change) });
}

export function resetBoard() {
  board.set(initial());
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
  const { project, tasks } = current();
  setTasks(sendToStatus(project, tasks, taskIds, statusId));
}

export function setSubtaskStatus(taskId: string, statusId: string) {
  sendTasks([taskId], statusId);
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
