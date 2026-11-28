import { animate, motionValue } from 'motion/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { haptics } from '@/lib/haptics';
import { dropIndex } from '@/lib/masonry';
import { springs } from '@/lib/motion';
import { createStore } from '@/lib/store';
import type { MasonryData } from './Gallery';
import type { Priority } from './model';
import {
  board,
  current,
  holdBoard,
  type ListId,
  listStatusId,
  moveToPlace,
  placeInList,
  releaseBoard,
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
 *   With `data-layout="masonry"`, a gallery's `data-masonry` element describes its bands and
 *   cards instead, and the place is worked out from that.
 *   With `data-drop-send`, the list keeps no manual order (the board is sorted by size): a
 *   card is sent to its status instead of placed, and the backlog takes none.
 * - `data-drop-status`: a tile that sends cards to a status without placing them.
 * - `data-drop-expand`: a surface that shows its targets only while the card is over it.
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
  /** The card is over a surface that opens for it, such as the phone dock. */
  over: boolean;
  /** The side of a phone's screen the card is held at, turning to the next column. */
  page: -1 | 0 | 1;
  /**
   * The card has moved far enough from where it was picked up to be going somewhere, and the
   * board makes way for it. Until then the board stays as it was, with the card's own place
   * held open, and a drop puts it back.
   */
  moved: boolean;
};

export const drag = createStore<DragState | null>(null);

/** A held card the board makes way for: zones fold, rails and dropzones appear. */
export function makingWay(state: DragState | null): state is DragState {
  return state?.phase === 'dragging' && state.moved;
}

/** Where the held card's copy is drawn. Written every frame, so not React state. */
export const overlayPosition = { x: motionValue(0), y: motionValue(0) };

/**
 * The copy's width. A backlog card and a column card differ in width, so the copy springs
 * to the width of whatever it is over, as a card in Catch springs to a new column width,
 * and arrives at its place already the right size.
 */
export const overlayWidth = motionValue(0);
let widthTarget = 0;
/** Where across the card it is held, as a share of its width, so it stays under the finger. */
let grabRatio = 0;

function resize(width: number) {
  if (Math.abs(width - widthTarget) < 1) return;
  widthTarget = width;
  if (reducedMotion()) overlayWidth.jump(width);
  else animate(overlayWidth, width, springs.snappy);
}

function follow() {
  overlayPosition.x.set(pointer.x - grabRatio * overlayWidth.get());
  overlayPosition.y.set(pointer.y - grab.y);
}

type Config = { heldColumn: 'compact' | 'full' };
let config: Config = { heldColumn: 'compact' };
export function configureDrag(next: Config) {
  config = next;
}

/** How long a finger rests on a card before it is held. */
export const LONG_PRESS_MS = 260;
/** How far a finger may wander before its press is a scroll. */
export const TOUCH_SLOP = 10;
const MOUSE_SLOP = 6;
/**
 * How far a held card goes from where it lifted before the board makes way for it, unless it
 * leaves its column first: about half the shortest card, the least that could change its place
 * in a column. Counted from the lift, not the press, so the slop it took to lift is not part of
 * it. A finger rests less still than a mouse and gets more.
 */
export const MAKE_WAY_DISTANCE = 24;
export const MAKE_WAY_TOUCH_DISTANCE = 32;
const RAIL_DWELL_MS = 220;
/** How long a column takes to fold its zones into rails. */
const FOLD_MS = 300;
const EDGE = 64;
export const PAGE_HOLD_MS = 480;
/**
 * The band at each side of a phone's screen that turns to the next column: the neighbour
 * peeking in there and a little of the column beside it.
 */
const PAGE_EDGE = 44;
/** A surface that opens under a held card waits this long before its targets take it. */
const EXPAND_ARM_MS = 200;
/** Space under each card, which a gap must also open. */
export const CARD_SPACING = 12;

type Press = { taskId: string; x: number; y: number; touch: boolean; element: HTMLElement };

let press: Press | null = null;
let longPress: number | undefined;
let pointer = { x: 0, y: 0 };
let grab = { x: 0, y: 0 };
/** A touch held long enough to select its card; moving it from here is a drag. */
let primed = false;
/** The same, for components: true while that touch is still down. */
export const holding = createStore(false);
/** Whether that hold selected a card that was not selected before. */
let primedSelect = false;
let frame: number | undefined;
let dwell: { key: string; since: number } | null = null;
let armed: string | null = null;
let folded: { listId: string; since: number } | null = null;
let pageHold: { side: -1 | 1; since: number } | null = null;
/** The column or status the card was picked up in; leaving it is a move, however short. */
let home: Element | null = null;
/** Where the card lifted, and the place it lifted from. */
let lift = { x: 0, y: 0 };
let liftedFrom: DropTarget | null = null;
/**
 * The column folds or relabels around a card that is not moving, which would carry its place
 * off under it, so once the board makes way the card keeps the place it lifted from until it
 * goes on twice as far from the lift.
 */
let keeping = false;
let overSince = 0;
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

/** Haptics belong to touch: a mouse has its own feel. */
function feel(effect: keyof typeof haptics) {
  if (drag.get()?.touch) haptics[effect]();
}

// A page starts scrolling under a finger unless the move is cancelled, and only a listener
// that was there before the touch began is allowed to cancel it.
if (typeof window !== 'undefined') {
  window.addEventListener(
    'touchmove',
    (event) => {
      if (primed || drag.get()?.phase === 'dragging') event.preventDefault();
    },
    { passive: false },
  );
}

/** True while a held touch has selected a card and may yet become a drag. */
export function isPrimed() {
  return primed;
}

/**
 * Start watching a press on a card. A mouse drags it on movement. A touch has to hold
 * first, which selects the card; moving after that drags it.
 */
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
  if (press.touch) longPress = window.setTimeout(prime, LONG_PRESS_MS);
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
  primed = false;
  primedSelect = false;
  if (holding.get()) holding.set(false);
  dwell = null;
  armed = null;
  folded = null;
  pageHold = null;
  home = null;
  liftedFrom = null;
  keeping = false;
}

function onPointerMove(event: PointerEvent) {
  if (!press) return;
  pointer = { x: event.clientX, y: event.clientY };
  const distance = Math.hypot(pointer.x - press.x, pointer.y - press.y);
  if (!drag.get()) {
    if (press.touch) {
      // A touch that travels before the hold completes is a scroll.
      if (distance <= TOUCH_SLOP) return;
      if (primed) begin();
      else release();
    } else if (distance > MOUSE_SLOP) begin();
    return;
  }
  follow();
}

function onPointerUp() {
  if (drag.get()) return finish(true);
  // The hold already selected the card; the click that follows must not undo it.
  if (primed) swallowClick();
  release();
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

function swallowClick() {
  suppressClick = true;
  window.setTimeout(() => {
    suppressClick = false;
  }, 80);
}

function prime() {
  if (!press) return;
  primed = true;
  holding.set(true);
  haptics.longPress();
  if (!board.get().selection.includes(press.taskId)) {
    primedSelect = true;
    toggleSelected(press.taskId);
  }
}

function begin() {
  if (!press) return;
  const { taskId, element, touch } = press;
  const { tasks } = current();
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return release();
  // With its underlay, when it has one. Its subtasks stay open until it moves.
  const root = element.closest('[data-card-root]') ?? element;
  const rect = root.getBoundingClientRect();
  grab = { x: pointer.x - rect.left, y: pointer.y - rect.top };
  grabRatio = grab.x / rect.width;
  widthTarget = rect.width;
  overlayWidth.jump(rect.width);
  overlayPosition.x.jump(pointer.x - grab.x);
  overlayPosition.y.jump(pointer.y - grab.y);
  // The hold selected this card alone: it is being moved, not gathered into a selection.
  if (primedSelect && board.get().selection.length === 1) update({ selection: [] });
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
    over: false,
    page: 0,
    moved: false,
  });
  document.documentElement.dataset.dragging = '';
  home = element.closest('[data-drop-list], [data-drop-status]');
  lift = { ...pointer };
  holdBoard();
  feel('selection');
  // Before the first render, so the gap opens where the card already is. Its own place is
  // all it may hold open until it moves: a column it was beside or a status it stands in
  // would change around it.
  resolve(true);
  const start = drag.get();
  if (start && (start.target?.kind !== 'place' || start.target.listId !== homeList())) {
    drag.set({ ...start, target: null, rail: null, priority: task.priority });
  }
  liftedFrom = drag.get()?.target ?? null;
  frame = requestAnimationFrame(loop);
}

function homeList() {
  return home instanceof HTMLElement ? home.dataset.dropList : undefined;
}

function makeWayDistance() {
  return press?.touch ? MAKE_WAY_TOUCH_DISTANCE : MAKE_WAY_DISTANCE;
}

/** Whether the card has gone far enough, or left its column, for the board to make way. */
function farEnough(hit: Element | null) {
  if (!press) return true;
  if (Math.hypot(pointer.x - lift.x, pointer.y - lift.y) >= makeWayDistance()) return true;
  return (hit?.closest('[data-drop-list], [data-drop-status]') ?? null) !== home;
}

/**
 * Whether the card still keeps the place it lifted from while the board makes way around it:
 * until it goes twice the make-way distance from the lift, takes another priority, or leaves
 * its column. Counted from the lift, so a quick move that is far away by the next frame is
 * placed where it is.
 */
function keepsPlace(listId: ListId, priority: Priority) {
  if (!keeping || liftedFrom?.kind !== 'place') return false;
  keeping =
    listId === liftedFrom.listId &&
    priority === liftedFrom.priority &&
    Math.hypot(pointer.x - lift.x, pointer.y - lift.y) < 2 * makeWayDistance();
  return keeping;
}

/**
 * The card is going somewhere: the board makes way for it. Its column folds or labels its
 * zones, the dropzones appear, and the card folds its subtasks, all on their usual motion.
 */
function makeWay(state: DragState): DragState {
  const next = { ...state, moved: true };
  drag.set(next);
  document.documentElement.dataset.dragMoved = '';
  const lead = state.ids[0];
  // Folded now rather than at the lift, so a card put straight back keeps its subtasks open.
  // The copy folds them, and the gap follows its height (`measure`).
  if (lead && board.get().expanded.includes(lead)) {
    update((before) => ({ expanded: before.expanded.filter((id) => id !== lead) }));
  }
  // The column folds from here, so a rail that appears under the card counts from here too.
  folded = null;
  armed = null;
  dwell = null;
  keeping = true;
  return next;
}

/** The copy re-wraps as its width changes; the gap it will fill has to keep its height. */
function measure() {
  const state = drag.get();
  const copy = document.querySelector<HTMLElement>('[data-overlay]');
  const height = (copy?.closest<HTMLElement>('[data-card-root]') ?? copy)?.offsetHeight;
  if (!state || !height || Math.abs(height - state.height) < 0.5) return;
  grab = { x: grab.x, y: Math.min(grab.y, height) };
  drag.set({ ...state, height, grab });
}

function loop() {
  // A card that has not moved yet scrolls nothing: the board stays still under the lift.
  if (drag.get()?.moved) autoScroll();
  resolve();
  measure();
  follow();
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
  if (landing(state.target) !== landing(next.target)) feel('selection');
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

/** The zone whose stretch of the list holds `y`, when the column keeps its full layout. */
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

/** The masonry a gallery draws (`Gallery.tsx`), in the coordinates of its grid element. */
function masonryOf(list: HTMLElement) {
  const element = list.querySelector<HTMLElement>('[data-masonry]');
  if (!element?.dataset.masonry) return null;
  try {
    return {
      rect: element.getBoundingClientRect(),
      data: JSON.parse(element.dataset.masonry) as MasonryData,
    };
  } catch {
    return null;
  }
}

/**
 * Where among a masonry gallery's cards a card centred on `x`, `y` belongs: the slot nearest
 * it in the layout its peers would have with it placed there (Catch's `dropIndex`). The
 * gallery says where its bands and cards are, so the answer does not depend on cards that are
 * still springing to their places. Returns the band too, read from where the bands start.
 */
function masonryPlace(
  list: HTMLElement,
  fallback: Priority,
  x: number,
  y: number,
  height: number,
  current: DropTarget | null,
): { priority: Priority; index: number } | null {
  const masonry = masonryOf(list);
  if (!masonry) return null;
  const { rect, data } = masonry;
  const top = y - rect.top;
  let band = data.bands[0];
  for (const candidate of data.bands) if (candidate.top <= top) band = candidate;
  if (!band) return { priority: fallback, index: 0 };
  const priority = band.priority ?? fallback;
  const index = dropIndex({
    columns: data.columns,
    columnWidth: data.columnWidth,
    gap: data.gap,
    heights: band.peers,
    height,
    center: { x: x - rect.left, y: top - band.cards },
    current:
      current?.kind === 'place' && current.priority === priority
        ? Math.min(current.index, band.peers.length)
        : -1,
  });
  return { priority, index };
}

/** Works out where the card would land. `pickup` finds its own place as it is lifted. */
function resolve(pickup = false) {
  let state = drag.get();
  if (state?.phase !== 'dragging') return;
  const hit = document.elementFromPoint(pointer.x, pointer.y);
  if (!state.moved && !pickup) {
    // Until it moves, the card keeps the place it was lifted from.
    if (!farEnough(hit)) return;
    state = makeWay(state);
  }
  const over = Boolean(hit?.closest('[data-drop-expand]'));
  if (over !== state.over) {
    overSince = performance.now();
    drag.set({ ...state, over });
  }
  const tile = hit?.closest<HTMLElement>('[data-drop-status]');
  // The surface opens under the finger: what lands beneath it is not chosen yet.
  const arming = over && performance.now() - overSince < EXPAND_ARM_MS;
  // At a phone's edge the card is waiting for the next column, not for the one it is over.
  if (arming || pageSide(hit) !== 0) return set({ target: null, rail: null });
  if (tile?.dataset.dropStatus) {
    dwell = null;
    keeping = false;
    return set({ target: { kind: 'status', statusId: tile.dataset.dropStatus }, rail: null });
  }
  const list = listAt(hit);
  const listId = list?.dataset.dropList as ListId | undefined;
  if (list && listId && list.dataset.dropSend !== undefined) {
    dwell = null;
    folded = null;
    keeping = false;
    // A card is sent to the column's status, keeping its priority; one already there stays.
    const statusId = listStatusId(listId);
    const { tasks } = current();
    const leaving = state.ids.some(
      (id) => tasks.find((task) => task.id === id)?.statusId !== statusId,
    );
    return set({
      target: statusId && leaving ? { kind: 'status', statusId } : null,
      rail: null,
    });
  }
  // The backlog gallery mixes statuses, so only its own cards can be placed in it; a card
  // from elsewhere is sent to one of its statuses instead.
  if (!list || !listId || (listId === 'backlog' && state.origin !== 'backlog')) {
    dwell = null;
    folded = null;
    keeping = false;
    return set({ target: null, rail: null });
  }
  // The copy takes the width cards have in this list.
  const peer = list.querySelector<HTMLElement>('[data-slot]:not([hidden]) [data-card-root]');
  if (peer && peer.offsetWidth > 0) resize(peer.offsetWidth);
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

  if (liftedFrom?.kind === 'place' && keepsPlace(listId, priority)) {
    return set({ target: liftedFrom, priority, rail });
  }
  const centre = pointer.y - grab.y + state.height / 2;
  // A gallery lays its cards out in masonry, and says where they are.
  const placed =
    list.dataset.layout === 'masonry'
      ? masonryPlace(
          list,
          priority,
          pointer.x - grab.x + overlayWidth.get() / 2,
          centre,
          state.height,
          state.target,
        )
      : null;
  if (placed) {
    set({ target: { kind: 'place', listId, ...placed }, priority: placed.priority, rail });
    return;
  }
  if (config.heldColumn === 'full') priority = zoneAt(list, centre, priority);
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
    // A surface over the end of the list (the phone's drawer) is a target of its own, so
    // the list scrolls from just above it. One the list itself lies on is not in the way.
    let bottom = rect.bottom;
    for (const block of document.querySelectorAll('[data-drop-block]')) {
      const { top } = block.getBoundingClientRect();
      if (top > rect.top) bottom = Math.min(bottom, top);
    }
    const up = rect.top + EDGE - pointer.y;
    const down = pointer.y - (bottom - EDGE);
    if (up > 0) scroller.scrollTop -= Math.min(16, up / 4);
    else if (down > 0 && pointer.y < bottom) scroller.scrollTop += Math.min(16, down / 4);
  }
  const row = document.querySelector<HTMLElement>('[data-autoscroll-x]');
  if (row && row.scrollWidth > row.clientWidth) {
    const rect = row.getBoundingClientRect();
    // The rails lie over the scroller's ends; its edges are where they stop.
    const start = rect.left + Number(row.dataset.insetStart ?? 0);
    const end = rect.right - Number(row.dataset.insetEnd ?? 0);
    // Over a rail the card is headed for it, not for a column further along.
    const between = pointer.x >= start && pointer.x <= end;
    if (between && pointer.y > rect.top && pointer.y < rect.bottom) {
      const left = start + EDGE - pointer.x;
      const right = pointer.x - (end - EDGE);
      if (left > 0 && left < EDGE * 2) row.scrollLeft -= Math.min(14, left / 4);
      else if (right > 0 && right < EDGE * 2) row.scrollLeft += Math.min(14, right / 4);
    }
  }
  // A phone shows one column: holding a card at a side turns to the next.
  const pager = document.querySelector<HTMLElement>('[data-pager]');
  if (pager) {
    const side = pageSide(hit);
    const state = drag.get();
    if (state && state.page !== side) drag.set({ ...state, page: side });
    const now = performance.now();
    if (side === 0) pageHold = null;
    else if (pageHold?.side !== side) pageHold = { side, since: now };
    else if (now - pageHold.since > PAGE_HOLD_MS) {
      pager.scrollBy({ left: side * pageStride(pager), behavior: 'smooth' });
      // The next turn waits for this one to settle as well.
      pageHold = { side, since: now + 250 };
      feel('threshold');
    }
  }
}

/**
 * The side of a pager a held card is waiting at, if there is a page beyond it. A phone's pager
 * spans the screen; the compact board beside a task (CompactSplitBoard) is half of it, and a
 * card carried over the task is not at its edge.
 */
function pageSide(hit: Element | null): -1 | 0 | 1 {
  const pager = document.querySelector<HTMLElement>('[data-pager]');
  if (!pager || hit?.closest('[data-drop-block]')) return 0;
  const { left, right } = pager.getBoundingClientRect();
  if (pointer.x < left || pointer.x > right) return 0;
  if (pointer.x < left + PAGE_EDGE) return pager.scrollLeft > 1 ? -1 : 0;
  const end = pager.scrollWidth - pager.clientWidth - 1;
  if (pointer.x > right - PAGE_EDGE) return pager.scrollLeft < end ? 1 : 0;
  return 0;
}

/** The distance from one page of a phone's pager to the next. */
export function pageStride(pager: HTMLElement) {
  const [first, second] = pager.querySelectorAll<HTMLElement>('[data-page]');
  return first && second ? second.offsetLeft - first.offsetLeft : pager.clientWidth;
}

function finish(commit: boolean) {
  const state = drag.get();
  const wasTouch = press?.touch ?? false;
  release();
  if (!state) return;
  const lead = state.ids[0]!;
  // A card dropped before it moved was not going anywhere: it goes back as it was.
  const aimed = commit && state.moved ? state.target : null;
  let target = aimed;
  // Placed among the cards the person saw, before the sync held back meanwhile comes in.
  const place =
    target?.kind === 'place'
      ? placeInList(lead, target.listId, target.priority, target.index)
      : null;
  const movable = releaseBoard(state.ids);
  // A card moved elsewhere goes back to where the server has it; the others still move. A
  // place is the lead card's alone.
  if (target && (movable.length === 0 || (target.kind === 'place' && !movable.includes(lead))))
    target = null;
  if (aimed && movable.length < state.ids.length) {
    const stale = state.ids.length - movable.length;
    update({
      announcement:
        state.ids.length === 1
          ? 'Not moved: it changed on another device while it was held.'
          : `${stale} not moved: ${stale === 1 ? 'it' : 'they'} changed on another device while ${stale === 1 ? 'it was' : 'they were'} held.`,
    });
  }
  if (target?.kind === 'place') {
    if (place) moveToPlace(lead, place);
  } else if (target) {
    const statusId = target.kind === 'status' ? target.statusId : listStatusId(target.listId);
    if (statusId) sendTasks(movable, statusId);
  }
  if (aimed && state.ids.length > 1) update({ selection: [] });
  if (!wasTouch) swallowClick();
  if (target) feel('success');
  drag.set({ ...state, phase: 'landing', target: null, rail: null });
  land(lead, target?.kind === 'status' ? target.statusId : null);
}

function settle() {
  delete document.documentElement.dataset.dragging;
  delete document.documentElement.dataset.dragMoved;
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
        : // Not into a tile of a move target fading out (inert) as the drag ends.
          (document.querySelector<HTMLElement>(
            `[data-drop-status="${CSS.escape(statusId)}"]:not([inert] *)`,
          ) ??
          document.querySelector<HTMLElement>(`[data-status-home~="${CSS.escape(statusId)}"]`));
    if (!card && !state.swallowed) drag.set({ ...state, swallowed: true });
    let x = overlayPosition.x.get();
    let y = overlayPosition.y.get();
    let toX = x;
    let toY = y;
    if (card) {
      const rect = card.getBoundingClientRect();
      resize(rect.width);
      toX = rect.left;
      toY = rect.top;
    } else if (home) {
      const rect = home.getBoundingClientRect();
      toX = rect.left + rect.width / 2 - overlayWidth.get() / 2;
      toY = rect.top + rect.height / 2 - state.height / 2;
    }
    const ease = 1 - Math.exp(-(now - last) / 60);
    last = now;
    x += (toX - x) * ease;
    y += (toY - y) * ease;
    overlayPosition.x.set(x);
    overlayPosition.y.set(y);
    const arrived =
      Math.hypot(toX - x, toY - y) < 0.75 && Math.abs(overlayWidth.get() - widthTarget) < 0.75;
    if ((arrived && now - started > 120) || now - started > 560) return settle();
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
