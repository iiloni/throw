import { ArrowDown } from 'lucide-react';
import { AnimatePresence, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { FloatingToolbar } from '@/components/FloatingToolbar/FloatingToolbar';
import { IconButton } from '@/components/IconButton/IconButton';
import { haptics } from '@/lib/haptics';

/** How far the end must be out of view before the jump is offered, as in Catch. */
export const END_FAR = 160;

/**
 * A jump to the end of `element`, offered while its end is well out of view, or null. It
 * follows scrolling and the content's size.
 */
export function useScrollToBottom(element: HTMLElement | null) {
  const [far, setFar] = useState(false);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    if (!element) {
      setFar(false);
      return;
    }
    const update = () =>
      setFar(element.scrollHeight - element.scrollTop - element.clientHeight > END_FAR);
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
  const jump = useCallback(() => {
    element?.scrollTo({
      top: element.scrollHeight,
      behavior: reducedMotion ? 'instant' : 'smooth',
    });
  }, [element, reducedMotion]);
  return far ? jump : null;
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
