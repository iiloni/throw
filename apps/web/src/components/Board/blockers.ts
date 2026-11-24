import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import { isDesktop } from '@/lib/media';
import { createStore } from '@/lib/store';
import { drag } from './drag';
import { type Category, type Project, targetCategory } from './model';
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
 * across the board: long enough that passing over the icon or reading its tooltip does not
 * flash the board, short enough to feel responsive once you pause.
 */
export const SPOTLIGHT_DWELL_MS = 1100;

export type BlockerSpotlight = {
  /** The blocked task whose badge is being lingered on. */
  blockedTaskId: string;
  /** The open blockers of that task. */
  blockers: readonly TaskBlocker[];
  blockerIds: ReadonlySet<string>;
  /** Parents of subtask blockers, highlighted when subtasks stay tucked under their parent card. */
  blockerParentIds: ReadonlySet<string>;
};

export type CardSpotlightRole = 'none' | 'blocked' | 'blocker' | 'dimmed';

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

/** Start the dwell timer for a blocked task's badge on desktop. */
export function armBlockerSpotlight(taskId: string, blockers: readonly TaskBlocker[]) {
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
  }, SPOTLIGHT_DWELL_MS);
  pending = { taskId, blockers, timer };
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
    if (active.blockedTaskId === taskId) return 'blocked';
    if (
      active.blockerIds.has(taskId) ||
      (!subtasksAsCards && active.blockerParentIds.has(taskId))
    ) {
      return 'blocker';
    }
    return 'dimmed';
  });
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
