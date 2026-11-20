import {
  type MotionValue,
  motion,
  useIsPresent,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react';
import { type ReactNode, useCallback, useEffect, useSyncExternalStore } from 'react';
import { ScrollArea, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import { afterPaint, animateSteadySpring, springs, stopSteady } from '@/lib/motion';
import { columnFits, columnOpacity, columnProgress, columnSpace, foldHeight } from './taskColumn';

/**
 * Springs `value` to `target` by painted frames, or sets it at once when `animate` is off. A
 * change of target mid-way continues from where the value is. The spring starts once the
 * frame that changed the layout has been drawn, so that work is not taken out of its time.
 * Held, the value stays where it is.
 */
function useSteadyTarget(
  value: MotionValue<number>,
  target: number,
  animate: boolean,
  held: boolean,
) {
  useEffect(() => {
    if (held) {
      stopSteady(value);
      return;
    }
    if (!animate) {
      stopSteady(value);
      value.jump(target);
      return;
    }
    if (value.get() === target) return;
    const cancel = afterPaint(() => {
      void animateSteadySpring(value, target, springs.pane);
    });
    return () => {
      cancel();
      stopSteady(value);
    };
  }, [value, target, animate, held]);
}

/** Re-renders only when `check` of the value changes, not on every frame of its motion. */
function useMotionCheck(value: MotionValue<number>, check: (value: number) => boolean) {
  return useSyncExternalStore(
    useCallback((listener: () => void) => value.on('change', listener), [value]),
    () => check(value.get()),
  );
}

export type TaskColumnLayout = {
  /** The pane is wide enough for the column. */
  fits: boolean;
  /** The column is where the extras are: it fits and has something in it. */
  open: boolean;
  /** How far the pane's layout is to the side: the inline copies of the extras fold with it. */
  inline: MotionValue<number>;
  /** How far the column is shut: the inline subtask slot unfolds with it. */
  closed: MotionValue<number>;
  /** Space the card leaves beside itself for the column. */
  space: MotionValue<number>;
  opacity: MotionValue<number>;
  visibility: MotionValue<'hidden' | 'visible'>;
  /** Mounted while it can open, or is still shutting, so its last extra can close it. */
  columnMounted: boolean;
  /** Mounted while the inline copies are showing, or are about to. */
  inlineMounted: boolean;
};

/**
 * Chooses both endpoint layouts before anything moves, as Catch's split view does: crossing
 * the width springs the layout to the side or back, and the first extra or the last one
 * removed springs the column open or shut. The card makes room on those springs while the
 * inline copies fold and the column fades in, so nothing stretches and then snaps.
 *
 * `ready` holds the extras' spring until what they are counted from has loaded, so opening a
 * task does not replay the column's entry; until then they take their place at once.
 */
export function useTaskColumn({
  paneWidth,
  hasExtras,
  ready,
}: {
  paneWidth: number | null;
  hasExtras: boolean;
  ready: boolean;
}): TaskColumnLayout {
  const fits = columnFits(paneWidth);
  const reduced = useReducedMotion() ?? false;
  // A task sliding away as another replaces it keeps its layout: adding a subtask lists it
  // on the parent just before the new subtask's page pushes the parent off.
  const leaving = !useIsPresent();
  const layout = useMotionValue(fits ? 1 : 0);
  const shown = useMotionValue(hasExtras ? 1 : 0);
  useSteadyTarget(layout, fits ? 1 : 0, !reduced, leaving);
  useSteadyTarget(shown, hasExtras ? 1 : 0, !reduced && ready, leaving);
  const progress = useTransform(() => columnProgress(layout.get(), shown.get()));
  const space = useTransform(() => columnSpace(progress.get()));
  const opacity = useTransform(() => columnOpacity(progress.get()));
  const visibility = useTransform(() => (progress.get() === 0 ? 'hidden' : 'visible'));
  // A new extra follows only the layout, so with the column there it goes straight to it
  // rather than showing inline first.
  const inline = useTransform(() => 1 - layout.get());
  const closed = useTransform(() => 1 - progress.get());
  const columnMounted = useMotionCheck(layout, (value) => value > 0) || fits;
  const inlineMounted = useMotionCheck(layout, (value) => value < 1) || !fits;
  return {
    fits,
    open: fits && hasExtras,
    inline,
    closed,
    space,
    opacity,
    visibility,
    columnMounted,
    inlineMounted,
  };
}

/**
 * An inline copy that folds away by `amount` (1 shown, 0 gone) while its column copy takes
 * over. It is measured whenever its content changes, so it folds from its real height in
 * either direction. Hidden, it is inert and out of the accessibility tree, so only one copy of
 * each control can be reached.
 */
export function Fold({
  amount,
  hidden,
  children,
  ...props
}: {
  amount: MotionValue<number>;
  hidden: boolean;
  children?: ReactNode;
  'data-fold'?: string;
}) {
  const measured = useMotionValue(0);
  const measure = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return;
      const update = () => measured.set(element.getBoundingClientRect().height);
      update();
      const observer = new ResizeObserver(update);
      observer.observe(element);
      return () => observer.disconnect();
    },
    [measured],
  );
  const height = useTransform(() => foldHeight(amount.get(), measured.get()));
  // Clipped only while folding, so focus rings show at rest.
  const overflow = useTransform(() => (amount.get() >= 1 ? 'visible' : 'hidden'));
  const visibility = useTransform(() => (amount.get() <= 0 ? 'hidden' : 'visible'));
  return (
    <motion.div
      {...props}
      inert={hidden}
      aria-hidden={hidden || undefined}
      style={{ height, overflow, visibility, opacity: amount }}
    >
      {/* A flow root, so its children's margins are measured with it. */}
      <div ref={measure} className="flow-root">
        {children}
      </div>
    </motion.div>
  );
}

/**
 * The card with the column beside it. Both stop above the dock, and only the space the card
 * leaves changes, never its height or its scroller.
 */
export function TaskColumnFrame({
  layout,
  card,
  children,
}: {
  layout: TaskColumnLayout;
  card: ReactNode;
  /** The extras, in order: tags, then subtasks, then whatever joins them. */
  children: ReactNode;
}) {
  return (
    <motion.div className="relative flex min-h-0 flex-1" style={{ paddingRight: layout.space }}>
      {card}
      {layout.columnMounted && (
        // Kept mounted while empty, so removing the last extra can spring it shut.
        <motion.aside
          aria-label="Task sidebar"
          data-task-column=""
          inert={!layout.open}
          aria-hidden={!layout.open || undefined}
          className="absolute inset-y-0 right-0 min-h-0 overflow-hidden"
          style={{
            width: layout.space,
            opacity: layout.opacity,
            visibility: layout.visibility,
          }}
        >
          {/* At its full width throughout, so its content never reflows as it opens. */}
          <div className="absolute inset-y-0 right-0 w-64">
            <ScrollArea className="h-full [--scrollbar-inset:0.5rem]">
              <ScrollAreaViewport>
                <div className="flex flex-col gap-6 p-1 pb-6">{children}</div>
              </ScrollAreaViewport>
              <ScrollBar />
            </ScrollArea>
          </div>
        </motion.aside>
      )}
    </motion.div>
  );
}
