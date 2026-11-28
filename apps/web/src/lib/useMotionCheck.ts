import type { MotionValue } from 'motion/react';
import { useCallback, useSyncExternalStore } from 'react';

/** Re-renders only when `check` of the value changes, not on every frame of its motion. */
export function useMotionCheck(value: MotionValue<number>, check: (value: number) => boolean) {
  return useSyncExternalStore(
    useCallback((listener: () => void) => value.on('change', listener), [value]),
    () => check(value.get()),
  );
}
