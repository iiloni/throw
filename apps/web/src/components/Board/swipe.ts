import { animate, motionValue } from 'motion/react';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { createStore } from '@/lib/store';
import { categoryTarget, defaultStatus } from './model';
import { board, current, sendTasks } from './state';

/**
 * Swiping a card on a phone's board to the right closes it into the project's done status
 * (owner decision, 2026-10-19). Only rightwards, towards the done pocket: a swipe to the left
 * still turns to the next column, and the pager takes any swipe that starts outside a card.
 * Cards there carry `touch-action: pan-y pan-right` (styles.css), so the browser hands this a
 * finger moving right and keeps scrolling for the rest.
 */
export const swipe = createStore<{ taskId: string; armed: boolean } | null>(null);

/** How far the card has followed the finger. */
export const swipeX = motionValue(0);

let width = 0;
let samples: { x: number; t: number }[] = [];

/** How far a card has to travel before letting go closes it. */
const threshold = () => Math.min(140, width * 0.38);
/** A flick closes a card that has not reached the threshold yet. */
const FLICK = 0.6;
const FLICK_MIN = 56;

/** Whether a touch that started on this card can swipe it closed. */
export function canSwipe(element: HTMLElement) {
  const list = element.closest<HTMLElement>('[data-drop-list]')?.dataset.dropList;
  const pager = element.closest('[data-pager]');
  const open = list?.startsWith('status:') || element.closest('[data-swipe-close]') !== null;
  return Boolean(pager && open && board.get().selection.length === 0 && doneStatus());
}

/** On the workspace board, each card closes into its own project's default done status. */
export function doneStatus() {
  const { project } = current();
  if (project.members) return { id: categoryTarget('done'), name: 'Done' };
  return defaultStatus(project, 'done');
}

export function beginSwipe(taskId: string, element: HTMLElement, x: number) {
  width = element.getBoundingClientRect().width;
  samples = [{ x, t: performance.now() }];
  swipeX.jump(0);
  swipe.set({ taskId, armed: false });
}

export function moveSwipe(dx: number, x: number) {
  const state = swipe.get();
  if (!state) return;
  samples = [...samples, { x, t: performance.now() }].slice(-5);
  swipeX.set(Math.max(0, dx));
  const armed = dx >= threshold();
  if (armed !== state.armed) {
    if (armed) haptics.threshold();
    swipe.set({ ...state, armed });
  }
}

function velocity() {
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || !last || last.t === first.t) return 0;
  return (last.x - first.x) / (last.t - first.t);
}

export function endSwipe() {
  const state = swipe.get();
  if (!state) return;
  const dx = swipeX.get();
  const done = doneStatus();
  if (done && (state.armed || (dx > FLICK_MIN && velocity() > FLICK))) {
    haptics.success();
    const close = () => {
      settling = null;
      sendTasks([state.taskId], done.id);
      swipe.set(null);
      swipeX.jump(0);
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) close();
    else {
      settling = close;
      void animate(swipeX, width + 32, { ...springs.snappy, onComplete: close });
    }
  } else cancelSwipe();
}

/** What finishes the swipe that is still springing home or away, if one is. */
let settling: (() => void) | null = null;

export function cancelSwipe() {
  if (!swipe.get()) return;
  const done = () => {
    settling = null;
    swipe.set(null);
    swipeX.jump(0);
  };
  settling = done;
  void animate(swipeX, 0, { ...springs.snappy, onComplete: done });
}

/** Lands a swipe that is still settling at once, so a new touch starts from rest. */
export function settleSwipe() {
  const finish = settling;
  if (!finish) return;
  swipeX.stop();
  finish();
}
