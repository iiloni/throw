import { useState } from 'react';
import { accountLabel } from '@/components/AccountAvatar/AccountAvatar';
import { Hint } from '@/components/Hint/Hint';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { AccountList } from './AccountList';
import { AccountSwipeButton } from './AccountSwipeButton';
import { useDeviceAccounts } from './deviceAccounts';

/**
 * The account in use at the foot of the desktop rail (ADR 0016). A swipe across its avatar
 * changes to the next or previous account; a click opens the list of them beside the rail.
 */
export function AccountSwitcher({ expanded }: { expanded: boolean }) {
  const { accounts, current } = useDeviceAccounts();
  const [open, setOpen] = useState(false);
  if (!current) return null;
  const label = accountLabel(current);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint label={label} side="right" disabled={expanded || open}>
        <PopoverTrigger asChild>
          <AccountSwipeButton
            accounts={accounts}
            current={current}
            // Centred where the rail's icons are.
            avatarClassName="mx-1"
            className={cn(
              'flex h-12 w-full shrink-0 items-center gap-3 rounded-2xl px-2 text-left text-muted-foreground text-sm outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring',
              open && 'bg-accent/60',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'min-w-0 truncate whitespace-nowrap transition-opacity duration-150',
                !expanded && 'opacity-0',
              )}
            >
              {label}
            </span>
          </AccountSwipeButton>
        </PopoverTrigger>
      </Hint>
      <PopoverContent side="right" align="end" sideOffset={12} className="w-80 p-2">
        <AccountList onLeave={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
