import { animate, type MotionValue, useMotionValue, useReducedMotion } from 'motion/react';
import { type RefObject, useCallback, useEffect, useMemo, useRef } from 'react';
import { springs } from '@/lib/motion';

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 2;
/** A pointer that moves this far is panning, not tapping. */
export const TAP_SLOP = 6;

export type Insets = { top: number; right: number; bottom: number; left: number };
export type View = { x: number; y: number; scale: number };
export type Size = { width: number; height: number };

export const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

/**
 * The view that shows the whole content inside the viewport, clear of what floats over its
 * edges, and no larger than its natural size: a small graph sits in the middle at 100%.
 */
export function fitView(content: Size, viewport: Size, insets: Insets, padding = 32): View {
  const room = {
    width: Math.max(1, viewport.width - insets.left - insets.right - padding * 2),
    height: Math.max(1, viewport.height - insets.top - insets.bottom - padding * 2),
  };
  const scale =
    content.width === 0 || content.height === 0
      ? 1
      : clampScale(Math.min(1, room.width / content.width, room.height / content.height));
  return {
    scale,
    x: insets.left + padding + (room.width - content.width * scale) / 2,
    y: insets.top + padding + (room.height - content.height * scale) / 2,
  };
}

/** The view scaled by `factor` with the point `at` (in viewport pixels) kept where it is. */
export function zoomAround(view: View, factor: number, at: { x: number; y: number }): View {
  const scale = clampScale(view.scale * factor);
  const ratio = scale / view.scale;
  return { scale, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio };
}

/**
 * The view moved as little as it can to bring a rectangle (in content coordinates) inside the
 * viewport, clear of its insets; unchanged when it is already in sight.
 */
export function revealRect(
  view: View,
  rect: { x: number; y: number; width: number; height: number },
  viewport: Size,
  insets: Insets,
  margin = 24,
): View {
  const left = view.x + rect.x * view.scale;
  const top = view.y + rect.y * view.scale;
  const right = left + rect.width * view.scale;
  const bottom = top + rect.height * view.scale;
  const minX = insets.left + margin;
  const maxX = viewport.width - insets.right - margin;
  const minY = insets.top + margin;
  const maxY = viewport.height - insets.bottom - margin;
  let dx = 0;
  let dy = 0;
  if (left < minX) dx = minX - left;
  else if (right > maxX) dx = Math.max(minX - left, maxX - right);
  if (top < minY) dy = minY - top;
  else if (bottom > maxY) dy = Math.max(minY - top, maxY - bottom);
  return dx === 0 && dy === 0 ? view : { ...view, x: view.x + dx, y: view.y + dy };
}

/** How far one wheel event zooms: a pinch on a trackpad sends small deltas with Ctrl held. */
export function wheelFactor(event: Pick<WheelEvent, 'deltaY' | 'deltaMode' | 'ctrlKey'>) {
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1);
  return Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0018));
}

export type Viewport = {
  x: MotionValue<number>;
  y: MotionValue<number>;
  scale: MotionValue<number>;
  get: () => View;
  /** Moves to a view, springing unless the motion is reduced or `instant`. */
  go: (view: View, instant?: boolean) => void;
  /** Whether the pointer that just lifted panned, so its click must not open a node. */
  panned: () => boolean;
  /**
   * Set once a gesture or a zoom button has moved the view away from a fit; while it is not,
   * the graph fits itself again as it or the window changes.
   */
  touched: { current: boolean };
};

/**
 * Pan and zoom over a canvas: a wheel zooms about the pointer (Shift or a sideways swipe
 * pans), a drag pans, two fingers pinch and pan together. The buttons' moves spring as the
 * rest of the app does; a gesture follows the hand directly.
 */
export function useViewport(canvas: RefObject<HTMLElement | null>): Viewport {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const scale = useMotionValue(1);
  const reduced = useReducedMotion() ?? false;
  const didPan = useRef(false);
  const touched = useRef(false);

  const get = useCallback(() => ({ x: x.get(), y: y.get(), scale: scale.get() }), [x, y, scale]);
  const set = useCallback(
    (view: View) => {
      x.stop();
      y.stop();
      scale.stop();
      x.set(view.x);
      y.set(view.y);
      scale.set(view.scale);
    },
    [x, y, scale],
  );
  const go = useCallback(
    (view: View, instant = false) => {
      if (instant || reduced) return set(view);
      animate(x, view.x, springs.smooth);
      animate(y, view.y, springs.smooth);
      animate(scale, view.scale, springs.smooth);
    },
    [x, y, scale, reduced, set],
  );

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const local = (event: { clientX: number; clientY: number }) => {
      const box = element.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      touched.current = true;
      const view = get();
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        const lines = event.deltaMode === 1 ? 16 : 1;
        const dx = (event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX) * lines;
        const dy = event.shiftKey ? 0 : event.deltaY * lines;
        return set({ ...view, x: view.x - dx, y: view.y - dy });
      }
      set(zoomAround(view, wheelFactor(event), local(event)));
    };

    const pointers = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number } | null = null;
    let pinch: { distance: number; mid: { x: number; y: number } } | null = null;
    const spread = () => {
      const [a, b] = [...pointers.values()];
      return {
        distance: Math.hypot(a!.x - b!.x, a!.y - b!.y),
        mid: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 },
      };
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      // A control floating over the canvas keeps its own pointer.
      if ((event.target as Element | null)?.closest('[data-graph-overlay]')) return;
      pointers.set(event.pointerId, local(event));
      if (pointers.size === 1) {
        start = local(event);
        didPan.current = false;
      } else if (pointers.size === 2) {
        pinch = spread();
        didPan.current = true;
        touched.current = true;
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      const before = pointers.get(event.pointerId);
      if (!before) return;
      const now = local(event);
      pointers.set(event.pointerId, now);
      if (pointers.size >= 2 && pinch) {
        const next = spread();
        const view = get();
        const zoomed = zoomAround(view, next.distance / Math.max(1, pinch.distance), next.mid);
        set({
          ...zoomed,
          x: zoomed.x + next.mid.x - pinch.mid.x,
          y: zoomed.y + next.mid.y - pinch.mid.y,
        });
        pinch = next;
        return;
      }
      if (!start) return;
      if (!didPan.current && Math.hypot(now.x - start.x, now.y - start.y) < TAP_SLOP) return;
      if (!didPan.current) {
        didPan.current = true;
        touched.current = true;
        // Only now: a capture taken on press would take a tap's click from the node.
        element.setPointerCapture?.(event.pointerId);
      }
      const view = get();
      set({ ...view, x: view.x + now.x - before.x, y: view.y + now.y - before.y });
    };
    const onPointerUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 1) start = [...pointers.values()][0]!;
      if (pointers.size === 0) start = null;
    };
    // A click that ends a pan opens nothing.
    const onClick = (event: MouseEvent) => {
      // A key's click (Enter on a node) has no pointer behind it.
      if (!didPan.current || event.detail === 0) return;
      didPan.current = false;
      event.stopPropagation();
      event.preventDefault();
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerUp);
    element.addEventListener('click', onClick, true);
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerUp);
      element.removeEventListener('click', onClick, true);
    };
  }, [canvas, get, set]);

  return useMemo(
    () => ({ x, y, scale, get, go, panned: () => didPan.current, touched }),
    [x, y, scale, get, go],
  );
}
