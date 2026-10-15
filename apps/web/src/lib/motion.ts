import { cancelFrame, cubicBezier, frame, type MotionValue, type Transition } from 'motion/react';

// Catch's interruptible springs: controls feel quick; changing surfaces settle softly.
export const springs = {
  pane: { type: 'spring', visualDuration: 0.45, bounce: 0 },
  snappy: { type: 'spring', visualDuration: 0.3, bounce: 0.2 },
  smooth: { type: 'spring', visualDuration: 0.4, bounce: 0.15 },
} satisfies Record<string, Transition>;

export const EASE_EMPHASIZED = [0.2, 0, 0, 1] as const;

/**
 * Eased curves for full-screen transitions, where a spring's overshoot would push the
 * surface past the screen edge. CSS uses the same curve as `--ease-emphasized`.
 */
export const curves = {
  /** Content arriving during startup, with a gentle fade and no overshoot. */
  enter: { duration: 0.42, ease: [0.25, 0.1, 0.25, 1] as const },
  /** A card opening into the editor. */
  expand: { duration: 0.55, ease: EASE_EMPHASIZED },
  /** The editor settling back into its card. */
  collapse: { duration: 0.5, ease: EASE_EMPHASIZED },
} satisfies Record<string, Transition>;

const steady = new WeakMap<MotionValue<number>, () => void>();

export function stopSteady(value: MotionValue<number>) {
  steady.get(value)?.();
}

/**
 * Runs one of the `curves` on a motion value by frames rather than by the clock: each frame
 * moves the animation on by the time since the last one, up to a limit, so a frame held up
 * by other work is followed by the next step, not by wherever the clock has got to. `animate`
 * keeps time, and opening a note mounts its editor while the surface grows: that work came
 * out of the start of the transition, which then jumped most of the way open in one frame.
 *
 * Resolves when the animation completes; never, if another one takes the value over first.
 */
export function animateSteady(
  value: MotionValue<number>,
  to: number,
  { duration, ease }: (typeof curves)[keyof typeof curves],
  delayMs = 0,
) {
  const eased = cubicBezier(ease[0], ease[1], ease[2], ease[3]);
  const length = duration * 1000;
  const progress = (elapsed: number) => ({
    value: eased(Math.min(1, elapsed / length)),
    done: elapsed >= length,
  });
  return steadily(value, to, progress, delayMs);
}

/** `progress` maps the time run so far (ms) to how far along the animation is. */
function steadily(
  value: MotionValue<number>,
  to: number,
  progress: (elapsed: number) => { value: number; done: boolean },
  delayMs = 0,
) {
  steady.get(value)?.();
  value.stop();
  const from = value.get();
  let elapsed = -delayMs;
  return new Promise<void>((resolve) => {
    const stop = () => {
      cancelFrame(step);
      steady.delete(value);
    };
    // Motion's frame loop is what limits `delta` (to 40 ms).
    const step = ({ delta }: { delta: number }) => {
      elapsed += delta;
      if (elapsed <= 0) return;
      const { value: time, done } = progress(elapsed);
      value.set(from + (to - from) * (done ? 1 : time));
      if (!done) return;
      stop();
      resolve();
    };
    steady.set(value, stop);
    frame.update(step, true);
  });
}

/**
 * Calls back once the browser has drawn the page as it is now, with the work that got it
 * there out of the way. Returns a function that cancels the call.
 */
export function afterPaint(callback: () => void) {
  let request = requestAnimationFrame(() => {
    request = requestAnimationFrame(callback);
  });
  return () => cancelAnimationFrame(request);
}
