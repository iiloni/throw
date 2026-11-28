import { type MouseEvent, type PointerEvent, useRef } from 'react';
import { haptics } from '@/lib/haptics';
import { isDesktop } from '@/lib/media';
import {
  armBlockerSpotlight,
  cancelBlockerSpotlight,
  releaseBlockerHold,
  SPOTLIGHT_HOLD_MS,
  type SpotlightScope,
  type TaskBlocker,
} from './blockers';
import { TOUCH_SLOP } from './drag';

/**
 * Whether a finger on a blocked badge can hold its blockers' spotlight: only on a board that
 * lays its columns out side by side (a tablet, an unfolded foldable), where the blockers can be
 * on screen beside it. A phone's board, or the compact one beside a task, pages one column at a
 * time, and there the badge is part of the card like any other.
 */
export function holdsBlockerSpotlight(badge: Element) {
  return isDesktop() && badge.closest('[data-board-layout]:not([data-compact-board])') !== null;
}

/**
 * How far beyond a blocked badge a finger still lands on it, each way. The badge is a 20 px
 * square on a 12 px icon, smaller than a fingertip, and a finger that just misses it would press
 * what is around it instead; this makes the target a finger's 44 px. The badge's box stays as it
 * is, so a mouse still lingers on the icon itself.
 */
export const BLOCKED_BADGE_REACH = 12;

function withinReach(badge: Element, x: number, y: number) {
  const box = badge.getBoundingClientRect();
  return (
    x >= box.left - BLOCKED_BADGE_REACH &&
    x <= box.right + BLOCKED_BADGE_REACH &&
    y >= box.top - BLOCKED_BADGE_REACH &&
    y <= box.bottom + BLOCKED_BADGE_REACH
  );
}

/**
 * A finger held on a blocked badge, or close enough to it: it lights up the blockers after the
 * board's long press, for as long as it stays down, in place of the host's own press. The host
 * is not picked up, selected or opened by it (its click checks `consumeBlockerHoldClick`), and a
 * finger that sets off scrolling lets it go. The handlers go on the host that holds the badge
 * and the room around it, so a press just beside the badge reaches them; another control inside
 * the host keeps its own press.
 */
export function useBlockerHold(
  key: string,
  blockers: readonly TaskBlocker[],
  scope?: SpotlightScope,
) {
  const badge = useRef<HTMLSpanElement>(null);
  const hold = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const latest = useRef({ blockers, scope });
  latest.current = { blockers, scope };

  function end(event: PointerEvent<HTMLElement>) {
    if (hold.current?.pointerId !== event.pointerId) return;
    hold.current = null;
    releaseBlockerHold(key);
  }

  return {
    badge,
    onPointerDown(event: PointerEvent<HTMLElement>) {
      const target = badge.current;
      if (!target || event.pointerType !== 'touch' || event.button !== 0 || hold.current) return;
      if (event.target instanceof Element && !target.contains(event.target)) {
        const control = event.target.closest('a, button, input, [data-no-drag]');
        if (control && control !== event.currentTarget && event.currentTarget.contains(control))
          return;
      }
      if (!withinReach(target, event.clientX, event.clientY)) return;
      if (!holdsBlockerSpotlight(target)) return;
      // The card's press would pick it up or select it after the same wait.
      event.stopPropagation();
      hold.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // A pointer already gone has nothing to capture.
      }
      armBlockerSpotlight(
        key,
        latest.current.blockers,
        SPOTLIGHT_HOLD_MS,
        haptics.selection,
        latest.current.scope,
      );
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const press = hold.current;
      if (press?.pointerId !== event.pointerId) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > TOUCH_SLOP) end(event);
    },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
    onContextMenu(event: MouseEvent<HTMLElement>) {
      // A held finger asks for the browser's menu; the spotlight has answered it.
      if (!hold.current) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

/** The handlers `useBlockerHold` puts on its host, without its badge ref. */
export function holdHandlers(hold: ReturnType<typeof useBlockerHold>) {
  return {
    onPointerDown: hold.onPointerDown,
    onPointerMove: hold.onPointerMove,
    onPointerUp: hold.onPointerUp,
    onPointerCancel: hold.onPointerCancel,
    onLostPointerCapture: hold.onLostPointerCapture,
    onContextMenu: hold.onContextMenu,
  };
}

/**
 * A mouse lingering on a blocked badge: the badge's pointer handlers, which arm the spotlight
 * after `SPOTLIGHT_DWELL_MS` and end it as the pointer leaves. A finger and a pressed button
 * pass by (a finger holds instead, `useBlockerHold`).
 */
export function lingerHandlers(
  key: string,
  blockers: readonly TaskBlocker[],
  scope?: SpotlightScope,
) {
  return {
    onPointerEnter(event: PointerEvent<HTMLElement>) {
      if (event.pointerType === 'touch' || event.buttons !== 0) return;
      armBlockerSpotlight(key, blockers, undefined, undefined, scope);
    },
    onPointerLeave: () => cancelBlockerSpotlight(key),
    onPointerCancel: () => cancelBlockerSpotlight(key),
  };
}
