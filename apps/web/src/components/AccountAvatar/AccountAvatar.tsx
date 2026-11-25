import type { CSSProperties } from 'react';
import type { Account } from '@/lib/auth';
import { cn } from '@/lib/utils';

export function initials(name: string, email: string) {
  return (name.trim() || email)
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

/** A hue that stays with an account, so the accounts on one device can be told apart. */
export function accountHue(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index++) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return hash % 360;
}

export const accountLabel = ({ user }: Pick<Account, 'user'>) => user.name || user.email;

/** An account's initials on its own color, as Catch's avatars are. */
export function AccountAvatar({
  id,
  name,
  email,
  className,
  style,
}: {
  id: string;
  name: string;
  email: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      style={{ '--avatar-hue': accountHue(id), ...style } as CSSProperties}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full bg-[light-dark(oklch(0.86_0.11_var(--avatar-hue)),oklch(0.4_0.09_var(--avatar-hue)))] font-semibold text-[light-dark(oklch(0.32_0.08_var(--avatar-hue)),oklch(0.92_0.05_var(--avatar-hue)))] text-sm',
        className,
      )}
    >
      {initials(name, email)}
    </span>
  );
}
