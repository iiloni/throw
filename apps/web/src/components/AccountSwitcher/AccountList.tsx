import { Link } from '@tanstack/react-router';
import { Check, GripVertical, LogOut, Plus } from 'lucide-react';
import { type DragControls, Reorder, useDragControls } from 'motion/react';
import { type KeyboardEvent, type ReactNode, useRef, useState } from 'react';
import { AccountAvatar, accountLabel } from '@/components/AccountAvatar/AccountAvatar';
import { Hint } from '@/components/Hint/Hint';
import { type Account, getAccounts, reorderAccounts } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { cn } from '@/lib/utils';
import {
  askToSignOut,
  refreshAccounts,
  switchTo,
  useDeviceAccounts,
  useOwnTouch,
} from './deviceAccounts';

/**
 * The accounts signed in on this device (ADR 0016): a tap switches to one, each signs out on
 * its own, and "Add account" goes to the sign-in page. Their order is the swipe's and numbers
 * their addresses, so it is put right by dragging a handle or with the arrow keys on it.
 * `onLeave` closes whatever holds the list before a sign-out is asked about.
 */
export function AccountList({ onLeave, className }: { onLeave?: () => void; className?: string }) {
  const { accounts, setAccounts, current } = useDeviceAccounts();
  // Read when a drag ends, which can come before the last move of it has rendered.
  const latest = useRef(accounts);
  latest.current = accounts;
  const reorder = (next: Account[]) => {
    latest.current = next;
    setAccounts(next);
  };

  /** Saves the order the list shows, which renumbers the accounts' addresses. */
  function saveOrder() {
    const order = latest.current.map(({ user }) => user.id);
    const saved = getAccounts().map(({ user }) => user.id);
    if (order.join() === saved.join()) return;
    reorderAccounts(order);
    refreshAccounts();
  }

  function move(account: Account, step: 1 | -1) {
    const from = accounts.indexOf(account);
    const to = from + step;
    if (from < 0 || to < 0 || to >= accounts.length) return;
    const next = [...accounts];
    next.splice(from, 1);
    next.splice(to, 0, account);
    reorder(next);
    haptics.selection();
    saveOrder();
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Reorder.Group
        as="ul"
        axis="y"
        values={accounts}
        onReorder={(next) => {
          if (next.some((account, i) => account !== accounts[i])) haptics.selection();
          reorder(next);
        }}
        aria-label="Accounts"
        className="flex flex-col gap-1"
      >
        {accounts.map((account) => {
          const active = account.user.id === current?.user.id;
          return (
            <AccountRow
              key={account.user.id}
              account={account}
              movable={accounts.length > 1}
              onMove={(step) => move(account, step)}
              onDrop={saveOrder}
            >
              <button
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={() => (active ? onLeave?.() : switchTo(account))}
                className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-2xl p-2 text-left outline-none transition-colors hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring active:bg-foreground/[0.06]"
              >
                <AccountAvatar {...account.user} className="size-9" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-sm">
                    {accountLabel(account)}
                  </span>
                  {account.user.name && (
                    <span className="block truncate text-muted-foreground text-xs">
                      {account.user.email}
                    </span>
                  )}
                </span>
                {active && <Check aria-hidden className="size-4 shrink-0" />}
              </button>
              <Hint label="Sign out">
                <button
                  type="button"
                  aria-label={`Sign out ${account.user.email}`}
                  onClick={async () => {
                    onLeave?.();
                    await askToSignOut(account);
                  }}
                  className="flex size-11 shrink-0 items-center justify-center rounded-full text-destructive outline-none transition-colors hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring active:bg-destructive/10"
                >
                  <LogOut aria-hidden className="size-4" />
                </button>
              </Hint>
            </AccountRow>
          );
        })}
      </Reorder.Group>
      <Link
        to="/login"
        className="flex min-h-12 items-center gap-3 rounded-2xl p-2 font-medium text-sm outline-none transition-colors hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring active:bg-foreground/[0.06]"
      >
        <span className="flex size-9 items-center justify-center rounded-full bg-foreground/[0.06]">
          <Plus aria-hidden className="size-5" />
        </span>
        Add account
      </Link>
    </div>
  );
}

/** Only the handle starts a drag, so a press on the rest of the row is still a tap. */
function AccountRow({
  account,
  movable,
  onMove,
  onDrop,
  children,
}: {
  account: Account;
  movable: boolean;
  onMove: (step: 1 | -1) => void;
  onDrop: () => void;
  children: ReactNode;
}) {
  const controls = useDragControls();
  const [dragging, setDragging] = useState(false);
  return (
    <Reorder.Item
      value={account}
      dragListener={false}
      dragControls={controls}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => {
        setDragging(false);
        onDrop();
      }}
      className={cn(
        'relative flex items-center gap-1 rounded-2xl',
        dragging && 'z-10 bg-popover shadow-lg',
      )}
    >
      {movable && <MoveHandle account={account} controls={controls} onMove={onMove} />}
      {children}
    </Reorder.Item>
  );
}

function MoveHandle({
  account,
  controls,
  onMove,
}: {
  account: Account;
  controls: DragControls;
  onMove: (step: 1 | -1) => void;
}) {
  const handle = useRef<HTMLButtonElement>(null);
  useOwnTouch(handle);
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    onMove(step);
  }
  return (
    <Hint label="Drag to reorder">
      <button
        ref={handle}
        type="button"
        aria-label={`Move ${account.user.email}`}
        aria-description="Drag, or press the up and down arrow keys, to change the account's place and the number in its address"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          haptics.longPress();
          controls.start(event);
        }}
        onKeyDown={onKeyDown}
        className="-mr-1 flex h-11 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring"
      >
        <GripVertical aria-hidden className="size-4" />
      </button>
    </Hint>
  );
}
