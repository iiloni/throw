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
 * The alternatives the prototype exists to compare. Each is a design question that is still
 * open; a chosen value becomes the only behavior and its switch goes away.
 */
export const variantsSchema = z.object({
  /** What marks priority zones in a column nobody is dragging over. */
  zonesAtRest: z.enum(['always', 'edge', 'drag']).default('edge'),
  /** How a column behaves under a held card. */
  zoneModel: z.enum(['stretch', 'inPlace']).default('stretch'),
  lift: z.enum(['tilt', 'flat']).default('tilt'),
  priorityGlyph: z.boolean().default(true),
  subtaskTap: z.enum(['popout', 'open']).default('popout'),
  subtaskStatusInPlace: z.boolean().default(true),
  phoneMoves: z.enum(['grid', 'strip', 'sheet']).default('grid'),
  sideWidth: z.enum(['compact', 'roomy']).default('compact'),
});
export type Variants = z.infer<typeof variantsSchema>;
export const DEFAULT_VARIANTS: Variants = variantsSchema.parse({});

export function useVariants() {
  return usePersistentState('throw-board-prototype', variantsSchema, DEFAULT_VARIANTS);
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

/** Gives tasks a priority, each at the top of that zone in its own status. */
export function prioritize(taskIds: string[], priority: Priority) {
  const { project } = current();
  let tasks = current().tasks;
  for (const taskId of [...taskIds].reverse()) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || task.priority === priority) continue;
    const peers = tasks
      .filter((item) => item.statusId === task.statusId && item.priority === priority)
      .sort(compareTasks);
    tasks = placeTask(project, tasks, taskId, { priority, index: 0, peers });
  }
  setTasks(tasks);
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
