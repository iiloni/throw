import {
  isTaskTrashed,
  type Project as ProjectRow,
  type TaskRelation,
  type Task as TaskRow,
} from '@throw/shared';
import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import { isDesktop } from '@/lib/media';
import { createStore } from '@/lib/store';
import { drag, LONG_PRESS_MS } from './drag';
import { type BoardRelations, type Category, type Project, targetCategory } from './model';
import { board } from './state';

/** An open, untrashed task blocking another task, as the board needs it. */
export type TaskBlocker = {
  id: string;
  /** The blocker's identifier (e.g. `APP-2`), or `'a pending task'` before sync assigns a number. */
  identifier: string;
  projectId: string;
  projectName: string | null;
  statusId: string;
  category: Category;
  parentId: string | null;
  /** When the blocker is a subtask, its parent's status and category (where its card sits tucked). */
  parentStatusId: string | null;
  parentCategory: Category | null;
};

/**
 * The open tasks blocking each blocked task, as the real boards supply them from synced
 * relations. The prototype has none, so its cards are never blocked.
 */
export const TaskBlockersContext = createContext<ReadonlyMap<
  string,
  readonly TaskBlocker[]
> | null>(null);

const none: readonly TaskBlocker[] = [];

export function useTaskBlockers(taskId: string) {
  return useContext(TaskBlockersContext)?.get(taskId) ?? none;
}

/**
 * The relations a board's filter chooses by, from the same open blockers the cards' badges
 * read (`blockersByTask`), so Blocked finds exactly the cards that show the badge:
 *
 * - blocked: a task with an open blocker (the filter, as the card, leaves out closed tasks);
 * - blocking: an open blocker of a task that is open and not in the trash itself;
 * - duplicates: either end of a duplicate link whose other task the device holds and is not
 *   in the trash. A closed duplicate still counts, since closing one is how a duplicate is
 *   usually settled; the task view lists it too.
 *
 * Tasks of any project count, so a blocker on another project's board still marks this one.
 */
export function boardRelations(
  blockers: ReadonlyMap<string, readonly Pick<TaskBlocker, 'id'>[]>,
  relations: readonly Pick<TaskRelation, 'sourceTaskId' | 'targetTaskId' | 'kind'>[],
  tasks: readonly TaskRow[],
  projects: readonly ProjectRow[],
): BoardRelations {
  const taskById = new Map(tasks.map((row) => [row.id, row]));
  const projectById = new Map(projects.map((row) => [row.id, row]));
  const live = (id: string) => {
    const task = taskById.get(id);
    return task !== undefined &&
      !isTaskTrashed(task, taskById.get(task.parentId ?? ''), projectById.get(task.projectId))
      ? task
      : undefined;
  };
  const blocked = new Set<string>();
  const blocking = new Set<string>();
  for (const [taskId, open] of blockers) {
    if (open.length === 0) continue;
    blocked.add(taskId);
    const task = live(taskId);
    if (!task || task.closedAt !== null) continue;
    for (const blocker of open) blocking.add(blocker.id);
  }
  const duplicates = new Set<string>();
  for (const relation of relations) {
    if (relation.kind !== 'duplicates') continue;
    if (live(relation.targetTaskId)) duplicates.add(relation.sourceTaskId);
    if (live(relation.sourceTaskId)) duplicates.add(relation.targetTaskId);
  }
  return { blocked, blocking, duplicates };
}

const blockerIdentifier = (blocker: string | Pick<TaskBlocker, 'identifier'>) =>
  typeof blocker === 'string' ? blocker : blocker.identifier;

/** What a blocked card says: the blocker's identifier, or how many there are. */
export function blockedLabel(blockers: readonly (string | Pick<TaskBlocker, 'identifier'>)[]) {
  return blockers.length === 1
    ? `Blocked by ${blockerIdentifier(blockers[0]!)}`
    : `Blocked by ${blockers.length} tasks`;
}

/**
 * The tooltip shown on a card's blocked badge. On a single-project board it names any other
 * project holding a blocker so lingering over a card with off-board blockers explains itself.
 */
export function blockedHint(blockers: readonly TaskBlocker[], project: Project) {
  const base = blockedLabel(blockers);
  // The cross-project board gathers every project of the workspace, so every blocker belongs here.
  if (project.members !== undefined || blockers.length === 0) return base;
  const external = blockers.filter((blocker) => blocker.projectId !== project.id);
  if (external.length === 0) return base;
  const externalProjects = new Set(
    external.map((blocker) => blocker.projectName).filter((name): name is string => Boolean(name)),
  );
  const singleExternalProject =
    externalProjects.size === 1 && external.every((blocker) => blocker.projectName !== null)
      ? [...externalProjects][0]!
      : null;
  if (blockers.length === 1) {
    return `${base} · ${singleExternalProject ?? 'another project'}`;
  }
  if (external.length === blockers.length) {
    return `${base} · ${singleExternalProject ?? 'other projects'}`;
  }
  if (singleExternalProject) {
    return `${base} · ${external.length} in ${singleExternalProject}`;
  }
  return `${base} · ${external.length} in ${external.length === 1 ? 'another project' : 'other projects'}`;
}

/**
 * How long the pointer must linger on a card's blocked badge before spotlighting its blockers
 * across the board: long enough that a pointer passing over the icon does not flash the board,
 * and just after the badge's tooltip (the shell's 300 ms hint delay), so the two arrive as one
 * response to a pause rather than as separate waits.
 */
export const SPOTLIGHT_DWELL_MS = 400;

/**
 * How long a finger rests on the blocked badge before its blockers light up: the board's own
 * long press, so holding the badge feels like holding a card. A tap opens the card as before,
 * and a finger that sets off scrolling leaves the board as it was.
 */
export const SPOTLIGHT_HOLD_MS = LONG_PRESS_MS;

export type BlockerSpotlight = {
  /** The blocked task whose badge is being lingered on. */
  blockedTaskId: string;
  /** The open blockers of that task. */
  blockers: readonly TaskBlocker[];
  blockerIds: ReadonlySet<string>;
  /** Parents of subtask blockers, highlighted when subtasks stay tucked under their parent card. */
  blockerParentIds: ReadonlySet<string>;
};

export type CardSpotlightRole = 'none' | 'blocked' | 'blocker' | 'parent' | 'dimmed';

export const blockerSpotlight = createStore<BlockerSpotlight | null>(null);

function makeSpotlight(blockedTaskId: string, blockers: readonly TaskBlocker[]): BlockerSpotlight {
  const blockerIds = new Set<string>();
  const blockerParentIds = new Set<string>();
  for (const blocker of blockers) {
    blockerIds.add(blocker.id);
    if (blocker.parentId) blockerParentIds.add(blocker.parentId);
  }
  return { blockedTaskId, blockers, blockerIds, blockerParentIds };
}

let pending: {
  taskId: string;
  blockers: readonly TaskBlocker[];
  timer: ReturnType<typeof setTimeout>;
} | null = null;
let stopWatching: (() => void) | null = null;

function stopWatchingCancellation() {
  if (!stopWatching) return;
  stopWatching();
  stopWatching = null;
}

function sameIds(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Watches for any interaction or board change that should end a pending or active spotlight.
 * Only attached while a dwell timer is pending or a spotlight is active, so resting boards
 * pay zero overhead.
 */
function watchCancellation() {
  if (stopWatching) return;
  let last = board.get();
  const unsubDrag = drag.subscribe(() => {
    if (drag.get() !== null) cancelBlockerSpotlight();
  });
  const unsubBoard = board.subscribe(() => {
    const next = board.get();
    const changed =
      next.projectId !== last.projectId ||
      next.openTaskId !== last.openTaskId ||
      next.carrying !== last.carrying ||
      !sameIds(next.selection, last.selection) ||
      next.filter !== last.filter ||
      next.sort !== last.sort ||
      next.backlog !== last.backlog ||
      next.closed !== last.closed;
    last = next;
    if (changed) cancelBlockerSpotlight();
  });
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    if (blockerSpotlight.get() !== null) {
      event.preventDefault();
      event.stopPropagation();
    }
    cancelBlockerSpotlight();
  };
  const onPointerDown = () => cancelBlockerSpotlight();
  const onBlur = () => cancelBlockerSpotlight();
  const onVisibilityChange = () => {
    if (document.hidden) cancelBlockerSpotlight();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', onBlur);
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  stopWatching = () => {
    unsubDrag();
    unsubBoard();
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', onBlur);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };
}

/**
 * Start the dwell timer for a blocked task's badge on desktop: a lingering mouse by default, or
 * a held finger with `SPOTLIGHT_HOLD_MS`. `onShow` runs if the spotlight comes on.
 */
export function armBlockerSpotlight(
  taskId: string,
  blockers: readonly TaskBlocker[],
  delay = SPOTLIGHT_DWELL_MS,
  onShow?: () => void,
) {
  if (!isDesktop() || blockers.length === 0 || drag.get() !== null) {
    cancelBlockerSpotlight();
    return;
  }
  if (blockerSpotlight.get()?.blockedTaskId === taskId) {
    syncBlockerSpotlight(taskId, blockers);
    return;
  }
  if (pending?.taskId === taskId) {
    pending.blockers = blockers;
    return;
  }
  if (pending) {
    clearTimeout(pending.timer);
    pending = null;
  }
  if (blockerSpotlight.get() !== null) blockerSpotlight.set(null);
  watchCancellation();
  const timer = setTimeout(() => {
    if (pending?.taskId !== taskId) return;
    const latest = pending.blockers;
    pending = null;
    if (!isDesktop() || drag.get() !== null || latest.length === 0) {
      stopWatchingCancellation();
      return;
    }
    blockerSpotlight.set(makeSpotlight(taskId, latest));
    onShow?.();
  }, delay);
  pending = { taskId, blockers, timer };
}

let swallowClick = false;

/**
 * Ends a finger's hold on `taskId`'s badge: hides the spotlight and, if it was showing, keeps
 * the click the lift sends from reaching the card, which it is not a tap on.
 */
export function releaseBlockerHold(taskId: string) {
  if (blockerSpotlightShown(taskId)) {
    swallowClick = true;
    setTimeout(() => {
      swallowClick = false;
    }, 80);
  }
  cancelBlockerSpotlight(taskId);
}

/** True once after a hold that showed the spotlight, for the click its lift sends. */
export function consumeBlockerHoldClick() {
  const value = swallowClick;
  swallowClick = false;
  return value;
}

/** Whether the spotlight is on for `taskId`'s blockers. */
export function blockerSpotlightShown(taskId: string) {
  return blockerSpotlight.get()?.blockedTaskId === taskId;
}

/** Keeps an active or pending spotlight in sync when synced relations or statuses change. */
export function syncBlockerSpotlight(taskId: string, blockers: readonly TaskBlocker[]) {
  if (blockers.length === 0) {
    cancelBlockerSpotlight(taskId);
    return;
  }
  if (pending?.taskId === taskId) {
    pending.blockers = blockers;
  }
  const active = blockerSpotlight.get();
  if (active?.blockedTaskId === taskId && active.blockers !== blockers) {
    blockerSpotlight.set(makeSpotlight(taskId, blockers));
  }
}

/** Cancel any pending dwell timer and clear the active spotlight (optionally only for `taskId`). */
export function cancelBlockerSpotlight(taskId?: string) {
  if (pending && (taskId === undefined || pending.taskId === taskId)) {
    clearTimeout(pending.timer);
    pending = null;
  }
  const active = blockerSpotlight.get();
  if (active && (taskId === undefined || active.blockedTaskId === taskId)) {
    blockerSpotlight.set(null);
  }
  if (pending === null && blockerSpotlight.get() === null) {
    stopWatchingCancellation();
  }
}

function blockerLocation(blocker: TaskBlocker, subtasksAsCards: boolean) {
  if (!subtasksAsCards && blocker.parentId && blocker.parentStatusId && blocker.parentCategory) {
    return {
      cardId: blocker.parentId,
      statusId: blocker.parentStatusId,
      category: blocker.parentCategory,
    };
  }
  return {
    cardId: blocker.id,
    statusId: blocker.statusId,
    category: blocker.category,
  };
}

function blockerOnBoard(blocker: TaskBlocker, project: Project) {
  return project.members
    ? project.members.some((member) => member.id === blocker.projectId)
    : blocker.projectId === project.id;
}

/** Whether the active spotlight has a visible blocker inside a collapsed column strip. */
export function blockerMatchesColumn(
  spotlight: BlockerSpotlight | null,
  columnId: string,
  project: Project | null,
  subtasksAsCards: boolean,
  visible: ReadonlySet<string> | null,
) {
  if (!spotlight || !project) return false;
  const category = targetCategory(columnId);
  return spotlight.blockers.some((blocker) => {
    if (!blockerOnBoard(blocker, project)) return false;
    const place = blockerLocation(blocker, subtasksAsCards);
    if (visible && !visible.has(place.cardId)) return false;
    return category ? place.category === category : place.statusId === columnId;
  });
}

/** Whether the active spotlight has a visible blocker inside the project board's Backlog rail. */
export function blockerMatchesBacklog(
  spotlight: BlockerSpotlight | null,
  project: Project,
  subtasksAsCards: boolean,
  visible: ReadonlySet<string> | null,
) {
  if (!spotlight || project.members !== undefined) return false;
  return spotlight.blockers.some((blocker) => {
    if (blocker.projectId !== project.id) return false;
    const place = blockerLocation(blocker, subtasksAsCards);
    if (visible && !visible.has(place.cardId)) return false;
    return place.category === 'backlog';
  });
}

/** Whether the active spotlight has a visible blocker in one specific status (e.g. a hidden Backlog filter). */
export function blockerMatchesStatus(
  spotlight: BlockerSpotlight | null,
  statusId: string,
  project: Project,
  subtasksAsCards: boolean,
  visible: ReadonlySet<string> | null,
) {
  if (!spotlight) return false;
  return spotlight.blockers.some((blocker) => {
    if (!blockerOnBoard(blocker, project)) return false;
    const place = blockerLocation(blocker, subtasksAsCards);
    if (visible && !visible.has(place.cardId)) return false;
    return place.statusId === statusId;
  });
}

/** One card's spotlight role: subscribes narrowly so resting boards never re-render. */
export function useCardSpotlightRole(
  taskId: string,
  subtasksAsCards: boolean,
  enabled: boolean,
): CardSpotlightRole {
  return useSyncExternalStore(blockerSpotlight.subscribe, () => {
    if (!enabled) return 'none';
    const active = blockerSpotlight.get();
    if (!active) return 'none';
    const tuckedBlockerChild = !subtasksAsCards && active.blockerParentIds.has(taskId);
    if (active.blockerIds.has(taskId)) return 'blocker';
    // When a task's tucked subtask is the blocker (including a task blocked by its own subtask),
    // keep the parent card undimmed without bordering it; the subtask underlay carries the highlight.
    if (tuckedBlockerChild) return 'parent';
    if (active.blockedTaskId === taskId) return 'blocked';
    return 'dimmed';
  });
}

/** True while any tucked subtask of `parentId` is a blocker in the active spotlight. */
export function useParentHasSpotlightBlocker(parentId: string, enabled: boolean) {
  return useSyncExternalStore(
    blockerSpotlight.subscribe,
    () => enabled && (blockerSpotlight.get()?.blockerParentIds.has(parentId) ?? false),
  );
}

/** True while `taskId` is the hovered blocked card currently driving the spotlight. */
export function useSpotlightActiveFor(taskId: string, enabled: boolean) {
  return useSyncExternalStore(
    blockerSpotlight.subscribe,
    () => enabled && blockerSpotlight.get()?.blockedTaskId === taskId,
  );
}

/** True while `taskId` is one of the active spotlight's blocking tasks (used by tucked subtask rows). */
export function useIsBlockerSpotlightTarget(taskId: string) {
  return useSyncExternalStore(
    blockerSpotlight.subscribe,
    () => blockerSpotlight.get()?.blockerIds.has(taskId) ?? false,
  );
}

/** True when a collapsed column strip contains at least one blocker of the active spotlight. */
export function useColumnSpotlightBlocker(
  columnId: string,
  project: Project | null,
  subtasksAsCards: boolean,
  visible: ReadonlySet<string> | null,
  enabled: boolean,
) {
  return useSyncExternalStore(
    blockerSpotlight.subscribe,
    () =>
      enabled &&
      blockerMatchesColumn(blockerSpotlight.get(), columnId, project, subtasksAsCards, visible),
  );
}

/** True when the collapsed Backlog rail contains at least one blocker of the active spotlight. */
export function useBacklogSpotlightBlocker(
  project: Project,
  subtasksAsCards: boolean,
  visible: ReadonlySet<string> | null,
  enabled: boolean,
) {
  return useSyncExternalStore(
    blockerSpotlight.subscribe,
    () =>
      enabled && blockerMatchesBacklog(blockerSpotlight.get(), project, subtasksAsCards, visible),
  );
}

/** True when a status filter chip hides a blocker of the active spotlight. */
export function useStatusSpotlightBlocker(
  statusId: string,
  project: Project,
  subtasksAsCards: boolean,
  visible: ReadonlySet<string> | null,
  enabled: boolean,
) {
  return useSyncExternalStore(
    blockerSpotlight.subscribe,
    () =>
      enabled &&
      blockerMatchesStatus(blockerSpotlight.get(), statusId, project, subtasksAsCards, visible),
  );
}

/** Clears any active or pending spotlight when the desktop board unmounts. */
export function useSpotlightCleanup() {
  useEffect(() => () => cancelBlockerSpotlight(), []);
}
