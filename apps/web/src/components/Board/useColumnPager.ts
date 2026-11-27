import { useReducedMotion } from 'motion/react';
import { useLayoutEffect, useRef, useState } from 'react';
import { afterPaint } from '@/lib/motion';
import { pageStride } from './drag';
import type { Status } from './model';
import { usePagerPage } from './usePagerPage';

/** How long a turn the board makes itself keeps trying while a fling's snap settles. */
const SETTLE_MS = 1500;

/**
 * The columns a pager pages through: the active statuses not folded. One always stays, so
 * a board whose every column was folded on a desktop shows its first here.
 */
export function phoneColumns(statuses: Status[], isCollapsed: (id: string) => boolean) {
  const open = statuses.filter((status) => !isCollapsed(status.id));
  return open.length > 0 || statuses.length === 0 ? open : statuses.slice(0, 1);
}

/** A board whose columns fold: all of them, in order, and how one folds or opens. */
export type Folding = {
  statuses: Status[];
  onCollapse: (statusId: string) => void;
  onExpand: (statusId: string) => void;
};

/**
 * One column a page: the phone board's pager, and the compact board beside a task on a narrow
 * desktop or an unfolded foldable. Folded columns are skipped; a column folded or opened
 * beside the current one leaves the pager on the column it was on, and opening a folded one
 * turns to it.
 *
 * `start` is the column to open on, for a board that takes over from another layout.
 */
export function useColumnPager(
  statuses: Status[],
  {
    isCollapsed,
    setCollapsed,
  }: {
    isCollapsed: (id: string) => boolean;
    setCollapsed: (id: string, collapsed: boolean) => void;
  },
  start?: string | null,
) {
  const reduced = useReducedMotion();
  const pagerRef = useRef<HTMLDivElement>(null);
  const pages = phoneColumns(statuses, isCollapsed);
  const [first] = useState(() =>
    Math.max(
      0,
      pages.findIndex(({ id }) => id === start),
    ),
  );
  const [scrolled, pager, quietPager, placePager] = usePagerPage(first);
  const page = Math.min(scrolled, Math.max(0, pages.length - 1));

  function turnTo(index: number, behavior: ScrollBehavior = 'smooth') {
    quietPager();
    const element = pagerRef.current;
    element?.scrollTo({
      left: index * pageStride(element),
      behavior: reduced ? 'instant' : behavior,
    });
  }

  // Opens on the column it took over, before the first paint.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the first page, once
  useLayoutEffect(() => {
    const element = pagerRef.current;
    if (element && first > 0) element.scrollLeft = first * pageStride(element);
  }, []);

  // The column on screen, and the one a tap on a folded column asked to turn to.
  const shown = useRef<string | undefined>(pages[first]?.id);
  const turning = useRef<string | null>(null);
  const pageKey = pages.map(({ id }) => id).join(' ');
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the pages themselves change
  useLayoutEffect(() => {
    const element = pagerRef.current;
    const anchor = pages.findIndex(({ id }) => id === shown.current);
    const target = pages.findIndex(({ id }) => id === turning.current);
    turning.current = null;
    // A column folded or opened beside this one leaves the board on the column it was on; a
    // folded current column gives its place to the next.
    const anchored = element !== null && anchor !== -1 && anchor !== page;
    if (anchored) {
      element.scrollTo({ left: anchor * pageStride(element), behavior: 'instant' });
      placePager(anchor);
    }
    shown.current = pages[target !== -1 ? target : anchor !== -1 ? anchor : page]?.id;
    if (target === -1) return;
    if (!anchored || !element) return turnTo(target);
    return turnSettled(element, target);
  }, [pageKey]);

  /**
   * Turns to a page once the pager has taken a new page before the current one. Chrome snaps
   * back to the column it was on after the layout, and a fling's snap still settling does the
   * same, either of which stops a turn begun meanwhile: the turn is made again when the pager
   * comes to rest elsewhere, unless a finger takes it first.
   */
  function turnSettled(element: HTMLElement, target: number) {
    const until = performance.now() + SETTLE_MS;
    const ended = () => {
      const off = Math.abs(element.scrollLeft - target * pageStride(element)) > 1;
      if (off && performance.now() < until) turnTo(target);
      else stop();
    };
    const cancel = afterPaint(() => turnTo(target));
    function stop() {
      cancel();
      element.removeEventListener('scrollend', ended);
      element.removeEventListener('touchstart', stop);
    }
    element.addEventListener('scrollend', ended);
    element.addEventListener('touchstart', stop, { passive: true });
    return stop;
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the turns; the effect above follows the pages
  useLayoutEffect(() => {
    shown.current = pages[page]?.id;
  }, [page]);

  const folding: Folding = {
    statuses,
    onCollapse: (id) => {
      // The last column on screen stays: the pager is never empty.
      if (pages.length > 1) setCollapsed(id, true);
    },
    onExpand: (id) => {
      // Every column folded on a desktop shows only the first here; it stays as another opens.
      for (const status of pages) setCollapsed(status.id, false);
      setCollapsed(id, false);
      turning.current = id;
    },
  };

  return { pagerRef, pages, page, pager, turnTo, folding };
}
