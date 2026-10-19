import { useEffect, useReducer, useRef } from 'react';

/**
 * How long rows stay on screen after their collection empties. Long enough for a re-fetched
 * snapshot to arrive on a slow connection.
 */
export const RESET_HOLD_MS = 5000;

export type Steady<T> = { rows: T[]; emptySince: number | null };

/**
 * Reconnecting after a reload can make Electric fetch a shape again from scratch, and the
 * collection then commits its emptying a moment before the rows come back. Projects always
 * have statuses, and tasks and projects leave only when purged, so rows that vanish all at
 * once are almost always such a reset: what was shown stays until the rows return, or for
 * `RESET_HOLD_MS` if they never do.
 */
export function steadyRows<T>(last: Steady<T>, rows: T[], now: number): Steady<T> {
  if (rows.length > 0 || last.rows.length === 0) return { rows, emptySince: null };
  const emptySince = last.emptySince ?? now;
  return now - emptySince < RESET_HOLD_MS
    ? { rows: last.rows, emptySince }
    : { rows, emptySince: null };
}

/** `steadyRows` for a live query's result. */
export function useSteadyRows<T>(rows: T[]): T[] {
  const last = useRef<Steady<T>>({ rows, emptySince: null });
  const [, recheck] = useReducer((count: number) => count + 1, 0);
  last.current = steadyRows(last.current, rows, performance.now());
  const { emptySince } = last.current;
  useEffect(() => {
    if (emptySince === null) return;
    const timer = setTimeout(recheck, RESET_HOLD_MS - (performance.now() - emptySince) + 10);
    return () => clearTimeout(timer);
  }, [emptySince]);
  return last.current.rows;
}
