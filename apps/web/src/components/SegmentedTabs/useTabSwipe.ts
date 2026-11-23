import {
  type AnimationPlaybackControls,
  animate,
  useMotionValue,
  useReducedMotion,
} from 'motion/react';
import {
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { haptics } from '@/lib/haptics';
import { curves, springs } from '@/lib/motion';

/** How far the panel has to travel, as a share of its width, before letting go switches. */
const COMMIT = 0.3;
/** A flick switches sooner, once it has gone this far (px) at this speed (px/ms). */
const FLICK_MIN = 32;
const FLICK = 0.5;
/** How much a swipe towards no tab follows the finger. */
const RESIST = 0.2;
/** Where the arriving panel starts: this share of the width, and no further than the cap. */
const ENTER = 0.3;
const ENTER_MAX = 96;
/** How long the leaving panel takes to clear, carrying on the way the finger went. */
const LEAVE = 0.1;
/** Movement before a touch counts as a swipe or a scroll. */
const SLOP = 8;
/** A touch here is editing or choosing text, not turning panels. */
const IGNORED = 'input, textarea, select, [contenteditable="true"], [data-no-swipe]';

type Gesture = {
  id: number;
  x: number;
  y: number;
  base: number;
  width: number;
  locked: boolean;
  armed: boolean;
  samples: { x: number; t: number }[];
};

function velocity(samples: Gesture['samples']) {
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || !last || last.t === first.t) return 0;
  return (last.x - first.x) / (last.t - first.t);
}

/**
 * Swiping sideways over tabs and their panels turns between them on a touch screen. The
 * panel follows the finger and the tabs' indicator follows along (`drag`, in tabs); letting
 * go past a third of the way, or flicking, switches, and the new panel arrives from the side
 * the finger was heading. Vertical movement stays the page's scroll: the element given `ref`
 * and `handlers` must be `touch-action: pan-y`.
 *
 * `shown` is the panel on screen, which can follow `value` a render later; the new panel
 * arrives when it changes.
 */
export function useTabSwipe<TValue extends string>({
  value,
  shown,
  values,
  onValueChange,
}: {
  value: TValue | null;
  shown: TValue | null;
  values: readonly TValue[];
  onValueChange: (value: TValue) => void;
}) {
  const reducedMotion = useReducedMotion();
  const x = useMotionValue(0);
  const opacity = useMotionValue(1);
  const drag = useMotionValue(0);
  const gesture = useRef<Gesture | null>(null);
  const running = useRef<AnimationPlaybackControls[]>([]);
  const arriving = useRef<{ from: number; velocity: number } | null>(null);
  const swiped = useRef(false);

  const run = useCallback((...controls: AnimationPlaybackControls[]) => {
    for (const control of running.current) control.stop();
    running.current = controls;
  }, []);

  const settle = () => {
    const spring = reducedMotion ? { duration: 0 } : springs.snappy;
    run(animate(x, 0, spring), animate(opacity, 1, spring), animate(drag, 0, spring));
  };

  const shownBefore = useRef(shown);
  useLayoutEffect(() => {
    if (shownBefore.current === shown) return;
    shownBefore.current = shown;
    const arrival = arriving.current;
    arriving.current = null;
    if (!arrival || reducedMotion) {
      run();
      x.jump(0);
      opacity.jump(1);
      return;
    }
    x.jump(arrival.from);
    opacity.jump(0);
    run(
      animate(x, 0, { ...springs.pane, velocity: arrival.velocity * 1000 }),
      animate(opacity, 1, curves.enter),
    );
  }, [shown, reducedMotion, x, opacity, run]);

  useLayoutEffect(() => () => run(), [run]);

  // Surfaces around the panels read raw touches too: the phone's task screen pulls away from
  // the top or bottom of its scroll. A touch turning panels is not theirs, however it drifts.
  const [element, setElement] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!element) return;
    const keep = (event: TouchEvent) => {
      if (gesture.current?.locked) event.stopPropagation();
    };
    element.addEventListener('touchmove', keep);
    return () => element.removeEventListener('touchmove', keep);
  }, [element]);

  const end = (event: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const current = gesture.current;
    if (current?.id !== event.pointerId) return;
    gesture.current = null;
    if (!current.locked) return;
    swiped.current = true;
    const offset = x.get();
    const index = values.indexOf(value as TValue);
    const step = offset < 0 ? 1 : -1;
    const target = values[index + step];
    const speed = velocity(current.samples);
    const back = Math.sign(speed) === -Math.sign(offset) && Math.abs(speed) > FLICK;
    const flick =
      Math.abs(offset) > FLICK_MIN &&
      Math.sign(speed) === Math.sign(offset) &&
      Math.abs(speed) > FLICK;
    if (cancelled || !target || back || !(current.armed || flick)) {
      settle();
      return;
    }
    const arrive = () => {
      arriving.current = {
        from: step * Math.min(ENTER_MAX, current.width * ENTER),
        velocity: speed,
      };
      onValueChange(target);
    };
    if (reducedMotion) {
      arrive();
      return;
    }
    // The leaving panel carries on and clears out, and the indicator finishes its way to the
    // new tab, before the new panel takes its place.
    const leave = { duration: LEAVE, ease: curves.enter.ease };
    run(
      animate(x, offset + speed * LEAVE * 1000, leave),
      animate(opacity, 0, { ...leave, onComplete: arrive }),
      animate(drag, step, springs.snappy),
    );
  };

  const handlers = {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      swiped.current = false;
      if (event.pointerType !== 'touch' || value === null || gesture.current) return;
      if ((event.target as HTMLElement).closest(IGNORED)) return;
      gesture.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        base: 0,
        width: event.currentTarget.getBoundingClientRect().width,
        locked: false,
        armed: false,
        samples: [],
      };
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const current = gesture.current;
      if (current?.id !== event.pointerId) return;
      const dx = event.clientX - current.x;
      if (!current.locked) {
        const dy = event.clientY - current.y;
        if (Math.hypot(dx, dy) < SLOP) return;
        if (Math.abs(dx) <= Math.abs(dy)) {
          gesture.current = null;
          return;
        }
        current.locked = true;
        current.x = event.clientX;
        // A swipe takes over a panel still springing, from where it has got to. A scroll or a
        // tap leaves it to finish.
        run();
        current.base = x.get();
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      current.samples = [...current.samples, { x: event.clientX, t: event.timeStamp }].slice(-5);
      const index = values.indexOf(value as TValue);
      const raw = current.base + dx;
      const open = values[index + (raw < 0 ? 1 : -1)] !== undefined;
      const offset = open ? raw : raw * RESIST;
      const progress = Math.max(-1, Math.min(1, -offset / current.width));
      x.set(offset);
      drag.set(progress);
      opacity.set(1 - 0.5 * Math.abs(progress));
      const armed = open && Math.abs(progress) >= COMMIT;
      if (armed !== current.armed) {
        current.armed = armed;
        if (armed) haptics.threshold();
      }
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => end(event, false),
    // The browser took the touch for a scroll.
    onPointerCancel: (event: PointerEvent<HTMLElement>) => end(event, true),
    // A swipe that ends on a tab is not a tap on it.
    onClickCapture(event: MouseEvent<HTMLElement>) {
      if (!swiped.current) return;
      swiped.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };

  return { x, opacity, drag, ref: setElement, handlers };
}
