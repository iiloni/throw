import { animate, type MotionValue, useReducedMotion } from 'motion/react';
import { type RefObject, useEffect, useRef } from 'react';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';

const RELEASE_DISTANCE = 90;
const MOVE_TOLERANCE = 12;
const TOUCH_MOVE_TOLERANCE = 4;
const HOLD_DELAY = 300;
/** How much of an upward pull the card follows, and the furthest it rises. */
const PULL_UP = 0.3;
export const MAX_LIFT = -56;
/** Where the card has risen to when a pull up is far enough to expand on release. */
export const RELEASE_LIFT = -RELEASE_DISTANCE * PULL_UP;

/**
 * Catch's quick-note swipe gesture adapted for Throw's mobile capture card: touch can start
 * anywhere on the card (yielding to textarea scrolling, text selection and long presses);
 * mouse dragging stays on the handle. Pulling up expands into the full task view; pulling
 * down or flicking down dismisses capture.
 */
export function useCaptureSwipe({
  surface,
  handle,
  y,
  enabled,
  canExpand = true,
  onDismiss,
  onExpand,
}: {
  surface: RefObject<HTMLElement | null>;
  handle: RefObject<HTMLDivElement | null>;
  y: MotionValue<number>;
  enabled: boolean;
  /** Whether pulling up can commit an expand; false still lets the card pull down to dismiss. */
  canExpand?: boolean;
  onDismiss: () => void;
  /** Return `false` if expanding was blocked so the card returns to rest. */
  onExpand: () => boolean | undefined;
}) {
  const reduced = useReducedMotion();
  const latest = useRef({ canExpand, onDismiss, onExpand, reduced: !!reduced });
  latest.current = { canExpand, onDismiss, onExpand, reduced: !!reduced };

  useEffect(() => {
    const element = surface.current;
    const grip = handle.current;
    if (!element || !grip || !enabled) return;

    let state: {
      startX: number;
      startY: number;
      startTime: number;
      lastY: number;
      lastTime: number;
      velocity: number;
      armed: -1 | 0 | 1;
      dragging: boolean;
      editing: boolean;
      canPullUp: boolean;
      canPullDown: boolean;
    } | null = null;
    let suppressClick = false;
    let clickTimer: ReturnType<typeof setTimeout> | undefined;
    let touchTarget: Element | null = null;

    function clearTouchTarget() {
      touchTarget?.removeEventListener('touchmove', onTouchMove as EventListener);
      touchTarget?.removeEventListener('touchend', onTouchEnd as EventListener);
      touchTarget?.removeEventListener('touchcancel', onTouchEnd as EventListener);
      touchTarget = null;
    }

    function resetY() {
      if (latest.current.reduced) {
        y.stop();
        y.jump(0);
      } else {
        animate(y, 0, springs.snappy);
      }
    }

    function hasSelection(target?: EventTarget | null) {
      for (const candidate of [target, document.activeElement]) {
        if (
          (candidate instanceof HTMLTextAreaElement || candidate instanceof HTMLInputElement) &&
          element?.contains(candidate) &&
          candidate.selectionStart !== null &&
          candidate.selectionEnd !== null &&
          candidate.selectionStart !== candidate.selectionEnd
        )
          return true;
      }
      const selection = window.getSelection();
      return Boolean(
        selection &&
          !selection.isCollapsed &&
          (element?.contains(selection.anchorNode) || element?.contains(selection.focusNode)),
      );
    }

    function releaseClick() {
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        suppressClick = false;
      }, 400);
    }

    function cancel() {
      clearTouchTarget();
      if (state?.dragging) {
        resetY();
        releaseClick();
      }
      state = null;
    }

    function start(x: number, clientY: number, time: number, target: EventTarget | null) {
      cancel();
      clearTimeout(clickTimer);
      suppressClick = false;
      if (!(target instanceof Element)) return;
      const editing = !grip?.contains(target);
      // Native non-title controls and an existing text selection own their gestures.
      if (editing && (hasSelection(target) || target.closest('input, select, [role="slider"]')))
        return;
      let canPullUp = true;
      let canPullDown = true;
      for (
        let parent: Element | null = target;
        parent && parent !== element;
        parent = parent.parentElement
      ) {
        const scrollable =
          /(auto|scroll)/.test(getComputedStyle(parent).overflowY) ||
          (parent instanceof HTMLTextAreaElement && parent.scrollHeight > parent.clientHeight + 1);
        if (!scrollable) continue;
        canPullDown &&= parent.scrollTop <= 1;
        canPullUp &&= parent.scrollTop + parent.clientHeight >= parent.scrollHeight - 1;
      }
      state = {
        startX: x,
        startY: clientY,
        startTime: time,
        lastY: clientY,
        lastTime: time,
        velocity: 0,
        armed: 0,
        dragging: false,
        editing,
        canPullUp,
        canPullDown,
      };
    }

    function move(x: number, clientY: number, event: TouchEvent | PointerEvent) {
      if (!state) return;
      if (event.defaultPrevented || !event.cancelable) return cancel();
      const delta = clientY - state.startY;
      if (!state.dragging) {
        // Holding belongs to text selection or a tool's label.
        if (state.editing && (event.timeStamp - state.startTime >= HOLD_DELAY || hasSelection()))
          return cancel();
        const deltaX = x - state.startX;
        // Android's first touchmove can be only ~8 CSS pixels. Claim an eligible
        // pull then: allowing it through makes subsequent moves non-cancelable.
        const tolerance = event.type === 'touchmove' ? TOUCH_MOVE_TOLERANCE : MOVE_TOLERANCE;
        if (Math.hypot(deltaX, delta) < tolerance) return;
        if (
          Math.abs(delta) < Math.abs(deltaX) * 1.3 ||
          (delta < 0 && !state.canPullUp) ||
          (delta > 0 && !state.canPullDown)
        )
          return cancel();
        state.dragging = true;
        y.stop();
        suppressClick = true;
      }
      // Focus is left alone until an action is released, so a short pull keeps typing intact.
      event.preventDefault();
      state.velocity = (clientY - state.lastY) / Math.max(1, event.timeStamp - state.lastTime);
      state.lastY = clientY;
      state.lastTime = event.timeStamp;
      y.set(delta < 0 ? Math.max(delta * PULL_UP, MAX_LIFT) : Math.min(delta * 0.5, 100));
      const armed =
        delta > RELEASE_DISTANCE
          ? 1
          : delta < -RELEASE_DISTANCE && latest.current.canExpand
            ? -1
            : 0;
      if (armed !== state.armed) {
        state.armed = armed;
        if (armed) haptics.threshold();
      }
    }

    function blurCardFocus() {
      const active = document.activeElement;
      if (active instanceof HTMLElement && element?.contains(active)) active.blur();
    }

    function end(time: number, cancelled: boolean) {
      const gesture = state;
      state = null;
      if (!gesture?.dragging) return;
      releaseClick();
      const delta = gesture.lastY - gesture.startY;
      const flung = delta >= 24 && gesture.velocity > 0.6 && time - gesture.lastTime < 100;
      if (
        !cancelled &&
        ((delta < -RELEASE_DISTANCE && latest.current.canExpand) ||
          delta > RELEASE_DISTANCE ||
          flung)
      ) {
        if (delta < 0) {
          if (latest.current.onExpand() === false) {
            resetY();
            return;
          }
          blurCardFocus();
        } else {
          blurCardFocus();
          latest.current.onDismiss();
        }
      } else {
        resetY();
      }
    }

    function onTouchStart(event: TouchEvent) {
      // Keep touches on the floating card from reaching the parent drawer's pull gesture
      // when a picker page is open beneath the dock.
      event.stopPropagation();
      const touch = event.touches[0];
      if (event.touches.length !== 1 || !touch) return cancel();
      start(touch.clientX, touch.clientY, event.timeStamp, event.target);
      if (!state || !(event.target instanceof Element)) return;
      touchTarget = event.target;
      touchTarget.addEventListener('touchmove', onTouchMove as EventListener, { passive: false });
      touchTarget.addEventListener('touchend', onTouchEnd as EventListener);
      touchTarget.addEventListener('touchcancel', onTouchEnd as EventListener);
    }
    function onTouchMove(event: TouchEvent) {
      const touch = event.touches[0];
      if (event.touches.length !== 1 || !touch) return cancel();
      move(touch.clientX, touch.clientY, event);
    }
    function onTouchEnd(event: TouchEvent) {
      clearTouchTarget();
      end(
        event.timeStamp,
        event.defaultPrevented || event.type === 'touchcancel' || event.touches.length !== 0,
      );
    }
    function onPointerDown(event: PointerEvent) {
      if (event.pointerType === 'touch' || event.button !== 0) return;
      event.stopPropagation();
      try {
        grip?.setPointerCapture?.(event.pointerId);
      } catch {
        // Synthetic pointer events without an active pointer id cannot be captured.
      }
      start(event.clientX, event.clientY, event.timeStamp, event.target);
    }
    function onPointerMove(event: PointerEvent) {
      if (event.pointerType !== 'touch') move(event.clientX, event.clientY, event);
    }
    function onPointerEnd(event: PointerEvent) {
      if (event.pointerType !== 'touch') end(event.timeStamp, event.type === 'pointercancel');
    }
    function onClick(event: MouseEvent) {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }

    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('click', onClick, true);
    grip.addEventListener('pointerdown', onPointerDown);
    grip.addEventListener('pointermove', onPointerMove);
    grip.addEventListener('pointerup', onPointerEnd);
    grip.addEventListener('pointercancel', onPointerEnd);
    return () => {
      clearTimeout(clickTimer);
      clearTouchTarget();
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('click', onClick, true);
      grip.removeEventListener('pointerdown', onPointerDown);
      grip.removeEventListener('pointermove', onPointerMove);
      grip.removeEventListener('pointerup', onPointerEnd);
      grip.removeEventListener('pointercancel', onPointerEnd);
    };
  }, [surface, handle, y, enabled]);
}
