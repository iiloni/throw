import {
  type AnimationPlaybackControls,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
} from 'motion/react';
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { curves, springs } from '@/lib/motion';

/** How far content settles as it arrives, as Catch's entries do. */
const SETTLE = 10;
/** Leaving content clears out quickly, so the height closes on an empty space. */
const leave = { duration: 0.16, ease: curves.enter.ease };

/**
 * Shows or hides its content in place. Opening grows the height on the pane spring while the
 * content settles in; closing fades the content first and then closes the height. A change
 * takes over from wherever the last one had got to, and reduced motion switches at once.
 *
 * Closed content stays mounted under `hidden`, so whatever is being written there survives.
 * Once open the height is the content's own: a change inside does not animate it.
 */
export function Collapse({
  open,
  onRest,
  className,
  children,
}: {
  open: boolean;
  /** Called once opened content is laid out at its full height, or closed content hidden. */
  onRest?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  const content = useRef<HTMLDivElement>(null);
  const height = useMotionValue(0);
  const opacity = useMotionValue(open ? 1 : 0);
  const y = useMotionValue(open ? 0 : SETTLE);
  // Moving starts in the same render as the change, so closing content is not hidden early.
  const [target, setTarget] = useState(open);
  const [moving, setMoving] = useState(false);
  if (target !== open) {
    setTarget(open);
    setMoving(!reducedMotion);
  }
  const growing = useRef<{ to: number; controls: AnimationPlaybackControls } | null>(null);
  const restRef = useRef(onRest);
  restRef.current = onRest;
  const handled = useRef(open);
  const reduced = useRef(reducedMotion);
  reduced.current = reducedMotion;

  const grow = useCallback(
    (to: number) => {
      growing.current?.controls.stop();
      growing.current = {
        to,
        controls: animate(height, to, {
          ...springs.pane,
          onComplete: () => {
            growing.current = null;
            setMoving(false);
            restRef.current?.(true);
          },
        }),
      };
    },
    [height],
  );

  // While open the height tracks the content: at rest, so a close starts from the right
  // place, and while growing, so content that lays out late (an editor) is not cut short.
  useLayoutEffect(() => {
    const element = content.current;
    if (!open || !element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const to = element.offsetHeight;
      if (!growing.current) height.set(to);
      else if (growing.current.to !== to) grow(to);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [open, height, grow]);

  useLayoutEffect(() => {
    const element = content.current;
    if (handled.current === open || !element) return;
    handled.current = open;
    if (reduced.current) {
      height.set(open ? element.offsetHeight : 0);
      opacity.set(open ? 1 : 0);
      y.set(open ? 0 : SETTLE);
      setMoving(false);
      restRef.current?.(open);
      return;
    }
    const controls: AnimationPlaybackControls[] = [];
    if (open) {
      // From fully closed the room opens a moment ahead of the content settling into it.
      const delay = height.get() < 1 ? 0.06 : 0;
      grow(element.offsetHeight);
      controls.push(
        animate(opacity, 1, { ...curves.enter, delay }),
        animate(y, 0, { ...curves.enter, delay }),
      );
    } else {
      growing.current?.controls.stop();
      growing.current = null;
      controls.push(
        animate(opacity, 0, leave),
        animate(y, SETTLE, leave),
        animate(height, 0, {
          ...springs.pane,
          delay: opacity.get() > 0.5 ? 0.1 : 0,
          onComplete: () => {
            setMoving(false);
            restRef.current?.(false);
          },
        }),
      );
    }
    return () => {
      for (const control of controls) control.stop();
    };
  }, [open, height, opacity, y, grow]);

  useLayoutEffect(() => () => growing.current?.controls.stop(), []);

  const atRest = !moving;
  return (
    <motion.div
      hidden={!open && atRest}
      // Content on its way out can no longer be reached.
      inert={!open}
      data-collapse={open ? (atRest ? 'open' : 'opening') : atRest ? 'closed' : 'closing'}
      // `clip` is not a scroll container, so scrolling an entry into view cannot scroll it.
      style={
        open && atRest ? { height: 'auto', overflow: 'visible' } : { height, overflow: 'clip' }
      }
      className={className}
    >
      <motion.div ref={content} style={{ opacity, y }} className="flow-root">
        {children}
      </motion.div>
    </motion.div>
  );
}
