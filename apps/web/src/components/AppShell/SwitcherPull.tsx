import { Layers } from 'lucide-react';
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { drag, isPrimed } from '@/components/Board/drag';
import { board } from '@/components/Board/state';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';

/** Finger travel past this distance opens the switcher on release. */
export const RELEASE_DISTANCE = 90;
/** How far the pill has been drawn by then: it arrives exactly as letting go starts to act. */
const ARRIVED = RELEASE_DISTANCE * 0.5;
const MAX_PULL = 64;
/** Android's first touchmove can already be this far along; a later claim is not cancelable. */
const MOVE_TOLERANCE = 4;
/** A touch held this long before moving belongs to a card's long press (`Board/drag.ts`). */
const HOLD_MS = 260;

const PULL = 'Pull to switch projects';
const RELEASE = 'Release to switch projects';

/**
 * Whether a touch beginning on `target` may start a pull: nothing covers the board (an open
 * task, a page or card in the drawer, a raised backlog, a dialog), no card is held or
 * selected, and everything under the finger is scrolled to its top.
 */
export function canPull(target: EventTarget | null, surface: Element) {
  if (!(target instanceof Element) || !surface.contains(target)) return false;
  const state = board.get();
  if (state.openTaskId !== null || state.selection.length > 0) return false;
  if (drag.get() || isPrimed()) return false;
  if (window.scrollY > 1) return false;
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) return false;
  if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return false;
  if (
    document.querySelector('[data-drawer][data-detent="half"], [data-drawer][data-detent="full"]')
  )
    return false;
  if (
    target.closest(
      'input, textarea, select, [contenteditable], [role="slider"], [data-drawer], [data-no-pull]',
    )
  )
    return false;
  for (
    let parent: Element | null = target;
    parent && parent !== surface;
    parent = parent.parentElement
  ) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollTop > 1)
      return false;
  }
  return true;
}

/**
 * Pulling down at the top of a phone board opens the project switcher on release, as Catch's
 * page pull acts (`PagePull`): a glass pill drawn down from above the screen says what letting
 * go will do, with a haptic as it arms. Only distance commits, never a fling, and a sideways
 * start belongs to the board's column swipes, a still hold to a card's long press.
 */
export function SwitcherPull({
  surface,
  enabled,
  onOpen,
}: {
  /** Where a pull may begin: the board's page. */
  surface: RefObject<HTMLElement | null>;
  enabled: boolean;
  onOpen: () => void;
}) {
  const pull = useMotionValue(0);
  const reducedMotion = useReducedMotion() ?? false;
  const pill = useRef<HTMLDivElement>(null);
  // From just above the screen, so it passes over the status bar. Measured as a pull starts,
  // in pixels, since a percentage would resolve against Android's changing insets.
  const hiddenY = useRef(0);
  const y = useTransform(() => {
    if (reducedMotion) return 0;
    const travel = pull.get();
    return (
      hiddenY.current * (1 - Math.min(travel, ARRIVED) / ARRIVED) + Math.max(0, travel - ARRIVED)
    );
  });
  // Fading keeps its shadow out of view at rest; it is all reduced motion gets. On the pill
  // itself, because opacity on an ancestor would stop the glass from blurring the board.
  const opacity = useTransform(pull, reducedMotion ? [12, 40] : [0, 12], [0, 1]);
  const width = useMotionValue<number | 'auto'>('auto');
  // The measured width springs, so the glass and its text never stretch.
  const measure = useCallback(
    (element: HTMLSpanElement | null) => {
      if (!element) return;
      const update = () => {
        const next = element.offsetWidth + 2;
        if (width.get() === 'auto' || reducedMotion) width.jump(next);
        else animate(width, next, springs.smooth);
      };
      update();
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(update);
      observer.observe(element);
      return () => observer.disconnect();
    },
    [width, reducedMotion],
  );
  const [armed, setArmed] = useState(false);
  const open = useRef(onOpen);
  open.current = onOpen;

  useEffect(() => {
    const root = surface.current;
    if (!root || !enabled) return;
    let gesture: {
      id: number;
      x: number;
      y: number;
      time: number;
      distance: number;
      dragging: boolean;
      armed: boolean;
    } | null = null;
    let suppressClick = false;
    let clickTimer: ReturnType<typeof setTimeout> | undefined;

    function springBack() {
      animate(pull, 0, {
        ...(reducedMotion ? { duration: 0 } : springs.snappy),
        onComplete: () => setArmed(false),
      });
    }

    function cancel() {
      if (gesture?.dragging) springBack();
      gesture = null;
    }

    function onStart(event: Event) {
      const { touches, target, timeStamp } = event as TouchEvent;
      cancel();
      clearTimeout(clickTimer);
      suppressClick = false;
      const touch = touches[0];
      if (touches.length !== 1 || !touch || !root || !canPull(target, root)) return;
      gesture = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        time: timeStamp,
        distance: 0,
        dragging: false,
        armed: false,
      };
    }

    function onMove(event: Event) {
      if (!gesture) return;
      const move = event as TouchEvent;
      const touch = move.touches[0];
      if (
        move.touches.length !== 1 ||
        touch?.identifier !== gesture.id ||
        move.defaultPrevented ||
        !move.cancelable ||
        // A card held still became a selection or a drag; the board has the touch now.
        isPrimed() ||
        drag.get()
      )
        return cancel();
      const dx = touch.clientX - gesture.x;
      const dy = touch.clientY - gesture.y;
      if (!gesture.dragging) {
        if (Math.hypot(dx, dy) < MOVE_TOLERANCE) return;
        // Sideways belongs to the column swipes, holding to a card's long press.
        if (dy < Math.abs(dx) * 1.3 || move.timeStamp - gesture.time >= HOLD_MS) {
          gesture = null;
          return;
        }
        gesture.dragging = true;
        suppressClick = true;
        pull.stop();
        const shape = pill.current;
        if (shape) hiddenY.current = -(shape.offsetTop + shape.offsetHeight + 8);
        setArmed(false);
      }
      move.preventDefault();
      gesture.distance = Math.max(0, dy);
      // Resistance: the pill follows at half the finger's pace, then stops.
      pull.set(Math.min(gesture.distance * 0.5, MAX_PULL));
      const past = gesture.distance > RELEASE_DISTANCE;
      if (past !== gesture.armed) {
        gesture.armed = past;
        setArmed(past);
        if (past) haptics.threshold();
      }
    }

    function onEnd(event: Event) {
      const { type, touches, defaultPrevented } = event as TouchEvent;
      const finished = gesture;
      gesture = null;
      if (!finished?.dragging) return;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        suppressClick = false;
      }, 400);
      springBack();
      if (finished.armed && type !== 'touchcancel' && !defaultPrevented && touches.length === 0)
        open.current();
    }

    function onClick(event: Event) {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }

    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchmove', onMove, { passive: false });
    root.addEventListener('touchend', onEnd);
    root.addEventListener('touchcancel', onEnd);
    root.addEventListener('click', onClick, true);
    return () => {
      cancel();
      clearTimeout(clickTimer);
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchmove', onMove);
      root.removeEventListener('touchend', onEnd);
      root.removeEventListener('touchcancel', onEnd);
      root.removeEventListener('click', onClick, true);
    };
  }, [surface, enabled, pull, reducedMotion]);

  const label = armed ? RELEASE : PULL;
  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center pt-[calc(var(--safe-top)+0.5rem)]"
    >
      <motion.div
        ref={pill}
        data-switcher-pull-pill=""
        data-armed={armed ? '' : undefined}
        style={{ width, y, opacity }}
        className="glass relative h-10 overflow-hidden rounded-full font-medium text-sm"
      >
        <AnimatePresence initial={false}>
          <motion.span
            key={label}
            ref={measure}
            className="absolute inset-y-0 left-1/2 flex w-max items-center gap-2 whitespace-nowrap px-4"
            style={{ x: '-50%' }}
            initial={{ opacity: 0, scale: 0.85, filter: 'blur(4px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={{
              opacity: 0,
              scale: 0.85,
              filter: 'blur(4px)',
              transition: { duration: reducedMotion ? 0 : 0.14 },
            }}
            transition={reducedMotion ? { duration: 0 } : springs.smooth}
          >
            <Layers className="size-4 text-muted-foreground" aria-hidden />
            {label}
          </motion.span>
        </AnimatePresence>
      </motion.div>
    </div>,
    document.body,
  );
}
