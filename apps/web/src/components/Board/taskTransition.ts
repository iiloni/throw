import { drawerTravel } from '@/components/Drawer/travel';
import { createStore } from '@/lib/store';

export type TaskRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  /** Whether the card shows its status, so the face that flies to it matches. */
  showStatus: boolean;
  /** Whether that status is a control (a subtask's, in its parent), shaped as a button is. */
  statusControl: boolean;
  /**
   * A row that stands for the task without being its card, such as a related task in the pane:
   * the screen dissolves out of and back into it rather than wearing a card's face.
   */
  row: boolean;
  /** The exact DOM node the task grew out of, so closing lands back in it when several exist. */
  element: HTMLElement;
};
const origins = new Map<string, TaskRect>();
const hidden = createStore<ReadonlySet<string>>(new Set());
// Hidden cards whose task is about to land back in them.
const landing = createStore<ReadonlySet<string>>(new Set());
// Task surfaces on screen, counting one still closing after its task has left the board.
const surfaces = createStore(0);

/** Whether an origin card or row is mounted and at least partly inside the viewport. */
export function isVisibleOrigin(card: HTMLElement): boolean {
  if (!card.isConnected) return false;
  const box = card.getBoundingClientRect();
  const top = box.top + drawerTravel(card);
  return !(
    !box.width ||
    !box.height ||
    top + box.height <= 0 ||
    top >= innerHeight ||
    box.right <= 0 ||
    box.left >= innerWidth
  );
}

/**
 * The card a task leaves from or lands in. Prefer a subtask card or a relation row
 * (`data-task-origin`) in the open pane over a second copy on the board behind it. A card in a
 * drawer that is still rising counts where the drawer will rest, so a task closing into the
 * reopening backlog finds its card.
 */
export function findTaskCard(
  taskId: string,
  kind: 'any' | 'card' | 'row' = 'any',
): HTMLElement | null {
  const selector =
    kind === 'card'
      ? '[data-card-id]:not([data-overlay])'
      : kind === 'row'
        ? '[data-task-origin]'
        : '[data-card-id]:not([data-overlay]), [data-task-origin]';
  const cards = document.querySelectorAll<HTMLElement>(selector);
  for (const card of Array.from(cards).reverse()) {
    if ((card.dataset.cardId ?? card.dataset.taskOrigin) !== taskId) continue;
    if (!isVisibleOrigin(card)) continue;
    return card;
  }
  return null;
}

/** Where a card is on screen now. */
export function taskCardRect(card: HTMLElement): TaskRect {
  const box = card.getBoundingClientRect();
  return {
    x: box.left,
    y: box.top,
    width: box.width,
    height: box.height,
    radius: Number.parseFloat(getComputedStyle(card).borderTopLeftRadius) || 16,
    showStatus: card.dataset.showStatus !== undefined,
    statusControl: card.dataset.statusControl !== undefined,
    row: card.dataset.taskOrigin !== undefined,
    element: card,
  };
}

export function measureTaskCard(taskId: string): TaskRect | null {
  const card = findTaskCard(taskId);
  return card && taskCardRect(card);
}

export function rememberTaskOrigin(taskId: string, element?: HTMLElement | null) {
  const target = element && isVisibleOrigin(element) ? element : findTaskCard(taskId);
  const rect = target && taskCardRect(target);
  if (rect) origins.set(taskId, rect);
}

export function takeTaskOrigin(taskId: string) {
  const rect = origins.get(taskId) ?? null;
  origins.delete(taskId);
  return rect;
}

export function setTaskCardHidden(taskId: string, value: boolean) {
  const next = new Set(hidden.get());
  if (value) next.add(taskId);
  else next.delete(taskId);
  hidden.set(next);
  if (landing.get().has(taskId)) {
    const settled = new Set(landing.get());
    settled.delete(taskId);
    landing.set(settled);
  }
}

/**
 * As Catch's `landCard`: marks a hidden card as moments from being shown, so its subtask
 * underlay can slide out from behind it while the task settles into it.
 */
export function landTaskCard(taskId: string) {
  if (!hidden.get().has(taskId)) return;
  landing.set(new Set(landing.get()).add(taskId));
}

export function useTaskCardLanding(taskId: string) {
  return landing.use().has(taskId);
}

export function useTaskCardHidden(taskId: string) {
  return hidden.use().has(taskId);
}

/** Counts a task surface as on screen while it is mounted; returns the cleanup. */
export function showTaskSurface() {
  surfaces.set(surfaces.get() + 1);
  return () => surfaces.set(surfaces.get() - 1);
}

export function useTaskSurfaceShown() {
  return surfaces.use() > 0;
}
