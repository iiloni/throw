import { motionValue } from 'motion/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createStore } from '@/lib/store';
import type { Priority } from './model';
import {
  board,
  current,
  type ListId,
  listStatusId,
  placeInList,
  sendTasks,
  toggleSelected,
  update,
} from './state';

/**
 * The board's drag engine, on raw pointer events.
 *
 * A column changes shape under a held card (zones fold, rails appear, a gap opens), so
 * targets are read from the live DOM every frame instead of from rectangles measured when
 * the drag began. Elements opt in with data attributes:
 *
 * - `data-drop-list`: a column or gallery cards can be placed in. Inside it, `data-slot`
 *   wraps each card, `data-gap` marks where a card may land, `data-zone-header` starts a
 *   priority zone and `data-drop-rail` is a folded zone that takes the card when held over.
 * - `data-drop-status`: a tile that sends cards to a status without placing them.
 * - `data-drop-block`: a surface over the board (a drawer, the dock) that hides what is
 *   under it from the drag.
 * - `data-autoscroll`: a vertical scroller to nudge while a card is held near its edge.
 */

export type DropTarget =
  | { kind: 'place'; listId: ListId; priority: Priority; index: number }
  /** Several cards over a column: each keeps its priority. */
  | { kind: 'list'; listId: ListId }
  | { kind: 'status'; statusId: string };

export type DragState = {
  /** The held cards; the first is the one under the finger. */
  ids: string[];
  width: number;
  height: number;
  /** Where on the card it is held, from its top left corner. */
  grab: { x: number; y: number };
  /** The zone the card came from: `backlog`, `active` or `closed`. */
  origin: string | null;
  /** The priority the card would get: the zone that is open under it. */
  priority: Priority;
  target: DropTarget | null;
  /** A rail the card is being held over, before it takes the card. */
  rail: { listId: ListId; priority: Priority } | null;
  phase: 'dragging' | 'landing';
  /** Set when the card lands somewhere that shows no cards and shrinks into it. */
  swallowed: boolean;
  touch: boolean;
};

export const drag = createStore<DragState | null>(null);

/** Where the held card's copy is drawn. Written every frame, so not React state. */
export const overlayPosition = { x: motionValue(0), y: motionValue(0) };

type Config = { zoneModel: 'stretch' | 'inPlace' };
let config: Config = { zoneModel: 'stretch' };
export function configureDrag(next: Config) {
  config = next;
}

const LONG_PRESS_MS = 260;
const TOUCH_SLOP = 10;
const MOUSE_SLOP = 6;
const RAIL_DWELL_MS = 220;
/** How long a column takes to fold its zones into rails. */
const FOLD_MS = 300;
const EDGE = 64;
const PAGE_HOLD_MS = 480;
/** Space under each card, which a gap must also open. */
export const CARD_SPACING = 12;

type Press = { taskId: string; x: number; y: number; touch: boolean; element: HTMLElement };

let press: Press | null = null;
let longPress: number | undefined;
let pointer = { x: 0, y: 0 };
let grab = { x: 0, y: 0 };
let moved = false;
let frame: number | undefined;
let dwell: { key: string; since: number } | null = null;
let armed: string | null = null;
let folded: { listId: string; since: number } | null = null;
let pageHold: { side: -1 | 1; since: number } | null = null;
let suppressClick = false;

/** True once after a drag, for the click the browser sends when the pointer is released. */
export function consumeDragClick() {
  const value = suppressClick;
  suppressClick = false;
  return value;
}

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function tick(ms = 8) {
  if (drag.get()?.touch) navigator.vibrate?.(ms);
}

// A page starts scrolling under a finger unless the move is cancelled, and only a listener
// that was there before the touch began is allowed to cancel it.
if (typeof window !== 'undefined') {
  window.addEventListener(
    'touchmove',
    (event) => {
      if (drag.get()?.phase === 'dragging') event.preventDefault();
    },
    { passive: false },
  );
}

/** Start watching a press on a card. It becomes a drag on movement, or on a held touch. */
export function pressCard(event: ReactPointerEvent<HTMLElement>, taskId: string) {
  if (event.button !== 0 || drag.get() || press) return;
  if (event.target instanceof Element && event.target.closest('[data-no-drag]')) return;
  press = {
    taskId,
    x: event.clientX,
    y: event.clientY,
    touch: event.pointerType === 'touch',
    element: event.currentTarget,
  };
  pointer = { x: event.clientX, y: event.clientY };
  moved = false;
  if (press.touch) longPress = window.setTimeout(begin, LONG_PRESS_MS);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('keydown', onKeyDown, true);
}

function release() {
  window.clearTimeout(longPress);
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerCancel);
  window.removeEventListener('keydown', onKeyDown, true);
  if (frame !== undefined) cancelAnimationFrame(frame);
  frame = undefined;
  press = null;
  dwell = null;
  armed = null;
  folded = null;
  pageHold = null;
}

function onPointerMove(event: PointerEvent) {
  if (!press) return;
  pointer = { x: event.clientX, y: event.clientY };
  const distance = Math.hypot(pointer.x - press.x, pointer.y - press.y);
  if (!drag.get()) {
    // A touch that travels before the hold completes is a scroll.
    if (press.touch) {
      if (distance > TOUCH_SLOP) release();
    } else if (distance > MOUSE_SLOP) begin();
    return;
  }
  if (distance > MOUSE_SLOP) moved = true;
  overlayPosition.x.set(pointer.x - grab.x);
  overlayPosition.y.set(pointer.y - grab.y);
}

function onPointerUp() {
  if (drag.get()) finish(true);
  else release();
}

function onPointerCancel() {
  if (drag.get()) finish(false);
  else release();
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !drag.get()) return;
  event.preventDefault();
  event.stopPropagation();
  finish(false);
}

function begin() {
  if (!press) return;
  const { taskId, element, touch } = press;
  const { tasks } = current();
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return release();
  // With its underlay, when it has one.
  const rect = (element.closest('[data-card-root]') ?? element).getBoundingClientRect();
  grab = { x: pointer.x - rect.left, y: pointer.y - rect.top };
  overlayPosition.x.jump(rect.left);
  overlayPosition.y.jump(rect.top);
  const selection = board.get().selection;
  drag.set({
    ids: selection.includes(taskId)
      ? [taskId, ...selection.filter((id) => id !== taskId)]
      : [taskId],
    width: rect.width,
    height: rect.height,
    grab,
    origin: element.closest<HTMLElement>('[data-origin]')?.dataset.origin ?? null,
    priority: task.priority,
    target: null,
    rail: null,
    phase: 'dragging',
    swallowed: false,
    touch,
  });
  document.documentElement.dataset.dragging = '';
  tick(12);
  // Before the first render, so the gap opens where the card already is.
  resolve();
  frame = requestAnimationFrame(loop);
}

function loop() {
  autoScroll();
  resolve();
  frame = requestAnimationFrame(loop);
}

function sameTarget(a: DropTarget | null, b: DropTarget | null) {
  if (a === null || b === null) return a === b;
  if (a.kind === 'status' && b.kind === 'status') return a.statusId === b.statusId;
  if (a.kind === 'list' && b.kind === 'list') return a.listId === b.listId;
  if (a.kind === 'place' && b.kind === 'place') {
    return a.listId === b.listId && a.priority === b.priority && a.index === b.index;
  }
  return false;
}

function set(change: Partial<DragState>) {
  const state = drag.get();
  if (!state) return;
  const next = { ...state, ...change };
  if (
    sameTarget(state.target, next.target) &&
    state.priority === next.priority &&
    state.rail?.listId === next.rail?.listId &&
    state.rail?.priority === next.rail?.priority
  ) {
    return;
  }
  // A tick when the card would land somewhere else, not for every slot it passes.
  const landing = (target: DropTarget | null) =>
    target === null
      ? ''
      : target.kind === 'status'
        ? target.statusId
        : `${target.listId}:${target.kind === 'place' ? target.priority : ''}`;
  if (landing(state.target) !== landing(next.target)) tick();
  drag.set(next);
}

/** The list under the pointer, or the one whose column the pointer is beside. */
function listAt(hit: Element | null) {
  const direct = hit?.closest<HTMLElement>('[data-drop-list]');
  if (direct || hit?.closest('[data-drop-block]')) return direct ?? null;
  let nearest: HTMLElement | null = null;
  let best = 20;
  for (const element of document.querySelectorAll<HTMLElement>('[data-drop-list]')) {
    const rect = element.getBoundingClientRect();
    if (pointer.y < rect.top - 80 || pointer.y > rect.bottom + 80) continue;
    const distance = Math.max(rect.left - pointer.x, pointer.x - rect.right, 0);
    if (distance < best) {
      best = distance;
      nearest = element;
    }
  }
  return nearest;
}

/** The zone whose stretch of the list holds `y` (in-place zones only). */
function zoneAt(list: HTMLElement, y: number, fallback: Priority): Priority {
  let zone: Priority | null = null;
  for (const header of list.querySelectorAll<HTMLElement>('[data-zone-header]')) {
    const priority = Number(header.dataset.zoneHeader) as Priority;
    if (zone === null || header.getBoundingClientRect().top <= y) zone = priority;
  }
  return zone ?? fallback;
}

/**
 * Where in a zone a card of `height` centred on `y` belongs. Cards are compared at the
 * place they would be with no gap open, so an opening gap cannot push a neighbour back
 * under the card and flip the answer.
 */
function indexIn(list: HTMLElement, priority: Priority, y: number, height: number, ids: string[]) {
  let gaps = 0;
  let index = 0;
  for (const element of list.querySelectorAll<HTMLElement>('[data-gap], [data-slot]')) {
    if (element.dataset.gap !== undefined) {
      gaps += element.getBoundingClientRect().height;
      continue;
    }
    if (Number(element.dataset.zone) !== priority) continue;
    if (ids.includes(element.dataset.slot ?? '')) continue;
    const rect = element.getBoundingClientRect();
    if (y > rect.top - gaps + (rect.height + height) / 2) index += 1;
  }
  return index;
}

function resolve() {
  const state = drag.get();
  if (state?.phase !== 'dragging') return;
  const hit = document.elementFromPoint(pointer.x, pointer.y);
  const tile = hit?.closest<HTMLElement>('[data-drop-status]');
  if (tile?.dataset.dropStatus) {
    dwell = null;
    return set({ target: { kind: 'status', statusId: tile.dataset.dropStatus }, rail: null });
  }
  const list = listAt(hit);
  const listId = list?.dataset.dropList as ListId | undefined;
  // The backlog gallery mixes statuses, so only its own cards can be placed in it; a card
  // from elsewhere is sent to one of its statuses instead.
  if (!list || !listId || (listId === 'backlog' && state.origin !== 'backlog')) {
    dwell = null;
    folded = null;
    return set({ target: null, rail: null });
  }
  if (state.ids.length > 1) {
    return set({ target: listStatusId(listId) ? { kind: 'list', listId } : null, rail: null });
  }

  let { priority } = state;
  let rail: DragState['rail'] = null;
  const railElement = hit?.closest<HTMLElement>('[data-drop-rail]');
  // Rails appear when the column folds, sometimes right under a card that is not moving.
  // One only starts to take the card once the column has finished folding and the card has
  // been somewhere else in it.
  const now = performance.now();
  if (folded?.listId !== listId) folded = { listId, since: now };
  if (!railElement && now - folded.since > FOLD_MS) armed = listId;
  if (railElement && list.contains(railElement) && armed === listId) {
    const over = Number(railElement.dataset.dropRail) as Priority;
    const key = `${listId}:${over}`;
    if (dwell?.key !== key) dwell = { key, since: now };
    if (now - dwell.since >= RAIL_DWELL_MS || reducedMotion()) {
      priority = over;
      dwell = null;
    } else {
      rail = { listId, priority: over };
    }
  } else {
    dwell = null;
  }

  const centre = pointer.y - grab.y + state.height / 2;
  if (config.zoneModel === 'inPlace') priority = zoneAt(list, centre, priority);
  const index = indexIn(list, priority, centre, state.height, state.ids);
  set({ target: { kind: 'place', listId, priority, index }, priority, rail });
}

function autoScroll() {
  const hit = document.elementFromPoint(pointer.x, pointer.y);
  const scroller =
    hit?.closest<HTMLElement>('[data-autoscroll]') ??
    listAt(hit)?.querySelector<HTMLElement>('[data-autoscroll]');
  if (scroller) {
    const rect = scroller.getBoundingClientRect();
    const up = rect.top + EDGE - pointer.y;
    const down = pointer.y - (rect.bottom - EDGE);
    if (up > 0) scroller.scrollTop -= Math.min(16, up / 4);
    else if (down > 0) scroller.scrollTop += Math.min(16, down / 4);
  }
  const row = document.querySelector<HTMLElement>('[data-autoscroll-x]');
  if (row && row.scrollWidth > row.clientWidth) {
    const rect = row.getBoundingClientRect();
    if (pointer.y > rect.top && pointer.y < rect.bottom) {
      const left = rect.left + EDGE - pointer.x;
      const right = pointer.x - (rect.right - EDGE);
      if (left > 0 && left < EDGE * 2) row.scrollLeft -= Math.min(14, left / 4);
      else if (right > 0 && right < EDGE * 2) row.scrollLeft += Math.min(14, right / 4);
    }
  }
  // A phone shows one column: holding a card at a side turns to the next.
  const pager = document.querySelector<HTMLElement>('[data-pager]');
  if (pager && !hit?.closest('[data-drop-block]')) {
    const side = pointer.x < 28 ? -1 : pointer.x > window.innerWidth - 28 ? 1 : 0;
    const now = performance.now();
    if (side === 0) pageHold = null;
    else if (pageHold?.side !== side) pageHold = { side, since: now };
    else if (now - pageHold.since > PAGE_HOLD_MS) {
      pager.scrollBy({ left: side * pager.clientWidth, behavior: 'smooth' });
      pageHold = { side, since: now + 250 };
      tick();
    }
  }
}

function finish(commit: boolean) {
  const state = drag.get();
  const wasTouch = press?.touch ?? false;
  const held = moved;
  release();
  if (!state) return;
  const [lead] = state.ids;
  const target = commit ? state.target : null;
  if (target?.kind === 'place') {
    placeInList(lead!, target.listId, target.priority, target.index);
  } else if (target) {
    const statusId = target.kind === 'status' ? target.statusId : listStatusId(target.listId);
    if (statusId) sendTasks(state.ids, statusId);
  }
  if (target && state.ids.length > 1) update({ selection: [] });
  // Lifting a card and setting it straight back down selects it.
  if (commit && wasTouch && !held) toggleSelected(lead!);
  suppressClick = !wasTouch;
  window.setTimeout(() => {
    suppressClick = false;
  }, 80);
  if (target) tick(14);
  drag.set({ ...state, phase: 'landing', target: null, rail: null });
  land(lead!, target?.kind === 'status' ? target.statusId : null);
}

function settle() {
  delete document.documentElement.dataset.dragging;
  drag.set(null);
}

/**
 * Flies the held copy to where its card now is. The column is still unfolding, so the copy
 * chases the card's live position instead of animating to a rectangle measured once.
 */
function land(taskId: string, statusId: string | null) {
  if (reducedMotion()) return settle();
  const started = performance.now();
  let last = started;
  const step = (now: number) => {
    const state = drag.get();
    if (state?.phase !== 'landing') return;
    const card = document.querySelector<HTMLElement>(
      `[data-card-id="${CSS.escape(taskId)}"]:not([data-overlay])`,
    );
    // Sent to a status that shows no cards: the copy shrinks into whatever stands for it.
    const home =
      card || !statusId
        ? null
        : (document.querySelector<HTMLElement>(`[data-drop-status="${CSS.escape(statusId)}"]`) ??
          document.querySelector<HTMLElement>(`[data-status-home~="${CSS.escape(statusId)}"]`));
    if (!card && !state.swallowed) drag.set({ ...state, swallowed: true });
    let x = overlayPosition.x.get();
    let y = overlayPosition.y.get();
    let toX = x;
    let toY = y;
    if (card) {
      const rect = card.getBoundingClientRect();
      toX = rect.left;
      toY = rect.top;
    } else if (home) {
      const rect = home.getBoundingClientRect();
      toX = rect.left + rect.width / 2 - state.width / 2;
      toY = rect.top + rect.height / 2 - state.height / 2;
    }
    const ease = 1 - Math.exp(-(now - last) / 60);
    last = now;
    x += (toX - x) * ease;
    y += (toY - y) * ease;
    overlayPosition.x.set(x);
    overlayPosition.y.set(y);
    const arrived = Math.hypot(toX - x, toY - y) < 0.75;
    if ((arrived && now - started > 120) || now - started > 560) return settle();
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
