import { createStore } from '@/lib/store';

export type TaskRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  /** Whether the card shows its status, so the face that flies to it matches. */
  showStatus: boolean;
};
const origins = new Map<string, TaskRect>();
const hidden = createStore<ReadonlySet<string>>(new Set());
// Hidden cards whose task is about to land back in them.
const landing = createStore<ReadonlySet<string>>(new Set());
// Task surfaces on screen, counting one still closing after its task has left the board.
const surfaces = createStore(0);

/** Prefer a subtask card in the open pane over a second copy on the board behind it. */
export function measureTaskCard(taskId: string): TaskRect | null {
  const cards = document.querySelectorAll<HTMLElement>('[data-card-id]:not([data-overlay])');
  for (const card of Array.from(cards).reverse()) {
    if (card.dataset.cardId !== taskId) continue;
    const box = card.getBoundingClientRect();
    if (
      !box.width ||
      !box.height ||
      box.bottom <= 0 ||
      box.top >= innerHeight ||
      box.right <= 0 ||
      box.left >= innerWidth
    )
      continue;
    return {
      x: box.left,
      y: box.top,
      width: box.width,
      height: box.height,
      radius: Number.parseFloat(getComputedStyle(card).borderTopLeftRadius) || 16,
      showStatus: card.dataset.showStatus !== undefined,
    };
  }
  return null;
}

export function rememberTaskOrigin(taskId: string) {
  const rect = measureTaskCard(taskId);
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
