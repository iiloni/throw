import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react';
import {
  type ComponentProps,
  type PointerEvent,
  type ReactNode,
  type Ref,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { AccountAvatar, accountLabel } from '@/components/AccountAvatar/AccountAvatar';
import type { Account } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { switchTo, useOwnTouch } from './deviceAccounts';

/** The avatar's width: how far a swipe carries it before the next account has replaced it. */
const TRAVEL = 32;
/** A press that moves less than this is still a tap. */
const SLOP = 6;

type Swipe = { axis: 'x' | 'y'; target: Account | null; from: 1 | -1 };

/**
 * The account in use as an avatar that a swipe across, in any direction, changes to the next or
 * previous account on the device, as Catch's does (ADR 0016). A tap is the button's own click:
 * it opens the list of accounts wherever the avatar sits.
 */
export function AccountSwipeButton({
  accounts,
  current,
  avatarClassName,
  className,
  children,
  onClick,
  onPointerDown: passPointerDown,
  onPointerMove: passPointerMove,
  onPointerUp: passPointerUp,
  onPointerCancel: passPointerCancel,
  ref,
  ...props
}: {
  accounts: Account[];
  current: Account;
  avatarClassName?: string;
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
} & Omit<ComponentProps<'button'>, 'ref' | 'children'>) {
  const button = useRef<HTMLButtonElement>(null);
  useImperativeHandle(ref, () => button.current as HTMLButtonElement);
  useOwnTouch(button);
  const [swipe, setSwipeState] = useState<Swipe | null>(null);
  // Read by the pointer handlers, which can run again before the swipe has rendered.
  const swipeRef = useRef<Swipe | null>(null);
  const setSwipe = (next: Swipe | null) => {
    swipeRef.current = next;
    setSwipeState(next);
  };
  const reducedMotion = useReducedMotion();
  const offset = useMotionValue(0);
  const settle = (to: number) => {
    if (!reducedMotion) return animate(offset, to, springs.snappy);
    offset.set(to);
    return Promise.resolve();
  };
  const press = useRef<{ id: number; x: number; y: number; committed: boolean } | null>(null);
  const swiped = useRef(false);
  const index = accounts.findIndex((account) => account.user.id === current.user.id);

  /** The account a swipe leads to: forwards for up or left, back for down or right. */
  const neighbor = (step: 1 | -1) =>
    accounts.length > 1 && index >= 0
      ? (accounts[(index + step + accounts.length) % accounts.length] ?? null)
      : null;

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    swiped.current = false;
    press.current = { id: event.pointerId, x: event.clientX, y: event.clientY, committed: false };
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const start = press.current;
    if (!start || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const swipe = swipeRef.current;
    let axis = swipe?.axis;
    if (!axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SLOP) return;
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      swiped.current = true;
      // The swipe may leave the button, which can be as small as a fingertip.
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    const delta = axis === 'x' ? dx : dy;
    const from = delta < 0 ? 1 : -1;
    const target = neighbor(from);
    if (swipe?.axis !== axis || swipe.from !== from) setSwipe({ axis, target, from });
    // With nobody to switch to, the avatar gives a little and no more.
    offset.set(
      target ? Math.max(-TRAVEL, Math.min(TRAVEL, delta)) : delta / (1 + Math.abs(delta) / 6),
    );
    const committed = Boolean(target) && Math.abs(delta) >= TRAVEL / 2;
    if (committed !== start.committed) haptics.threshold();
    start.committed = committed;
  }

  function onPointerEnd(event: PointerEvent<HTMLButtonElement>) {
    const start = press.current;
    if (!start || event.pointerId !== start.id) return;
    press.current = null;
    const swipe = swipeRef.current;
    if (!swipe) return;
    // The click that ends a swipe comes next, if one comes at all: a cancelled touch sends
    // none, and must not leave the next key press on the avatar ignored.
    setTimeout(() => {
      swiped.current = false;
    }, 300);
    const target = event.type === 'pointerup' && start.committed ? swipe.target : null;
    if (target && switchTo(target)) {
      // The page is about to load again as the other account; its avatar stays in place.
      void settle(-swipe.from * TRAVEL);
      return;
    }
    void settle(0).then(() => setSwipe(null));
  }

  return (
    <button
      type="button"
      aria-label={`Account: ${accountLabel(current)}`}
      aria-description={accounts.length > 1 ? 'Swipe to switch accounts' : undefined}
      {...props}
      ref={button}
      onPointerDown={(event) => {
        passPointerDown?.(event);
        onPointerDown(event);
      }}
      onPointerMove={(event) => {
        passPointerMove?.(event);
        onPointerMove(event);
      }}
      onPointerUp={(event) => {
        passPointerUp?.(event);
        onPointerEnd(event);
      }}
      onPointerCancel={(event) => {
        passPointerCancel?.(event);
        onPointerEnd(event);
      }}
      onClick={(event) => {
        // A popover trigger leaves itself alone when the click that ends a swipe is cancelled.
        if (swiped.current) {
          event.preventDefault();
          swiped.current = false;
          return;
        }
        onClick?.(event);
      }}
      className={cn('touch-none select-none', className)}
    >
      <span
        data-account-avatar=""
        className={cn(
          'relative block size-8 shrink-0 overflow-hidden rounded-full',
          avatarClassName,
        )}
      >
        <motion.span
          className="absolute inset-0"
          style={swipe?.axis === 'x' ? { x: offset } : { y: offset }}
        >
          <AccountAvatar {...current.user} className="size-full" />
          {swipe?.target && (
            <AccountAvatar
              {...swipe.target.user}
              className="absolute size-full"
              // It follows the avatar from the side the swipe is pulling away from.
              style={
                swipe.axis === 'x'
                  ? { top: 0, left: `${swipe.from * 100}%` }
                  : { left: 0, top: `${swipe.from * 100}%` }
              }
            />
          )}
        </motion.span>
      </span>
      {children}
    </button>
  );
}
