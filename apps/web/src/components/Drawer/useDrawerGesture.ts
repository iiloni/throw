import { type RefObject, useEffect, useRef } from 'react';

type Point = { x: number; y: number; time: number };
type Pull = Point & {
  target: HTMLElement;
  start: Point;
  vertical: boolean;
  dragging: boolean;
  offset: number;
  velocity: number;
};

/** Native scrolling keeps the gesture until every scrollable ancestor reaches its edge. */
function canScroll(target: HTMLElement, surface: HTMLElement, dy: number) {
  for (
    let element: HTMLElement | null = target;
    element && element !== surface;
    element = element.parentElement
  ) {
    if (!/(auto|scroll)/.test(getComputedStyle(element).overflowY)) continue;
    if (
      dy > 0
        ? element.scrollTop > 1
        : element.scrollTop + element.clientHeight < element.scrollHeight - 1
    )
      return true;
  }
  return false;
}

export function useDrawerGesture(
  surface: RefObject<HTMLElement | null>,
  {
    disabled,
    onMove,
    onEnd,
    onCancel,
  }: {
    disabled: boolean;
    onMove: (dy: number) => void;
    onEnd: (offset: number, velocity: number) => void;
    onCancel: () => void;
  },
) {
  const latest = useRef({ disabled, onMove, onEnd, onCancel });
  latest.current = { disabled, onMove, onEnd, onCancel };

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    let pull: Pull | null = null;
    let pointerId: number | null = null;
    let suppressClickUntil = 0;

    function start(target: EventTarget | null, point: Point) {
      suppressClickUntil = 0;
      if (latest.current.disabled || !(target instanceof Element)) return;
      const origin = target instanceof HTMLElement ? target : target.parentElement;
      if (!origin) return;
      // Text selection and range controls own their gestures.
      if (origin.closest('input, textarea, [contenteditable="true"], [role="slider"]')) return;
      pull = {
        ...point,
        target: origin,
        start: point,
        vertical: false,
        dragging: false,
        offset: 0,
        velocity: 0,
      };
    }

    function move(event: Event, point: Point) {
      if (!pull) return;
      if (latest.current.disabled) {
        cancel();
        return;
      }
      const dy = point.y - pull.y;
      if (!pull.vertical) {
        const dx = point.x - pull.start.x;
        const totalY = point.y - pull.start.y;
        if (Math.hypot(dx, totalY) < 8) return;
        if (Math.abs(dx) >= Math.abs(totalY)) {
          pull = null;
          return;
        }
        pull.vertical = true;
      }
      if (dy !== 0 && (pull.dragging || !canScroll(pull.target, element!, dy))) {
        if (event.cancelable) event.preventDefault();
        pull.dragging = true;
        pull.offset += dy;
        pull.velocity = (dy / Math.max(1, point.time - pull.time)) * 1000;
        latest.current.onMove(dy);
      }
      Object.assign(pull, point);
    }

    function end() {
      if (pull?.dragging) {
        suppressClickUntil = performance.now() + 400;
        latest.current.onEnd(pull.offset, performance.now() - pull.time < 100 ? pull.velocity : 0);
      }
      pull = null;
      pointerId = null;
    }

    function cancel() {
      if (pull?.dragging) latest.current.onCancel();
      pull = null;
      pointerId = null;
    }

    const touchPoint = (touch: Touch): Point => ({
      x: touch.clientX,
      y: touch.clientY,
      time: performance.now(),
    });
    const pointerPoint = (event: PointerEvent): Point => ({
      x: event.clientX,
      y: event.clientY,
      time: performance.now(),
    });
    function touchStart(event: TouchEvent) {
      if (event.touches.length !== 1) return cancel();
      start(event.target, touchPoint(event.touches[0]!));
    }
    function touchMove(event: TouchEvent) {
      if (event.touches.length !== 1) return cancel();
      move(event, touchPoint(event.touches[0]!));
    }
    function pointerStart(event: PointerEvent) {
      if (event.pointerType === 'touch' || event.button !== 0) return;
      // Mouse drags on prototype cards belong to the card's carry engine.
      if (event.target instanceof Element && event.target.closest('[data-card-id]')) return;
      pointerId = event.pointerId;
      start(event.target, pointerPoint(event));
    }
    function pointerMove(event: PointerEvent) {
      if (event.pointerId === pointerId) move(event, pointerPoint(event));
    }
    function pointerEnd(event: PointerEvent) {
      if (event.pointerId === pointerId) end();
    }
    function pointerCancel(event: PointerEvent) {
      if (event.pointerId === pointerId) cancel();
    }
    function click(event: MouseEvent) {
      if (event.detail === 0 || performance.now() > suppressClickUntil) return;
      event.preventDefault();
      event.stopPropagation();
    }

    // React's touch listeners are passive. Register before the gesture starts so an edge
    // pull can cancel scrolling without disabling native scrolling throughout the drawer.
    element.addEventListener('touchstart', touchStart, { passive: true });
    element.addEventListener('touchmove', touchMove, { passive: false });
    element.addEventListener('touchend', end);
    element.addEventListener('touchcancel', cancel);
    element.addEventListener('pointerdown', pointerStart);
    element.addEventListener('click', click, true);
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', pointerEnd);
    window.addEventListener('pointercancel', pointerCancel);
    return () => {
      element.removeEventListener('touchstart', touchStart);
      element.removeEventListener('touchmove', touchMove);
      element.removeEventListener('touchend', end);
      element.removeEventListener('touchcancel', cancel);
      element.removeEventListener('pointerdown', pointerStart);
      element.removeEventListener('click', click, true);
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerEnd);
      window.removeEventListener('pointercancel', pointerCancel);
    };
  }, [surface]);
}
