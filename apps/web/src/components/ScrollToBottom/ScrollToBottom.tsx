import { ArrowDown } from 'lucide-react';
import { AnimatePresence, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { FloatingToolbar } from '@/components/FloatingToolbar/FloatingToolbar';
import { IconButton } from '@/components/IconButton/IconButton';
import { haptics } from '@/lib/haptics';

/** How far the end must be out of view before the jump is offered, as in Catch. */
export const END_FAR = 160;

/** Whether `element` has content scrolled out at its top or bottom, and its end well away. */
export interface ScrollEdges {
  top: boolean;
  bottom: boolean;
  far: boolean;
}

const NO_EDGES: ScrollEdges = { top: false, bottom: false, far: false };

/**
 * Catch's scroll edges for a full-screen page: what its top and bottom blurs and the jump to
 * the end follow. It follows scrolling and the content's size.
 */
export function useScrollEdges(element: HTMLElement | null): ScrollEdges {
  const [edges, setEdges] = useState(NO_EDGES);
  useEffect(() => {
    if (!element) {
      setEdges(NO_EDGES);
      return;
    }
    const update = () => {
      const below = element.scrollHeight - element.scrollTop - element.clientHeight;
      const top = element.scrollTop > 1;
      const bottom = below > 1;
      const far = below > END_FAR;
      setEdges((edges) =>
        edges.top === top && edges.bottom === bottom && edges.far === far
          ? edges
          : { top, bottom, far },
      );
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    if (element.firstElementChild) observer?.observe(element.firstElementChild);
    return () => {
      element.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [element]);
  return edges;
}

/**
 * A jump to the end of `element`, offered while its end is well out of view, or null. Pass
 * the `edges` already followed for the element to share them.
 */
export function useScrollToBottom(element: HTMLElement | null, edges?: ScrollEdges) {
  const own = useScrollEdges(edges ? null : element);
  const far = (edges ?? own).far;
  const reducedMotion = useReducedMotion();
  const jump = useCallback(() => {
    element?.scrollTo({
      top: element.scrollHeight,
      behavior: reducedMotion ? 'instant' : 'smooth',
    });
  }, [element, reducedMotion]);
  return far && element ? jump : null;
}

/**
 * Catch's jump to the end of the open task, floating above a phone's dock while `onJump` is
 * offered. `hidden` slides it away for something that takes its place.
 */
export function ScrollToBottom({
  onJump,
  hidden = false,
  className,
}: {
  onJump: (() => void) | null;
  hidden?: boolean;
  className?: string;
}) {
  return (
    <AnimatePresence>
      {onJump && !hidden && (
        <FloatingToolbar key="scroll" label="Scroll" from="right" className={className}>
          <IconButton
            label="Scroll to bottom"
            // Keep the selection and virtual keyboard while jumping down the task.
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              haptics.selection();
              onJump();
            }}
            tooltipSide="top"
            className="size-11 rounded-[calc(var(--dock-radius)-0.25rem)] [&_svg]:size-5"
          >
            <ArrowDown />
          </IconButton>
        </FloatingToolbar>
      )}
    </AnimatePresence>
  );
}
