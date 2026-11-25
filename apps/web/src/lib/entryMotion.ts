import { useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { useLayoutEffect, useRef } from 'react';
import { animateSteady, curves, stopSteady } from '@/lib/motion';
import { boardArriving, pageMoving } from '@/lib/pageTransition';

// Remounted routes, boards and cards that moved column should not enter again in a document.
const entered = new Set<string>();

/** Small steps share a start time; a long page never builds a long queue. Catch's stagger. */
export function entryDelay(step: number) {
  return Math.min(120, Math.max(0, Math.round(step)) * 20);
}

/** The delay for content `top` px down its page: one step per 100 px. */
export function entryDelayForTop(top: number) {
  return entryDelay(top / 100);
}

/**
 * Catch's content entry: a 10 px settle and fade, once per `key` in a document, so sync
 * updates, a reconnect's snapshot and remounts never replay it. The one exception is a board
 * switched to through its cross-fade, whose content settles in on every arrival. Content that
 * mounts while a page transition moves the whole page shows at once, as does everything with
 * reduced motion. `skip` (a held card, a task landing in its card) finishes an entry where it
 * is, so nothing measures a card part way through. `delayMs` may be a function, read once the
 * element is in the document.
 */
export function useEntryMotion(
  key: string,
  ready = true,
  delayMs: number | (() => number) = 0,
  skip = false,
) {
  const reducedMotion = useReducedMotion();
  // Read once, as the element mounts: a board switched to enters again, nothing else does.
  const progress = useMotionValue(
    reducedMotion || skip || (entered.has(key) && !boardArriving()) ? 1 : 0,
  );
  const y = useTransform(progress, [0, 1], [10, 0]);
  const delay = useRef(delayMs);

  // Layout changes may update the start delay before readiness, but must not restart an entry.
  useLayoutEffect(() => {
    delay.current = delayMs;
  }, [delayMs]);

  useLayoutEffect(() => {
    if (!ready) return;
    entered.add(key);
    if (progress.get() === 1) return;
    if (reducedMotion || pageMoving()) progress.set(1);
    else {
      const ms = typeof delay.current === 'function' ? delay.current() : delay.current;
      void animateSteady(progress, 1, curves.enter, ms);
    }
    return () => stopSteady(progress);
  }, [key, ready, reducedMotion, progress]);

  useLayoutEffect(() => {
    if (!skip) return;
    entered.add(key);
    stopSteady(progress);
    progress.set(1);
  }, [skip, key, progress]);

  return { opacity: progress, y };
}
