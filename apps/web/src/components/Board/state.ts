import { positionBetween } from '@throw/shared';
import { z } from 'zod';
import { isDesktop } from '@/lib/media';
import { readPreference, usePersistentState, writePreference } from '@/lib/storage';
import { createStore } from '@/lib/store';
import {
  type BoardFilter,
  type BoardSort,
  compareByField,
  EMPTY_FILTER,
  isFiltering,
  matchingIds,
  sortOrder,
} from './filter';
import type { BoardData } from './model';
import {
  CATEGORIES,
  type Category,
  categoryTarget,
  compareClosed,
  compareTasks,
  DEFAULT_PRIORITY,
  groupByPriority,
  isClosed,
  movedElsewhere,
  moveTo,
  type Place,
  type Priority,
  type Project,
  placementPlace,
  placeOf,
  resolveSend,
  sendToStatus,
  statusById,
  type Task,
  targetCategory,
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
  cardSize: z.boolean().default(false),
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
  /** Subtasks as top-level cards in their own statuses, rather than with their parent. */
  subtasksAsCards: z.boolean().default(false),
});
export type BoardSettings = z.infer<typeof boardSettingsSchema>;

const BOARD_SETTINGS_KEY = 'throw-board-settings';

export function useBoardSettings() {
  return usePersistentState(BOARD_SETTINGS_KEY, boardSettingsSchema, boardSettingsSchema.parse({}));
}

function storedBoardSettings() {
  return readPreference(BOARD_SETTINGS_KEY, boardSettingsSchema, boardSettingsSchema.parse({}));
}

/**
 * Shows subtasks as cards on every board, and keeps the choice on the device. The board
 * state carries it so its selections stay pure functions of that state.
 */
export function setSubtasksAsCards(value: boolean) {
  writePreference(BOARD_SETTINGS_KEY, { ...storedBoardSettings(), subtasksAsCards: value });
  update({ subtasksAsCards: value });
}

/**
 * Desktop columns folded to a strip, kept on the device as Catch keeps its deck's. A project
 * board keeps the ids of its folded active statuses under its own key. The workspace board
 * keeps one flag per category, which its phone pages share for Done and Cancelled only.
 */
const collapsedSchema = z.array(z.string());
const foldedSchema = z.object({
  backlog: z.boolean().default(false),
  active: z.boolean().default(false),
  done: z.boolean().default(false),
  cancelled: z.boolean().default(true),
});
const FOLDED_KEY = 'throw-workspace-board-folded';
const collapsedKey = (projectId: string) => `throw-board-collapsed:${projectId}`;
const storedFolded = () => readPreference(FOLDED_KEY, foldedSchema, foldedSchema.parse({}));

/** Done starts open and Cancelled folded; a choice to fold or open either stays on the device. */
export function useFoldedColumns() {
  return usePersistentState(FOLDED_KEY, foldedSchema, foldedSchema.parse({}));
}

/**
 * Which columns of the board shown are folded. A column is an active status's id on a project
 * board, or a category target (`category:done`) on the workspace board.
 */
export function useCollapsedColumns(project: Project) {
  const [ids] = usePersistentState(collapsedKey(project.id), collapsedSchema, []);
  const [folded] = useFoldedColumns();
  const workspace = project.members !== undefined;
  return {
    isCollapsed: (columnId: string) => {
      const category = targetCategory(columnId);
      return workspace ? category !== null && folded[category] : ids.includes(columnId);
    },
    setCollapsed: (columnId: string, value: boolean) => setCollapsed(project, columnId, value),
  };
}

function setCollapsed(project: Project, columnId: string, value: boolean) {
  if (project.members !== undefined) {
    const category = targetCategory(columnId);
    const folded = storedFolded();
    if (category && folded[category] !== value)
      writePreference(FOLDED_KEY, { ...folded, [category]: value });
    return;
  }
  const ids = readPreference(collapsedKey(project.id), collapsedSchema, []);
  if (ids.includes(columnId) === value) return;
  writePreference(
    collapsedKey(project.id),
    value ? [...ids, columnId] : ids.filter((id) => id !== columnId),
  );
}

/**
 * The desktop column a task's card shows in, when it is one that folds: an active status's
 * column on a project board, the category's on the workspace board.
 */
export function foldingColumnOf(project: Project, task: Task) {
  const status = statusById(project, task.statusId);
  if (!status) return null;
  if (project.members !== undefined) return categoryTarget(status.category);
  return status.category === 'active' ? status.id : null;
}

/**
 * Opens the folded column a card is in, so what takes the person to the card (a task opened
 * from search or a link, a card carried from the keyboard) finds it there, as Catch's deck
 * opens a column a keyboard selection lands in. Only a desktop draws the strips.
 */
function expandColumnOf(state: BoardState, taskId: string) {
  if (!isDesktop()) return;
  const { project, tasks } = current(state);
  const task = tasks.find((item) => item.id === taskId);
  if (!task || (task.parentId !== null && !state.subtasksAsCards)) return;
  const column = foldingColumnOf(project, task);
  if (column) setCollapsed(project, column, false);
}

/** A side zone is a strip, a single column, or a gallery across the whole board. */
export type ZoneState = 'strip' | 'panel' | 'full';

/**
 * How wide each desktop rail is open as a panel, when its edge has been dragged; null is the
 * single column. Kept on the device, as the task pane's split is in Catch.
 */
const railWidthsSchema = z.object({
  backlog: z.number().positive().nullable().default(null),
  closed: z.number().positive().nullable().default(null),
});
export type RailWidths = z.infer<typeof railWidthsSchema>;
const RAIL_WIDTHS_KEY = 'throw-board-rail-widths';

export function useRailWidths() {
  return usePersistentState(RAIL_WIDTHS_KEY, railWidthsSchema, railWidthsSchema.parse({}));
}

export function setRailWidth(zone: keyof RailWidths, width: number | null) {
  const widths = readPreference(RAIL_WIDTHS_KEY, railWidthsSchema, railWidthsSchema.parse({}));
  const value = width === null ? null : Math.round(width);
  if (widths[zone] !== value) writePreference(RAIL_WIDTHS_KEY, { ...widths, [zone]: value });
}

/**
 * A rail whose edge is held, and the width it is dragged to. The board lays out around it
 * from this, without springs, until it is let go.
 */
export const railResize = createStore<{ zone: keyof RailWidths; width: number } | null>(null);

/**
 * How wide the desktop task split pane is, without its grip and margin. Kept on the device
 * and shared across project boards and the cross-project board.
 */
export const DEFAULT_TASK_PANE_WIDTH = 440;
const taskPaneWidthSchema = z.number().finite().positive();
const TASK_PANE_WIDTH_KEY = 'throw-task-pane-width';

export function useTaskPaneWidth() {
  return usePersistentState(TASK_PANE_WIDTH_KEY, taskPaneWidthSchema, DEFAULT_TASK_PANE_WIDTH);
}

export function setTaskPaneWidth(width: number) {
  if (!Number.isFinite(width) || width <= 0) return;
  const value = Math.round(width);
  if (readPreference(TASK_PANE_WIDTH_KEY, taskPaneWidthSchema, DEFAULT_TASK_PANE_WIDTH) !== value)
    writePreference(TASK_PANE_WIDTH_KEY, value);
}

/**
 * Clamps a task pane width to the frame's limits without altering the stored preference.
 * Before the frame has been measured (`frameWidth <= 0`), only the minimum applies.
 */
export function clampTaskPaneWidth(width: number, frameWidth: number, min: number) {
  if (frameWidth <= 0) return Math.max(min, width);
  const max = Math.max(min, frameWidth * 0.62);
  return Math.min(max, Math.max(min, width));
}

/**
 * The task pane's width while its split handle is held, or null at rest. Kept in a store so
 * the board beside it tracks the drag without writing to storage on every frame.
 */
export const taskPaneResize = createStore<number | null>(null);

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
  /** Search and filters narrowing the cards shown; view state, never kept. */
  filter: BoardFilter;
  /** The columns' order: the board's own, or the temporary size sort. */
  sort: BoardSort;
  /** The desktop search bar is open over the board. */
  searching: boolean;
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
    subtasksAsCards: storedBoardSettings().subtasksAsCards,
    selection: [],
    openTaskId: null,
    taskTrail: [],
    expanded: [],
    carrying: null,
    announcement: '',
    newTaskId: null,
    filter: EMPTY_FILTER,
    sort: 'priority',
    searching: false,
  };
}

export const board = createStore<BoardState>(initialBoard());

export function update(
  change: Partial<BoardState> | ((state: BoardState) => Partial<BoardState>),
  origin?: HTMLElement | null,
) {
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
  if (moving && next.openTaskId && !isDesktop() && !state.taskTrail.includes(next.openTaskId))
    rememberTaskOrigin(next.openTaskId, origin);
  // Opening a task any other way starts a new trail.
  board.set({ ...state, ...(moving && !('taskTrail' in next) ? { taskTrail: [] } : {}), ...next });
  if (moving && next.openTaskId) expandColumnOf(board.get(), next.openTaskId);
  // A new subtask left as it was made was never wanted: it goes rather than stay untitled.
  if (moving && fresh !== null && fresh === state.openTaskId) {
    fresh = null;
    state.actions?.discard?.(state.openTaskId);
  }
}

/**
 * A subtask or related task opened from a pane goes back to that pane when left. Following a
 * relation back to a task already earlier in the trail unwinds to it instead of stacking a
 * duplicate screen key.
 */
export function openSubtask(taskId: string, origin?: HTMLElement | null) {
  update((state) => {
    if (state.openTaskId === taskId) return {};
    const at = state.taskTrail.indexOf(taskId);
    if (at >= 0) return { openTaskId: taskId, taskTrail: state.taskTrail.slice(0, at) };
    return {
      openTaskId: taskId,
      taskTrail: state.openTaskId ? [...state.taskTrail, state.openTaskId] : [],
    };
  }, origin);
}

/** A subtask just added from its parent's pane, until the board has its row to open. */
let added: { taskId: string; parentId: string } | null = null;
/** That subtask while it is open: left untouched, it is discarded. */
let fresh: string | null = null;

/**
 * Opens a subtask just added from its parent's pane as a new task, as the board opens one: in
 * the full task view with its title selected to be written, and on the parent's trail so
 * leaving it goes back to the parent. The board may receive the row a render later.
 */
export function openNewSubtask(taskId: string, parentId: string) {
  added = { taskId, parentId };
  openAddedSubtask();
}

function openAddedSubtask() {
  if (!added || !canOpenTask(added.taskId)) return;
  const { taskId, parentId } = added;
  added = null;
  // Left meanwhile, the parent no longer asks for it.
  if (board.get().openTaskId !== parentId) return;
  update((state) => ({
    openTaskId: taskId,
    newTaskId: taskId,
    taskTrail: [...state.taskTrail, parentId],
  }));
  if (board.get().openTaskId === taskId) fresh = taskId;
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
  /** Removes a task just made if it was left as it was made. */
  discard?(taskId: string): void;
  /** The new task's id. The workspace board has none: it captures through the palette. */
  create?(statusId?: string): string;
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
    added = null;
    fresh = null;
    board.set({ ...initialBoard([data]), actions, awaitingTasks });
  } else {
    const exists = (id: string) => data.tasks.some((task) => task.id === id);
    const canOpen = (id: string) => canOpenTask(id, data);
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
    openAddedSubtask();
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

/** A task opens when the board shows it, or keeps it (trashed) for restoring. */
export function canOpenTask(id: string, data: BoardData = shown(board.get())) {
  return (
    data.tasks.some((task) => task.id === id) ||
    (data.hiddenTasks?.some((task) => task.id === id) ?? false)
  );
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
    filter: EMPTY_FILTER,
    sort: 'priority',
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
export type ListId = 'backlog' | 'closed' | `status:${string}` | `category:${Category}`;

export function listStatusId(listId: ListId) {
  return listId.startsWith('status:') ? listId.slice('status:'.length) : undefined;
}

/** Within a priority, closed work reads newest first; the workspace board bands it so. */
function compareBanded(a: Task, b: Task) {
  return a.priority - b.priority || compareClosed(a, b);
}

function statusIdsIn(project: Project, categories: Category[], filter: string | null) {
  return project.statuses
    .filter((status) => categories.includes(status.category))
    .filter((status) => filter === null || status.id === filter)
    .map((status) => status.id);
}

/** The tasks the filter leaves on the board, or null when it shows them all. */
export function visibleIds(state: BoardState) {
  return matchingIds(current(state), state.filter, state.subtasksAsCards);
}

/**
 * The board is sorted by size or time: within a column, cards keep no manual order, so they
 * are sent rather than placed (ADR 0008).
 */
export function sortedByField(state: BoardState) {
  return state.sort !== 'priority';
}

/**
 * A list's cards in the bands a column draws: one per priority with cards in it, or a single
 * unlabelled run (`priority: null`) while the board is sorted by a field.
 */
export function bandsOf(
  state: BoardState,
  tasks: Task[],
): { priority: Priority | null; tasks: Task[] }[] {
  if (sortedByField(state)) return tasks.length > 0 ? [{ priority: null, tasks }] : [];
  return groupByPriority(tasks).filter((band) => band.tasks.length > 0);
}

/** The cards a list shows, in order. */
export function listTasks(state: BoardState, listId: ListId): Task[] {
  const { project, tasks } = current(state);
  const category = targetCategory(listId);
  const statusIds =
    listId === 'backlog'
      ? statusIdsIn(project, ['backlog'], state.backlogFilter)
      : listId === 'closed'
        ? statusIdsIn(project, ['done', 'cancelled'], state.closedFilter)
        : category
          ? statusIdsIn(project, [category], null)
          : [listStatusId(listId)];
  const visible = visibleIds(state);
  const order = sortOrder(state.sort);
  const banded = category !== null && isClosed(category);
  // The closed zone reads by when work was closed, whatever the columns are sorted by.
  const compare =
    listId === 'closed'
      ? compareClosed
      : order
        ? (a: Task, b: Task) =>
            compareByField(order.field, order.direction)(
              a,
              b,
              banded ? compareBanded : compareTasks,
            )
        : banded
          ? compareBanded
          : compareTasks;
  return tasks
    .filter((task) => statusIds.includes(task.statusId))
    .filter((task) => state.subtasksAsCards || task.parentId === null)
    .filter((task) => visible === null || visible.has(task.id))
    .sort(compare);
}

/**
 * Every card the board shows, column by column in its order: what a phone's search lists
 * while filters narrow the board and no words are typed. The backlog's and closed zone's own
 * status choices are left out, as they only scope what those zones draw.
 */
export function shownTasks(state: BoardState): Task[] {
  const { project } = current(state);
  const lists: ListId[] = project.members
    ? CATEGORIES.map((category) => categoryTarget(category))
    : project.statuses.map((status) => `status:${status.id}` as const);
  return lists.flatMap((list) => listTasks(state, list));
}

/** The cards in a status, or in every status of a category target, as the filter leaves them. */
export function countIn(state: BoardState, statusId: string) {
  const category = targetCategory(statusId);
  if (category) return listTasks(state, `category:${category}`).length;
  const visible = visibleIds(state);
  return current(state).tasks.filter(
    (task) =>
      task.statusId === statusId &&
      (state.subtasksAsCards || task.parentId === null) &&
      (visible === null || visible.has(task.id)),
  ).length;
}

/** Narrows the board. Choosing tags or Untagged takes the other away, as in Catch. */
export function setFilter(change: Partial<BoardFilter>) {
  update((state) => ({ filter: { ...state.filter, ...change } }));
}

export function setSort(sort: BoardSort) {
  update({ sort });
}

/** Shows every card again in the board's own order. */
export function clearFilters() {
  update({ filter: EMPTY_FILTER, sort: 'priority' });
}

/** Search or a filter narrows the board, or a sort reorders it. */
export function narrowed(state: BoardState) {
  return isFiltering(state.filter) || state.sort !== 'priority';
}

/** Opens the desktop search bar over the board and puts the caret in it. */
export function openSearch() {
  if (!board.get().searching) update({ searching: true });
  focusSearch();
}

export function focusSearch() {
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLInputElement>('[data-board-search-input]');
    input?.focus({ preventScroll: true });
    input?.select();
  });
}

/** Closes the bar, and with it the search, its filters and the sort. */
export function closeSearch() {
  update({ searching: false, filter: EMPTY_FILTER, sort: 'priority' });
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
  // Sorted by a field, the cards beside a place are not its neighbours in manual order, and a
  // position between them could fall anywhere, or be no position at all (ADR 0008).
  if (sortedByField(state)) return null;
  // A carried card is placed as it was picked up, so carrying it back to where it started
  // finds its own position again rather than a new one beside it.
  const task =
    state.carrying?.taskId === taskId
      ? state.carrying.seen
      : current(state).tasks.find((item) => item.id === taskId);
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
  // A subtask's position orders it among its parent's subtasks; a column does not change it.
  const to = task.parentId === null ? place : { ...place, position: task.position };
  const { statusId, priority, position } = task;
  if (to.statusId === statusId && to.priority === priority && to.position === position) return;
  setTasks(tasks.map((item) => (item.id === taskId ? moveTo(project, item, to) : item)));
  if (board.get().actions?.place(taskId, to) === false) revert();
}

export function sendTasks(taskIds: string[], target: string) {
  const { project } = current();
  let tasks = syncedTasks();
  const sends = resolveSend(project, tasks, taskIds, target).flatMap(({ statusId, taskIds }) => {
    // A card already in the status stays where it is.
    const moving = taskIds.filter(
      (id) => tasks.find((task) => task.id === id)?.statusId !== statusId,
    );
    if (moving.length === 0) return [];
    tasks = sendToStatus(project, tasks, moving, statusId);
    return [{ statusId, moving }];
  });
  if (sends.length === 0) return;
  setTasks(tasks);
  const actions = board.get().actions;
  if (actions && !sends.every(({ statusId, moving }) => actions.send(moving, statusId))) revert();
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
    if (!actions.create) return;
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
    size: null,
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
  const carried = board.get().carrying?.taskId;
  if (carried) expandColumnOf(board.get(), carried);
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
