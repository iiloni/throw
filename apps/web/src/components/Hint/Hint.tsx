import { Capacitor } from '@capacitor/core';
import { Slot } from 'radix-ui';
import type { HTMLAttributes, ReactElement, Ref } from 'react';
import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ariaShortcut, ShortcutKeys } from '@/components/KeyboardShortcuts/Keys';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ShortcutId } from '@/lib/shortcuts';

export type HintSide = 'top' | 'right' | 'bottom' | 'left';

/**
 * Throw's tooltip around one element, in place of a native `title`. It opens on hover and on
 * keyboard focus only: Radix ignores touch, so a tap, a long press or a swipe never shows one,
 * and Android's app (where a tap focuses) leaves it out.
 *
 * Other props and the ref pass to the element, so a Hint can itself be the child of an
 * `asChild` trigger, such as a menu's.
 */
export function Hint({
  label,
  children,
  side = 'top',
  disabled = false,
  whenTruncated = false,
  describe = false,
  shortcut,
  ref,
  onPointerMove,
  onFocus,
  ...props
}: Omit<HTMLAttributes<HTMLElement>, 'children'> & {
  ref?: Ref<HTMLElement>;
  label: string;
  /** One element that takes a ref and forwards its props. */
  children: ReactElement;
  side?: HintSide;
  /** Leaves the hint out while keeping the element mounted, so a focused one keeps focus. */
  disabled?: boolean;
  /** Shows only while the element, or a `.truncate` inside it, cuts its text short. */
  whenTruncated?: boolean;
  /**
   * Also makes the hint the element's accessible description, for a hint that says more than
   * the element's name and visible text.
   */
  describe?: boolean;
  /** A keyboard shortcut for the same action: its keys follow the label, as this device has them. */
  shortcut?: ShortcutId;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const refs = (node: HTMLElement | null) => {
    trigger.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };
  const id = useId();
  // Radix describes the trigger by the tooltip only while it is open. Passing no prop at all
  // when there is nothing to add keeps that.
  const description = describe ? { 'aria-describedby': id } : {};
  // In the body, not beside the element, so the element's text stays its own: a card's text
  // is what it shows.
  const hidden =
    describe &&
    createPortal(
      <span id={id} hidden>
        {label}
      </span>,
      document.body,
    );
  if (Capacitor.getPlatform() === 'android')
    return (
      <>
        <Slot.Root
          {...props}
          {...description}
          onPointerMove={onPointerMove}
          onFocus={onFocus}
          ref={ref}
        >
          {children}
        </Slot.Root>
        {hidden}
      </>
    );
  return (
    <Tooltip
      open={open && !disabled}
      onOpenChange={(next) =>
        setOpen(next && !disabled && (!whenTruncated || truncated(trigger.current)))
      }
    >
      <TooltipTrigger
        {...props}
        asChild
        ref={refs}
        // Holding a button down is a drag (or a text selection): a card carried over a badge
        // must not stop to explain it.
        onPointerMove={(event) => {
          onPointerMove?.(event);
          if (event.buttons) event.preventDefault();
        }}
        // Focus returned by a menu or dialog the pointer closed is not a request for a hint;
        // focus from the keyboard is.
        onFocus={(event) => {
          onFocus?.(event);
          if (!event.currentTarget.matches(':focus-visible')) event.preventDefault();
        }}
        {...description}
        aria-keyshortcuts={ariaShortcut(shortcut)}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side={side}>
        <span className="min-w-0">{label}</span>
        {/* The trigger names its keys in `aria-keyshortcuts`; these are for the eye. */}
        {shortcut && <ShortcutKeys id={shortcut} spoken={false} />}
      </TooltipContent>
      {hidden}
    </Tooltip>
  );
}

function truncated(element: HTMLElement | null) {
  if (!element) return false;
  const clipping = [element, ...element.querySelectorAll<HTMLElement>('.truncate')];
  return clipping.some(
    (node) => node.classList.contains('truncate') && node.scrollWidth > node.clientWidth,
  );
}
