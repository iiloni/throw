import { animate, motionValue } from 'motion/react';

/**
 * How far the page sits past the scroll edge it was flung into: down at the top, up at the
 * bottom. The shell moves its page column (title and content) by it as `top`, never a
 * transform, which would carry the page's fixed docks and glass with it. The browser's own
 * overscroll is off (`overscroll-behavior` in `styles.css`), so a fling would otherwise stop
 * dead at the edge. After Catch's.
 */
export const pageBounceY = motionValue(0);

/** Slower arrivals (px/ms) stop at the edge as they are. */
const MIN_SPEED = 0.4;
/** How much of the arriving speed carries on past the edge. */
const CARRY = 0.6;
/** The furthest a bounce goes (px), and the most of a small scroller's height it may take. */
const MAX_REACH = 36;
const MAX_REACH_OF_HEIGHT = 0.12;
/** Scroll events further apart than this (ms) are separate scrolls, not one in motion. */
const MOVING_WITHIN = 80;
/** The speed of a scroll is read over the events of its last moments (ms). */
const SPEED_OVER = 100;
/** Two events can land a millisecond apart, which says nothing of the speed between them. */
const SPEED_OVER_AT_LEAST = 20;
/**
 * The spring's natural frequency (rad/s). It is critically damped, so the content comes back
 * to its edge without crossing it: from a push of `v` it follows `v * t * e^(-RATE * t)`,
 * reaching `v / (e * RATE)` at its furthest.
 */
const RATE = 20;
/** By when that curve is back within a pixel of the edge (s). */
const SETTLED_AFTER = 9 / RATE;
const KEYFRAMES = 24;

type Sample = { y: number; time: number; end: number };

/**
 * Bounces whatever scrolls up and down when it reaches its top or bottom at speed: the page,
 * and every scroller inside it. Sideways scrolls (the phone board's columns) are left alone.
 * Returns a function that stops watching.
 */
export function watchScrollBounce({
  held = () => false,
}: {
  /**
   * True while something other than a scroll moves the content: a card being dragged scrolls
   * its column to the edge on its own, and measures the cards it passes.
   */
  held?: () => boolean;
} = {}) {
  // Each scroll in motion, without its latest step: the edge cuts that one short.
  const scrolls = new WeakMap<object, Sample[]>();
  const bounces = new WeakMap<Element, Animation[]>();
  let touching = false;

  function onScroll(event: Event) {
    const page = document.scrollingElement;
    const scroller = event.target instanceof Element && event.target !== page ? event.target : null;
    const box = scroller ?? page;
    if (!box) return;
    const y = scroller ? scroller.scrollTop : window.scrollY;
    const time = event.timeStamp;
    let samples = scrolls.get(box) ?? [];
    const last = samples.at(-1);
    // A jump (restored scroll, shrinking content) arrives with no motion before it.
    if (!last || time - last.time >= MOVING_WITHIN) samples = [];
    const first = samples.find((sample) => time - sample.time <= SPEED_OVER);
    const span = first && last ? last.time - first.time : 0;
    const velocity = first && last && span >= SPEED_OVER_AT_LEAST ? (last.y - first.y) / span : 0;
    const end = box.scrollHeight;
    const atTop = y <= 0;
    const atBottom = y >= end - box.clientHeight - 1;
    // An end that moved was not arrived at: the scroll is keeping pace with content opening
    // below it (a task's panel turned to), not flung into it.
    const arrived =
      last !== undefined &&
      ((atTop && y < last.y && velocity < 0) ||
        (atBottom && y > last.y && velocity > 0 && end === last.end));
    if (
      arrived &&
      Math.abs(velocity) >= MIN_SPEED &&
      // A finger on the screen holds the content; the edge pulls (the board's project
      // switcher, Settings, an open task, the drawer) start there too.
      !touching &&
      !held() &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      const reach = Math.min(MAX_REACH, box.clientHeight * MAX_REACH_OF_HEIGHT);
      const push =
        (atTop ? 1 : -1) * Math.min(Math.abs(velocity) * 1000 * CARRY, reach * Math.E * RATE);
      if (scroller) {
        // The content reached the edge between the last event and this one; the time since then
        // is already past the edge. Counted on the frame's own clock (the timeline's time), which
        // is when this frame's animations are sampled; the event is dispatched later within it.
        const crossed = last.time + Math.abs(last.y - (atTop ? 0 : y)) / Math.abs(velocity);
        const past = Math.min(Math.max(time - crossed, 0), time - last.time);
        const frame = document.timeline?.currentTime;
        bounceContent(scroller, push, (typeof frame === 'number' ? frame : time) - past);
      } else {
        animate(pageBounceY, 0, {
          type: 'spring',
          stiffness: RATE ** 2,
          damping: 2 * RATE,
          velocity: push,
        });
      }
    }
    samples = samples.filter((sample) => time - sample.time <= SPEED_OVER);
    samples.push({ y, time, end });
    scrolls.set(box, samples);
  }

  /**
   * A scroller's content has no element of its own to move, so each child in view takes the
   * bounce, added to whatever transform it has.
   */
  function bounceContent(scroller: Element, push: number, arrived: number) {
    for (const animation of bounces.get(scroller) ?? []) animation.cancel();
    const view = scroller.getBoundingClientRect();
    const keyframes = Array.from({ length: KEYFRAMES + 1 }, (_, index) => {
      const t = (index / KEYFRAMES) * SETTLED_AFTER;
      const y = index === KEYFRAMES ? 0 : push * t * Math.exp(-RATE * t);
      return { transform: `translateY(${y.toFixed(2)}px)` };
    });
    const running: Animation[] = [];
    for (const child of scroller.children) {
      const { top, bottom } = child.getBoundingClientRect();
      if (bottom < view.top - MAX_REACH || top > view.bottom + MAX_REACH) continue;
      const animation = child.animate(keyframes, {
        duration: SETTLED_AFTER * 1000,
        composite: 'add',
      });
      // Counted from when the content reached the edge, not from when the animation gets going
      // a frame later: the content would sit dead at the edge for that frame before it set off.
      animation.startTime = arrived;
      running.push(animation);
    }
    bounces.set(scroller, running);
  }

  function onTouch(event: TouchEvent) {
    touching = event.touches.length > 0;
  }

  const touchEvents = ['touchstart', 'touchend', 'touchcancel'] as const;
  // Scroll events do not bubble, so the scrollers inside the page are heard on the way down.
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });
  for (const type of touchEvents) window.addEventListener(type, onTouch, { passive: true });
  return () => {
    window.removeEventListener('scroll', onScroll, { capture: true });
    for (const type of touchEvents) window.removeEventListener(type, onTouch);
    pageBounceY.stop();
    pageBounceY.set(0);
  };
}
