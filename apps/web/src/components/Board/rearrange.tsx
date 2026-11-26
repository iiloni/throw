import {
  type AnimationPlaybackControls,
  animate,
  type MotionValue,
  motionValue,
} from 'motion/react';
import { Component } from 'react';
import { curves, springs } from '@/lib/motion';
import { boardArriving, pageMoving } from '@/lib/pageTransition';
import { drag } from './drag';
import { board, current } from './state';
import { isTaskCardHidden } from './taskTransition';

/**
 * Cards rearranging when something other than a drag moves them: a status or priority set from
 * the task pane or a menu, a bulk move, the keyboard carry, sync from another device, a filter.
 * The board renders the new order at once; this animates it from the old one (FLIP), as a drag
 * animates its gaps:
 *
 * - a card that changes place in its column springs there, and so do the neighbours that close
 *   up behind it or make room for it (`springs.smooth`);
 * - a card that changes column flies from its old card to its new one when both are on screen,
 *   which stays clear while it arrives;
 * - one whose new place is out of sight goes from its old one: into its folded column if that
 *   is on screen, as a dropped card does, or fading where it was;
 * - one that arrives from out of sight fades in.
 *
 * Positions are read in `getSnapshotBeforeUpdate`, which React calls for every updating class
 * component before it changes the DOM, and again once the commit is done, so a column changing
 * by itself between renders (an unfolding subtask list, an entry, a scroll) is never mistaken
 * for a move. A drag owns the board's motion while a card is held: picking one up settles
 * everything at once, and nothing animates until the board has settled after the drop. Reduced
 * motion, a page transition and a board switch skip it all, and a card a task screen opens from
 * or lands in is left where it rests.
 *
 * Elements opt in with `data-rearrange` (a key unique on the page). `data-rearrange-card` marks
 * a task's card, whose key is the task's id. A gallery's cards (`[data-layout] [data-slot]`)
 * place themselves; they are only where a flight starts or ends.
 */

export type Box = { x: number; y: number; width: number; height: number };

export type Seen = {
  key: string;
  /** A task's card, which can fly, fade in or go; anything else only moves within its list. */
  card: boolean;
  /** Placed by its list's flow, so it can be shifted back to where it was and spring home. */
  flow: boolean;
  /** The list it is in, or null for a card in flight. */
  list: Element | null;
  /** Where its list places it, without any shift still springing it there. */
  rect: Box;
  /** Running its own first entry (lib/entryMotion.ts). */
  entering: boolean;
};

export type Rearrangement =
  | { kind: 'shift'; key: string; dx: number; dy: number; lead: boolean }
  | { kind: 'fly'; key: string }
  | { kind: 'appear'; key: string }
  | { kind: 'leave'; key: string };

/** Changes that need more than a shift; past this many, the rest happen at once. */
export const MAX_CHANGES = 12;

/**
 * What to animate, from where things were drawn before a commit and where they are now.
 * `shown` says whether a place is on screen and not covered (before: where it was drawn).
 */
export function planRearrangement(
  before: ReadonlyMap<string, Seen>,
  after: ReadonlyMap<string, Seen>,
  {
    lists,
    hidden,
    shown,
  }: {
    /** The lists on the page before the commit: a card in a list that just opened is not new. */
    lists: ReadonlySet<Element>;
    hidden: (key: string) => boolean;
    shown: (key: string, when: 'before' | 'after') => boolean;
  },
): Rearrangement[] {
  const shifts: Extract<Rearrangement, { kind: 'shift' }>[] = [];
  const changes: Rearrangement[] = [];
  for (const [key, now] of after) {
    if (now.card && hidden(key)) continue;
    const was = before.get(key);
    if (!was) {
      if (
        now.card &&
        now.flow &&
        !now.entering &&
        now.list &&
        lists.has(now.list) &&
        shown(key, 'after')
      )
        changes.push({ kind: 'appear', key });
      continue;
    }
    if (was.list === now.list) {
      const dx = was.rect.x - now.rect.x;
      const dy = was.rect.y - now.rect.y;
      if (now.flow && (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5))
        shifts.push({ kind: 'shift', key, dx, dy, lead: false });
      continue;
    }
    if (!now.card) continue;
    const from = shown(key, 'before');
    const to = shown(key, 'after');
    if (from && to) changes.push({ kind: 'fly', key });
    else if (to && now.flow) changes.push({ kind: 'appear', key });
    else if (from) changes.push({ kind: 'leave', key });
  }
  for (const [key, was] of before) {
    if (after.has(key) || !was.card || hidden(key)) continue;
    if (shown(key, 'before')) changes.push({ kind: 'leave', key });
  }
  // The card that travels furthest in a list passes over the ones making way for it.
  const furthest = new Map<Element | null, (typeof shifts)[number]>();
  for (const shift of shifts) {
    const list = after.get(shift.key)?.list ?? null;
    const lead = furthest.get(list);
    const distance = Math.hypot(shift.dx, shift.dy);
    if (!lead || distance > Math.hypot(lead.dx, lead.dy)) furthest.set(list, shift);
  }
  for (const shift of furthest.values()) shift.lead = true;
  return [...shifts, ...changes.slice(0, MAX_CHANGES)];
}

/** What the DOM layer keeps of each place: the planner's view and the elements behind it. */
type Found = Seen & {
  /** What moves, and what is hidden while a card flies to it. */
  element: HTMLElement;
  /** What is measured and copied: the card itself, without the space under it. */
  box: HTMLElement;
  /** Where `box` is drawn: what a copy of it starts from, and what must be seen. */
  face: Box;
  /** The scroller, or list, the place is seen through. */
  frame: Element | null;
};

type Snapshot = { found: Map<string, Found>; lists: Set<Element> };

let snapshot: Snapshot | null = null;
/** The commit that lets go of a held card ends the drag's motion, and is not animated either. */
let settling = false;

function reducedMotion() {
  return typeof window.matchMedia !== 'function'
    ? true
    : window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function boxOf(element: Element): Box {
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

function frameOf(element: Element) {
  return (
    element.closest('[data-slot="scroll-area-viewport"]') ?? element.closest('[data-drop-list]')
  );
}

function collect(): Snapshot {
  const found = new Map<string, Found>();
  const add = (element: HTMLElement, key: string, card: boolean, flow: boolean) => {
    if (found.has(key)) return;
    const box = card
      ? (element.querySelector<HTMLElement>('[data-card-root]') ?? element)
      : element;
    const face = boxOf(box);
    if (card && face.width === 0) return;
    // Where the list places it, read from the place rather than the card, which may still be
    // settling into its entry, and without its own shift, which keeps springing while React
    // commits: only a change of place is a move.
    const placed = element === box ? face : boxOf(element);
    const offset = offsets.get(element);
    const rect = offset
      ? { ...placed, x: placed.x - offset.x.get(), y: placed.y - offset.y.get() }
      : placed;
    found.set(key, {
      key,
      card,
      flow,
      list: element.closest('[data-drop-list]'),
      rect,
      entering: element.querySelector('[data-entering]') !== null,
      element,
      box,
      face,
      frame: frameOf(element),
    });
  };
  for (const element of document.querySelectorAll<HTMLElement>('[data-rearrange]'))
    add(
      element,
      element.dataset.rearrange ?? '',
      element.dataset.rearrangeCard !== undefined,
      true,
    );
  for (const element of document.querySelectorAll<HTMLElement>(
    '[data-drop-list][data-layout] [data-slot]',
  )) {
    const key = element.dataset.slot ?? '';
    if (element.querySelector('[data-card-id]')?.getAttribute('data-card-id') === key)
      add(element, key, true, false);
  }
  // A card in flight is where its copy is drawn, coming from no list.
  for (const [key, flight] of flights) {
    const at = found.get(key);
    const face = flight.copy.firstElementChild;
    if (at && face instanceof HTMLElement)
      found.set(key, { ...at, list: null, box: face, face: boxOf(flight.copy) });
  }
  return { found, lists: new Set(document.querySelectorAll('[data-drop-list]')) };
}

/**
 * Rendered inside a list whose places rearrange, so that it updates whenever the list does. It
 * draws nothing; it is a class only for `getSnapshotBeforeUpdate`.
 */
export class RearrangeBoundary extends Component {
  override getSnapshotBeforeUpdate() {
    takeSnapshot();
    return null;
  }

  override componentDidUpdate() {}

  override render() {
    return null;
  }
}

function takeSnapshot() {
  // Every list updating in this commit shares the first one's reading.
  if (snapshot) return;
  if (settling || drag.get() || reducedMotion() || pageMoving() || boardArriving()) {
    settling = false;
    return;
  }
  snapshot = collect();
  // After the whole commit, layout effects included, and before the browser paints it.
  queueMicrotask(rearrange);
}

function rearrange() {
  const was = snapshot;
  snapshot = null;
  if (!was || drag.get()) return;
  const now = collect();
  // A flight still headed for the same card carries on; any other gives way to what replaces it.
  const stale: (() => void)[] = [];
  for (const [key, flight] of flights) {
    if (now.found.get(key)?.element === flight.target) {
      was.found.delete(key);
      now.found.delete(key);
    } else {
      stale.push(flight.end);
      const at = was.found.get(key);
      if (at) at.face = boxOf(flight.copy);
    }
  }
  const viewport = { x: 0, y: 0, width: innerWidth, height: innerHeight };
  const plan = planRearrangement(was.found, now.found, {
    lists: was.lists,
    hidden: isTaskCardHidden,
    shown: (key, when) => {
      const place = (when === 'before' ? was : now).found.get(key);
      if (!place) return false;
      if (when === 'before' && flights.has(key)) return true;
      return shownAt(place.face, place.frame);
    },
  });
  const near = (box: Box) => overlaps(box, viewport);
  for (const change of plan) {
    const after = now.found.get(change.key);
    const before = was.found.get(change.key);
    if (change.kind === 'shift') {
      if (!after) continue;
      if (before && (near(before.rect) || near(after.rect)))
        shift(after.element, change.dx, change.dy, change.lead);
      else settle(after.element);
    } else if (change.kind === 'fly') {
      if (before && after) fly(change.key, before, after);
    } else if (change.kind === 'appear') {
      if (after) appear(change.key, after);
    } else if (before) leave(change.key, before);
  }
  for (const end of stale) end();
  // A card a task screen opens from or lands in rests where it is, to be measured there.
  for (const [key, place] of now.found)
    if (place.card && isTaskCardHidden(key)) settle(place.element);
}

function overlaps(a: Box, b: Box) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function intersect(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.min(a.x + a.width, b.x + b.width) - x,
    height: Math.min(a.y + a.height, b.y + b.height) - y,
  };
}

/** Whether a place is drawn on screen: in its scroller's view, and not under a drawer or dock. */
function shownAt(rect: Box, frame: Element | null) {
  if (!frame?.isConnected || typeof document.elementFromPoint !== 'function') return false;
  const visible = intersect(
    intersect(rect, { x: 0, y: 0, width: innerWidth, height: innerHeight }),
    boxOf(frame),
  );
  if (visible.width < 8 || visible.height < 8) return false;
  const hit = document.elementFromPoint(
    visible.x + visible.width / 2,
    visible.y + visible.height / 2,
  );
  return hit !== null && frame.contains(hit);
}

// ---- Shifting a place back to where it was and springing it home ----

type Offset = {
  x: MotionValue<number>;
  y: MotionValue<number>;
  running: AnimationPlaybackControls[];
};

const offsets = new Map<HTMLElement, Offset>();

function offsetOf(element: HTMLElement) {
  let offset = offsets.get(element);
  if (offset) return offset;
  const made: Offset = { x: motionValue(0), y: motionValue(0), running: [] };
  const write = () => {
    const x = made.x.get();
    const y = made.y.get();
    element.style.translate = x || y ? `${x}px ${y}px` : '';
  };
  made.x.on('change', write);
  made.y.on('change', write);
  offsets.set(element, made);
  offset = made;
  return offset;
}

function shift(element: HTMLElement, dx: number, dy: number, lead: boolean) {
  const offset = offsetOf(element);
  // A place already moving turns towards its new home from where it is, at the speed it had.
  const vx = offset.x.getVelocity();
  const vy = offset.y.getVelocity();
  for (const running of offset.running) running.stop();
  offset.x.jump(offset.x.get() + dx);
  offset.y.jump(offset.y.get() + dy);
  if (lead) element.style.zIndex = '1';
  const running = [
    animate(offset.x, 0, { ...springs.smooth, velocity: vx }),
    animate(offset.y, 0, { ...springs.smooth, velocity: vy }),
  ];
  offset.running = running;
  void Promise.all(running).then(() => {
    if (offsets.get(element) === offset && offset.running === running) settle(element);
  });
}

function settle(element: HTMLElement) {
  const offset = offsets.get(element);
  if (!offset) return;
  for (const running of offset.running) running.stop();
  offsets.delete(element);
  offset.x.destroy();
  offset.y.destroy();
  element.style.removeProperty('translate');
  element.style.removeProperty('z-index');
}

// ---- Copies that fly between columns or go ----

type Flight = { copy: HTMLElement; target: HTMLElement; end: () => void };

const flights = new Map<string, Flight>();
const going = new Set<() => void>();

/**
 * A still copy of a card, drawn over the board without taking part in it: the card itself is
 * gone from where it was, or clipped by its new column's scroller on the way there.
 */
function copyOf(box: HTMLElement, rect: Box) {
  const copy = box.cloneNode(true) as HTMLElement;
  for (const element of [copy, ...copy.querySelectorAll<HTMLElement>('*')]) {
    for (const name of ['id', 'data-card-id', 'data-card-root', 'data-slot', 'data-task-origin'])
      element.removeAttribute(name);
    if (element.tabIndex >= 0) element.tabIndex = -1;
  }
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  layer.inert = true;
  layer.dataset.overlay = '';
  layer.dataset.rearrangeCopy = '';
  layer.className = 'pointer-events-none fixed top-0 left-0 z-40';
  layer.style.width = `${rect.width}px`;
  layer.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
  copy.style.removeProperty('visibility');
  copy.classList.remove('invisible');
  layer.append(copy);
  document.body.append(layer);
  return layer;
}

function hide(element: HTMLElement) {
  element.style.clipPath = 'inset(50%)';
}

function reveal(element: HTMLElement) {
  element.style.removeProperty('clip-path');
}

function fly(key: string, before: Found, after: Found) {
  flights.get(key)?.end();
  const copy = copyOf(before.box, before.face);
  const target = after.element;
  hide(target);
  const progress = motionValue(0);
  const from = before.face;
  progress.on('change', (t) => {
    // The card's place may still be moving (its neighbours making room, a scroll), so the copy
    // heads for where it is now rather than where it was when it set off.
    const to = boxOf(after.box);
    copy.style.transform = `translate(${from.x + (to.x - from.x) * t}px, ${from.y + (to.y - from.y) * t}px)`;
    copy.style.width = `${from.width + (to.width - from.width) * t}px`;
  });
  const running = animate(progress, 1, springs.smooth);
  const end = () => {
    if (flights.get(key)?.copy !== copy) return;
    flights.delete(key);
    running.stop();
    progress.destroy();
    copy.remove();
    reveal(target);
  };
  flights.set(key, { copy, target, end });
  void running.then(end);
}

/** A card whose new place is out of sight: into its folded column if that shows, or fading. */
function leave(key: string, before: Found) {
  const copy = copyOf(before.box, before.face);
  const from = before.face;
  const statusId = current(board.get()).tasks.find((task) => task.id === key)?.statusId;
  const home = statusId ? statusHome(statusId) : null;
  const to = home && boxOf(home);
  const progress = motionValue(0);
  progress.on('change', (t) => {
    const x = to ? from.x + (to.x + to.width / 2 - from.width / 2 - from.x) * t : from.x;
    const y = to ? from.y + (to.y + to.height / 2 - from.height / 2 - from.y) * t : from.y;
    const scale = to ? 1 - 0.8 * t : 1 - 0.04 * t;
    copy.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    copy.style.opacity = String(1 - t);
  });
  const running = animate(progress, 1, curves.fold);
  const end = () => {
    if (!going.delete(end)) return;
    running.stop();
    progress.destroy();
    copy.remove();
  };
  going.add(end);
  void running.then(end);
}

/** Whatever stands for a status that shows no cards here, such as its folded column. */
function statusHome(statusId: string) {
  const id = CSS.escape(statusId);
  const home =
    document.querySelector<HTMLElement>(`[data-drop-status="${id}"]`) ??
    document.querySelector<HTMLElement>(`[data-status-home~="${id}"]`);
  return home && shownAt(boxOf(home), home) ? home : null;
}

const fades = new Set<Animation>();

function appear(key: string, after: Found) {
  const face = after.element.firstElementChild;
  if (!(face instanceof HTMLElement) || typeof face.animate !== 'function') return;
  flights.get(key)?.end();
  const [a, b, c, d] = curves.enter.ease;
  const fade = face.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: curves.enter.duration * 1000,
    easing: `cubic-bezier(${a}, ${b}, ${c}, ${d})`,
  });
  fades.add(fade);
  const done = () => fades.delete(fade);
  fade.addEventListener('finish', done);
  fade.addEventListener('cancel', done);
}

/** Everything to where it rests, now: a held card reads the board from the DOM. */
export function settleRearrangements() {
  for (const element of [...offsets.keys()]) settle(element);
  for (const flight of [...flights.values()]) flight.end();
  for (const end of [...going]) end();
  for (const fade of [...fades]) fade.finish();
}

if (typeof window !== 'undefined') {
  let holding = false;
  drag.subscribe(() => {
    const held = drag.get() !== null;
    if (held && !holding) settleRearrangements();
    if (!held && holding) settling = true;
    holding = held;
  });
}
