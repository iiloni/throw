import { animate, motionValue, useReducedMotion } from 'motion/react';
import { type RefObject, useEffect, useRef } from 'react';
import { drag, isPrimed } from '@/components/Board/drag';
import { board } from '@/components/Board/state';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { createStore } from '@/lib/store';

/** Finger travel past this distance opens the switcher on release. */
export const RELEASE_DISTANCE = 90;
/** How far the title follows the finger: half its travel, up to here. */
export const MAX_PULL = 64;
/** Android's first touchmove can already be this far along; a later claim is not cancelable. */
const MOVE_TOLERANCE = 4;
/** A touch held this long before moving belongs to a card's long press (`Board/drag.ts`). */
const HOLD_MS = 260;

/**
 * The pull in progress, which the phone title draws (`ShellMenu`): how far it has come, damped
 * to half the finger's travel up to `MAX_PULL`, and whether letting go would open the switcher.
 */
export const switcherPull = { travel: motionValue(0), armed: createStore(false) };

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
 * page pull acts (`PagePull`). The board's title is the cue: it follows the finger down and
 * says what letting go will do, with a haptic as it arms. Only distance commits, never a
 * fling, and a sideways start belongs to the board's column swipes, a still hold to a card's
 * long press.
 */
export function useSwitcherPull(
  /** Where a pull may begin: the board's page. */
  surface: RefObject<HTMLElement | null>,
  enabled: boolean,
  onOpen: () => void,
) {
  const reducedMotion = useReducedMotion() ?? false;
  const open = useRef(onOpen);
  open.current = onOpen;

  useEffect(() => {
    const root = surface.current;
    if (!root || !enabled) return;
    const { travel, armed } = switcherPull;
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
      armed.set(false);
      animate(travel, 0, reducedMotion ? { duration: 0 } : springs.snappy);
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
        travel.stop();
      }
      move.preventDefault();
      gesture.distance = Math.max(0, dy);
      // Resistance: the title follows at half the finger's pace, then stops.
      travel.set(Math.min(gesture.distance * 0.5, MAX_PULL));
      const past = gesture.distance > RELEASE_DISTANCE;
      if (past !== gesture.armed) {
        gesture.armed = past;
        armed.set(past);
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
  }, [surface, enabled, reducedMotion]);
}
