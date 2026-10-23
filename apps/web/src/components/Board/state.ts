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
  movedElsewhere,
  moveTo,
  type Place,
  type Priority,
  type Project,
  placementPlace,
  placeOf,
  sendToStatus,
  type Task,
} from './model';
import { rememberTaskOrigin } from './taskTransition';

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
  /** The tasks the open one was opened from, innermost last: where leaving it goes back to. */
  taskTrail: string[];
  /** Cards whose subtask underlay is unfolded. */
  expanded: string[];
  /**
   * A card picked up from the keyboard: the task as it was when picked up, and where it is
   * being carried. The board shows it there; nothing is written until it is set down.
   */
  carrying: { taskId: string; seen: Task; preview: Task } | null;
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
    taskTrail: [],
    expanded: [],
    carrying: null,
    announcement: '',
    newTaskId: null,
  };
}

export const board = createStore<BoardState>(initialBoard());

export function update(change: Partial<BoardState> | ((state: BoardState) => Partial<BoardState>)) {
  const state = board.get();
  const next = typeof change === 'function' ? change(state) : change;
  if (
    state.openTaskId &&
    'openTaskId' in next &&
    next.openTaskId !== state.openTaskId &&
    state.actions?.beforeLeave?.(state.openTaskId) === false
  )
    return;
  const moving = 'openTaskId' in next && next.openTaskId !== state.openTaskId;
  // Returning down the trail finds its task where it was left, so only a new opening grows.
  if (moving && next.openTaskId && innerWidth < 768 && !state.taskTrail.includes(next.openTaskId))
    rememberTaskOrigin(next.openTaskId);
  // Opening a task any other way starts a new trail.
  board.set({ ...state, ...(moving && !('taskTrail' in next) ? { taskTrail: [] } : {}), ...next });
}

/** A subtask opened from its parent's pane goes back to that pane when it is left. */
export function openSubtask(taskId: string) {
  update((state) => ({
    openTaskId: taskId,
    taskTrail: state.openTaskId ? [...state.taskTrail, state.openTaskId] : [],
  }));
}

/** Back, Escape and a dismissing pull: to the task this one was opened from, or the board. */
export function leaveTask() {
  update((state) => ({
    openTaskId: state.taskTrail.at(-1) ?? null,
    taskTrail: state.taskTrail.slice(0, -1),
  }));
}

export type BoardActions = {
  /** Flush device-local editor text before closing or opening another task. */
  beforeLeave?(taskId: string): boolean;
  create(statusId?: string): string;
  rename(taskId: string, title: string): void;
  /** False when the move could not be queued, such as for a task purged meanwhile. */
  place(taskId: string, place: Place): boolean;
  send(taskIds: string[], statusId: string): boolean;
};

type Received = [data: BoardData, actions: BoardActions, awaitingTasks: boolean];
/** The data last given to the board, to fall back on when a move cannot be queued. */
let received: Received | null = null;
/** While a card is held, sync waits here so the column does not change under it. */
let held = false;
let waiting: Received | null = null;

/** Sync replaces data only: open panes, filters and underlays remain device UI state. */
export function receiveBoard(data: BoardData, actions: BoardActions, awaitingTasks = false) {
  received = [data, actions, awaitingTasks];
  if (held && board.get().actions !== null && board.get().projectId === data.project.id) {
    waiting = received;
    return;
  }
  const before = board.get();
  if (before.projectId !== data.project.id || before.actions === null) {
    board.set({ ...initialBoard([data]), actions, awaitingTasks });
  } else {
    const exists = (id: string) => data.tasks.some((task) => task.id === id);
    const canOpen = (id: string) => exists(id) || data.hiddenTasks?.some((task) => task.id === id);
    const open = before.openTaskId && canOpen(before.openTaskId) ? before.openTaskId : null;
    update({
      boards: [data],
      actions,
      awaitingTasks,
      openTaskId: open,
      taskTrail: open ? before.taskTrail.filter(canOpen) : [],
      expanded: before.expanded.filter(exists),
      selection: before.selection.filter(exists),
      // A card carried from the keyboard that another device trashed or purged is dropped.
      ...(before.carrying && !exists(before.carrying.taskId)
        ? { carrying: null, announcement: 'The carried task was removed on another device.' }
        : {}),
    });
  }
}

/**
 * Holds incoming sync while a card is held: rows that arrive would reorder the column under
 * it, move the gap and could take the card itself away (ADR 0008).
 */
export function holdBoard() {
  held = true;
}

/**
 * Lets the held sync in, and returns which of the held cards can still be moved: those no
 * other device moved in the meantime. The others stay where the server put them.
 */
export function releaseBoard(taskIds: string[]): string[] {
  const seen = current().tasks;
  held = false;
  const next = waiting;
  waiting = null;
  if (next) receiveBoard(...next);
  const live = current().tasks;
  return taskIds.filter((id) => {
    const before = seen.find((task) => task.id === id);
    return (
      before &&
      !movedElsewhere(
        before,
        live.find((task) => task.id === id),
      )
    );
  });
}

function shown(state: BoardState): BoardData {
  return state.boards.find((item) => item.project.id === state.projectId) ?? state.boards[0]!;
}

const presented = new WeakMap<BoardState, BoardData>();

/** The board as shown: a card carried from the keyboard appears where it is being carried. */
export function current(state: BoardState = board.get()): BoardData {
  const data = shown(state);
  const carrying = state.carrying;
  if (!carrying) return data;
  let result = presented.get(state);
  if (!result) {
    result = {
      ...data,
      tasks: data.tasks.map((task) => (task.id === carrying.taskId ? carrying.preview : task)),
    };
    presented.set(state, result);
  }
  return result;
}

/** The board as synced, without a carried card's preview. */
export function syncedTasks(state: BoardState = board.get()) {
  return shown(state).tasks;
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
    taskTrail: [],
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

/**
 * Where a card lands at `index` in a priority zone of a list, among the cards shown there.
 * Worked out from what the person sees, so while a card is held it reads the held board.
 */
export function placeInList(
  taskId: string,
  listId: ListId,
  priority: Priority,
  index: number,
): Place | null {
  const state = board.get();
  const task = current(state).tasks.find((item) => item.id === taskId);
  if (!task) return null;
  const peers = listTasks(state, listId).filter((item) => item.priority === priority);
  return placementPlace(task, { statusId: listStatusId(listId), priority, index, peers });
}

/** Falls back to the synced data when a move could not be queued. */
function revert() {
  if (received) receiveBoard(...received);
}

/**
 * Moves a task to a place in one write (ADR 0008). The board shows it there at once, so a
 * landing card finds its place before sync brings the row back.
 */
export function moveToPlace(taskId: string, place: Place) {
  const { project } = current();
  const tasks = syncedTasks();
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return;
  const { statusId, priority, position } = task;
  if (place.statusId === statusId && place.priority === priority && place.position === position)
    return;
  setTasks(tasks.map((item) => (item.id === taskId ? moveTo(project, item, place) : item)));
  if (board.get().actions?.place(taskId, place) === false) revert();
}

export function sendTasks(taskIds: string[], statusId: string) {
  const { project } = current();
  const tasks = syncedTasks();
  // A card already in the status stays where it is.
  const moving = taskIds.filter(
    (id) => tasks.find((task) => task.id === id)?.statusId !== statusId,
  );
  if (moving.length === 0) return;
  setTasks(sendToStatus(project, tasks, moving, statusId));
  if (board.get().actions?.send(moving, statusId) === false) revert();
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

/** A card carried from the keyboard is shown at `preview` until it is set down. */
export function carryTo(preview: Task) {
  update((state) => (state.carrying ? { carrying: { ...state.carrying, preview } } : {}));
}

export function startCarrying(taskId: string) {
  const task = syncedTasks().find((item) => item.id === taskId);
  if (task) update({ carrying: { taskId, seen: task, preview: task } });
  return Boolean(task);
}

/**
 * Sets a carried card down: one write for where it ended up, unless another device moved it
 * while it was carried. Returns whether it moved.
 */
export function finishCarrying(): 'moved' | 'unchanged' | 'refused' | null {
  const carrying = board.get().carrying;
  if (!carrying) return null;
  const live = syncedTasks().find((task) => task.id === carrying.taskId);
  const place = placeOf(carrying.preview);
  const unchanged =
    live !== undefined &&
    place.statusId === live.statusId &&
    place.priority === live.priority &&
    place.position === live.position;
  if (movedElsewhere(carrying.seen, live)) {
    update({ carrying: null });
    return 'refused';
  }
  if (!unchanged) moveToPlace(carrying.taskId, place);
  update({ carrying: null });
  return unchanged ? 'unchanged' : 'moved';
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
