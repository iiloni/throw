import { createStore } from '@/lib/store';

export type TaskRect = { x: number; y: number; width: number; height: number; radius: number };
const origins = new Map<string, TaskRect>();
const hidden = createStore<ReadonlySet<string>>(new Set());

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
}

export function useTaskCardHidden(taskId: string) {
  return hidden.use().has(taskId);
}
