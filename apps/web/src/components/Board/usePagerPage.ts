import { type UIEvent, useCallback, useMemo, useRef, useState } from 'react';
import { haptics } from '@/lib/haptics';
import { drag, pageStride } from './drag';

/**
 * The page a phone pager rests on, from its scroll. Each new page a finger turns ticks, as
 * Catch's pager does. Turns the app makes itself (a tap on the flow track, a new project)
 * stay quiet, since the tap that asked for them was felt already, and so does a held card
 * turning pages, which the drag feels on its own.
 */
export function usePagerPage(first = 0) {
  const [page, setPage] = useState(first);
  const seen = useRef(first);
  const touched = useRef(false);
  const onScroll = useCallback((event: UIEvent<HTMLElement>) => {
    const next = Math.round(event.currentTarget.scrollLeft / pageStride(event.currentTarget));
    if (next === seen.current) return;
    seen.current = next;
    if (touched.current && !drag.get()) haptics.selection();
    setPage(next);
  }, []);
  const pager = useMemo(
    () => ({
      onScroll,
      onTouchStart: () => {
        touched.current = true;
      },
      // Momentum has finished what the finger started.
      onScrollEnd: () => {
        touched.current = false;
      },
    }),
    [onScroll],
  );
  /** Call before turning the pager from code. */
  const quiet = useCallback(() => {
    touched.current = false;
  }, []);
  /** Call after moving the pager to a page from code, so what shows it does not wait a frame. */
  const place = useCallback((index: number) => {
    touched.current = false;
    seen.current = index;
    setPage(index);
  }, []);
  return [page, pager, quiet, place] as const;
}
