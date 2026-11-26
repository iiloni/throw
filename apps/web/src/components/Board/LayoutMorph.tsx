import { motionValue } from 'motion/react';
import { Component, type RefObject } from 'react';
import { animateSteady, animateSteadySpring, curves, springs, stopSteady } from '@/lib/motion';
import { boardArriving, pageMoving } from '@/lib/pageTransition';
import { drag } from './drag';

/**
 * The board turning from its full layout into its compact one beside an open task, or back.
 * The two are different elements, so the change is drawn as a morph between them, as
 * `rearrange.tsx` draws a move: before the new layout is drawn, every card on screen is copied
 * where it stands, and each flies to its place in the new layout (`springs.smooth`). A card with
 * no place on screen there fades where it was; one that had none before fades in. The rails
 * slide off their edges and the compact dock rises from the foot (or the reverse), edge-docked
 * as panes are (`springs.pane`); only what stands behind the cards (column surfaces, headers)
 * fades, briefly, under the cards' movement. Reduced motion, a page transition and a held card
 * switch in place.
 *
 * Rendered as the last child of the board's half, so that it reads the new layout after the
 * layout effects of the layouts beside it.
 */
export class LayoutMorph extends Component<{
  root: RefObject<HTMLElement | null>;
  compact: boolean;
  reduced: boolean;
}> {
  private ends: (() => void)[] = [];
  private unsubscribe: (() => void) | null = null;

  override componentDidMount() {
    // A held card reads the board from the DOM: everything goes where it rests.
    this.unsubscribe = drag.subscribe(() => {
      if (drag.get()) this.finish();
    });
  }

  override getSnapshotBeforeUpdate(previous: { compact: boolean }) {
    const root = this.props.root.current;
    if (previous.compact === this.props.compact || !root) return null;
    this.finish();
    if (this.props.reduced || drag.get() || pageMoving() || boardArriving()) return null;
    return before(root);
  }

  override componentDidUpdate(_: unknown, __: unknown, was: Before | null) {
    const root = this.props.root.current;
    if (!was || !root) return;
    this.ends = morph(root, was, this.props.compact);
  }

  override componentWillUnmount() {
    this.unsubscribe?.();
    this.finish();
  }

  private finish() {
    const ends = this.ends;
    this.ends = [];
    for (const end of ends) end();
  }

  override render() {
    return null;
  }
}

type Box = { x: number; y: number; width: number; height: number };

/** What the layout going leaves to be drawn while the one coming takes over. */
type Before = {
  root: Box;
  /** Everything but the cards, rails and dock: what stands behind the cards. */
  chrome: Still;
  /** Each card on screen, by task, with a copy of it. */
  cards: Map<string, { box: Box; still: Still }>;
  /** The rails and the dock, with where each slides off to. */
  slides: { box: Box; still: Still; dx: number; dy: number }[];
};

type Still = {
  copy: HTMLElement;
  scrolls: { element: HTMLElement; top: number; left: number }[];
};

/** A piece the new layout slides in from off its edge, or the old one slides out to. */
const SLIDING = '.board-rail, [data-compact-dock]';
/** Marks the morph's own layer, which nothing in it reads as the board. */
const LAYER = 'data-layout-morph';

/** Attributes a copy keeps: the ones styles read. The rest are the board's handles. */
const STYLED = new Set([
  'data-active',
  'data-color',
  'data-column-color',
  'data-content-type',
  'data-covers',
  'data-current',
  'data-dim',
  'data-disabled',
  'data-edges',
  'data-folded',
  'data-hide-scrollbars',
  'data-highlighted',
  'data-inset',
  'data-mode',
  'data-more-bottom',
  'data-more-left',
  'data-more-right',
  'data-more-top',
  'data-seam',
  'data-side',
  'data-size',
  'data-state',
  'data-sunk',
  'data-surface',
  'data-tinted',
  'data-variant',
]);

function boxOf(element: Element): Box {
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
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

/** Whether an element is drawn on screen: inside every scroller and clip between it and `root`. */
function shown(element: HTMLElement, root: HTMLElement) {
  let visible = intersect(boxOf(element), boxOf(root));
  for (
    let node = element.parentElement;
    node && node !== root && visible.width >= 8 && visible.height >= 8;
    node = node.parentElement
  ) {
    const style = getComputedStyle(node);
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible')
      visible = intersect(visible, boxOf(node));
  }
  return visible.width >= 8 && visible.height >= 8;
}

/** Each task's card under `root`, by the place its list or gallery gives it. */
function cardsIn(root: HTMLElement) {
  const cards = new Map<string, HTMLElement>();
  const taken = new Set<HTMLElement>();
  for (const card of root.querySelectorAll<HTMLElement>('[data-card-id]:not([data-overlay])')) {
    const key = card.dataset.cardId;
    if (!key || cards.has(key) || card.closest(`[${LAYER}]`)) continue;
    const place =
      card.closest<HTMLElement>('[data-rearrange-card], [data-layout] [data-slot]') ?? card;
    // A subtask's card inside its parent's place goes with it.
    if (taken.has(place) || !root.contains(place)) continue;
    taken.add(place);
    cards.set(key, place);
  }
  return cards;
}

/** A still copy of `element`: nothing in it can be found, focused or dropped on. */
function stillOf(element: HTMLElement, hide: (original: HTMLElement) => boolean = () => false) {
  const copy = element.cloneNode(true) as HTMLElement;
  const scrolls: Still['scrolls'] = [];
  const originals = [element, ...element.querySelectorAll<HTMLElement>('*')];
  const copies = [copy, ...copy.querySelectorAll<HTMLElement>('*')];
  originals.forEach((original, index) => {
    const twin = copies[index];
    if (!twin) return;
    for (const { name } of [...twin.attributes])
      if (name === 'id' || (name.startsWith('data-') && !STYLED.has(name)))
        twin.removeAttribute(name);
    if (original !== element && hide(original)) twin.style.visibility = 'hidden';
    if (original.scrollTop || original.scrollLeft)
      scrolls.push({ element: twin, top: original.scrollTop, left: original.scrollLeft });
  });
  return { copy, scrolls };
}

function before(root: HTMLElement): Before {
  const box = boxOf(root);
  const places = cardsIn(root);
  const all = new Set(places.values());
  const sliding = [...root.querySelectorAll<HTMLElement>(SLIDING)];
  const behind = (element: HTMLElement) => all.has(element) || sliding.includes(element);

  const frame = document.createElement('div');
  frame.className = root.className;
  const scrolls: Still['scrolls'] = [];
  for (const child of root.children)
    if (child instanceof HTMLElement && !child.hasAttribute(LAYER)) {
      const still = stillOf(child, behind);
      frame.append(still.copy);
      scrolls.push(...still.scrolls);
    }

  const cards = new Map<string, { box: Box; still: Still }>();
  for (const [key, place] of places)
    if (shown(place, root)) cards.set(key, { box: boxOf(place), still: stillOf(place) });

  const slides = sliding
    .filter((element) => shown(element, root))
    .map((element) => {
      const at = boxOf(element);
      const end = element.dataset.side === 'end';
      const dock = element.matches('[data-compact-dock]');
      return {
        box: at,
        still: stillOf(element, (original) => all.has(original)),
        dx: dock ? 0 : end ? box.x + box.width - at.x : box.x - (at.x + at.width),
        dy: dock ? box.y + box.height - at.y : 0,
      };
    });
  return { root: box, chrome: { copy: frame, scrolls }, cards, slides };
}

/** Draws `still` in `layer` over `box`, as `origin` places the layer. */
function place(layer: HTMLElement, still: Still, box: Box, origin: Box) {
  const holder = document.createElement('div');
  holder.style.position = 'absolute';
  holder.style.left = '0';
  holder.style.top = '0';
  holder.style.width = `${box.width}px`;
  holder.style.height = `${box.height}px`;
  holder.style.transform = `translate(${box.x - origin.x}px, ${box.y - origin.y}px)`;
  const { copy } = still;
  // The copy stands where its holder does, rather than where its own list placed it.
  copy.style.position = 'relative';
  copy.style.inset = 'auto';
  copy.style.transform = 'none';
  copy.style.translate = 'none';
  copy.style.width = '100%';
  copy.style.removeProperty('visibility');
  copy.style.removeProperty('opacity');
  copy.removeAttribute('hidden');
  holder.append(copy);
  layer.append(holder);
  for (const { element, top, left } of still.scrolls) {
    element.scrollTop = top;
    element.scrollLeft = left;
  }
  return holder;
}

type Spring = (typeof springs)[keyof typeof springs];
type Curve = (typeof curves)[keyof typeof curves];

/**
 * Runs `step` from 0 to 1 on a spring or curve, and `done` once, when it ends or is cut short.
 * It steps by painted frames (`animateSteady`): the new layout's first frames are taken by
 * laying it out, and a clock would have the morph mostly over before it is drawn.
 */
function run(motion: Spring | Curve, step: (t: number) => void, done: () => void) {
  const progress = motionValue(0);
  progress.on('change', step);
  step(0);
  const running =
    'visualDuration' in motion
      ? animateSteadySpring(progress, 1, motion)
      : animateSteady(progress, 1, motion);
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    stopSteady(progress);
    progress.destroy();
    done();
  };
  void running.then(end);
  return end;
}

function fadeIn(element: HTMLElement, curve: Curve) {
  return run(
    curve,
    (t) => {
      element.style.opacity = String(t);
    },
    () => element.style.removeProperty('opacity'),
  );
}

/** Hidden by opacity rather than a clip, so it can still be picked up while its copy flies. */
function hide(element: HTMLElement) {
  element.style.opacity = '0';
}

function reveal(element: HTMLElement) {
  element.style.removeProperty('opacity');
}

function morph(root: HTMLElement, was: Before, compact: boolean) {
  const ends: (() => void)[] = [];
  const origin = boxOf(root);
  const layer = document.createElement('div');
  layer.setAttribute(LAYER, '');
  layer.setAttribute('aria-hidden', 'true');
  layer.inert = true;
  // Clipped to the half as it narrows, so the task pane slides in over what is going.
  layer.className = 'pointer-events-none absolute inset-0 z-50 overflow-hidden';
  root.append(layer);
  ends.push(() => layer.remove());
  // Once everything drawn in it has gone, so does the layer.
  const gone = (holder: HTMLElement) => {
    holder.remove();
    if (!layer.childElementCount) layer.remove();
  };

  // Behind the cards: the column surfaces and headers going, fading under their movement.
  const chrome = place(layer, was.chrome, was.root, origin);
  ends.push(
    run(
      curves.fade,
      (t) => {
        chrome.style.opacity = String(1 - t);
      },
      () => gone(chrome),
    ),
  );

  // The rails and dock going slide off the edge they stand at.
  for (const slide of was.slides) {
    const holder = place(layer, slide.still, slide.box, origin);
    ends.push(
      run(
        springs.pane,
        (t) => {
          holder.style.translate = `${slide.dx * t}px ${slide.dy * t}px`;
        },
        () => gone(holder),
      ),
    );
  }

  // The new layout's own rails and dock come in from the edges the old ones left by.
  const area = boxOf(root);
  for (const element of root.querySelectorAll<HTMLElement>(SLIDING)) {
    if (element.closest(`[${LAYER}]`)) continue;
    const at = boxOf(element);
    const dock = element.matches('[data-compact-dock]');
    const dx = dock
      ? 0
      : element.dataset.side === 'end'
        ? area.x + area.width - at.x
        : area.x - (at.x + at.width);
    const dy = dock ? area.y + area.height - at.y : 0;
    element.style.translate = `${dx}px ${dy}px`;
    ends.push(
      run(
        springs.pane,
        (t) => {
          element.style.translate = `${dx * (1 - t)}px ${dy * (1 - t)}px`;
        },
        () => element.style.removeProperty('translate'),
      ),
    );
  }

  // What names the compact board's page and view settles in where the column header stood.
  for (const element of root.querySelectorAll<HTMLElement>('[data-morph-enter]'))
    ends.push(
      run(
        curves.enter,
        (t) => {
          element.style.opacity = String(t);
          element.style.translate = `0 ${(1 - t) * -12}px`;
        },
        () => {
          element.style.removeProperty('opacity');
          element.style.removeProperty('translate');
        },
      ),
    );
  // The full layout's column surfaces fade in as the compact board's plain half fades out.
  if (!compact)
    for (const column of root.querySelectorAll<HTMLElement>('[data-column]'))
      ends.push(fadeIn(column, curves.fade));

  // Every card on screen is drawn where it was until it knows where it goes.
  const copies = new Map<string, HTMLElement>();
  for (const [key, card] of was.cards) copies.set(key, place(layer, card.still, card.box, origin));
  const hidden = [...cardsIn(root).values()];
  for (const element of hidden) hide(element);
  ends.push(() => {
    for (const element of hidden) reveal(element);
  });

  // The new layout places its pages and galleries in its own effects: its cards are where
  // they go by the next frame, before it is drawn.
  const frame = requestAnimationFrame(() => {
    const now = cardsIn(root);
    for (const element of hidden) if (![...now.values()].includes(element)) reveal(element);
    for (const [key, element] of now) {
      const copy = copies.get(key);
      const on = shown(element, root);
      if (copy && on) {
        copies.delete(key);
        hide(element);
        const from = was.cards.get(key)!.box;
        ends.push(
          run(
            springs.smooth,
            (t) => {
              // Its place may still be settling (a page turning to it), so the copy heads for
              // where it is now rather than where it was when it set off.
              const to = boxOf(element);
              const base = boxOf(layer);
              copy.style.transform = `translate(${from.x + (to.x - from.x) * t - base.x}px, ${from.y + (to.y - from.y) * t - base.y}px)`;
              copy.style.width = `${from.width + (to.width - from.width) * t}px`;
              copy.style.height = 'auto';
            },
            () => {
              gone(copy);
              reveal(element);
            },
          ),
        );
        continue;
      }
      reveal(element);
      if (on) ends.push(fadeIn(element, curves.enter));
    }
    // A card with no place on screen in the new layout fades where it was.
    for (const copy of copies.values()) {
      copy.style.height = 'auto';
      const start = copy.style.transform;
      ends.push(
        run(
          curves.fold,
          (t) => {
            copy.style.transform = `${start} scale(${1 - 0.04 * t})`;
            copy.style.opacity = String(1 - t);
          },
          () => gone(copy),
        ),
      );
    }
  });
  ends.push(() => cancelAnimationFrame(frame));
  return ends;
}
