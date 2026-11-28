import { Fragment } from 'react';
import {
  ariaChord,
  bindingsOf,
  chordKeys,
  type ShortcutId,
  spokenChord,
  useBindings,
} from '@/lib/shortcuts';
import { cn } from '@/lib/utils';

/** One chord as keycaps, in this platform's symbols. Its words are for a screen reader. */
export function Keys({
  binding,
  className,
  spoken = true,
}: {
  binding: string;
  className?: string;
  /** Leaves the words out where the keys only repeat what is already said, as in a tooltip. */
  spoken?: boolean;
}) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-0.5', className)}>
      {chordKeys(binding).map((key, index) => (
        <kbd
          // biome-ignore lint/suspicious/noArrayIndexKey: a chord's keys never reorder.
          key={index}
          aria-hidden
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-[0.3125rem] bg-foreground/[0.08] px-1 font-medium font-sans text-[0.6875rem] text-muted-foreground leading-none shadow-[inset_0_-1px_0_oklch(0_0_0/0.08)]"
        >
          {key}
        </kbd>
      ))}
      {spoken && <span className="sr-only">{spokenChord(binding)}</span>}
    </span>
  );
}

/** A shortcut's keys: the first, or every one with “or” between them. */
export function ShortcutKeys({
  id,
  all = false,
  together = false,
  spoken = true,
  className,
}: {
  id: ShortcutId;
  all?: boolean;
  /** Keys that read as one set, such as the arrows, without “or”. */
  together?: boolean;
  spoken?: boolean;
  className?: string;
}) {
  const bindings = useBindings(id);
  const shown = all ? bindings : bindings.slice(0, 1);
  if (shown.length === 0) return null;
  return (
    <span className={cn('inline-flex shrink-0 flex-wrap items-center gap-1', className)}>
      {shown.map((binding, index) => (
        <Fragment key={binding}>
          {index > 0 && !together && (
            <span className="text-muted-foreground text-xs" aria-hidden={!spoken}>
              or
            </span>
          )}
          <Keys binding={binding} spoken={spoken} />
        </Fragment>
      ))}
    </span>
  );
}

/** A shortcut's keys for `aria-keyshortcuts`, or nothing when it has none. */
export function ariaShortcut(id: ShortcutId | undefined) {
  if (!id) return undefined;
  const value = bindingsOf(id).map(ariaChord).filter(Boolean).join(' ');
  return value || undefined;
}
