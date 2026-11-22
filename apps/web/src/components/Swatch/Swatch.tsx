import type { Tag } from '@throw/shared';
import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { Hint } from '@/components/Hint/Hint';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * One round color choice, shared by the color pickers so they cannot drift apart. Without a
 * color it is the "no color" choice, drawn on the card.
 */
export function Swatch({
  color,
  label,
  hint = label,
  pressed,
  unavailable = false,
  onClick,
  children,
}: {
  color?: Tag['color'];
  label: string;
  /** The tooltip, when it says more than the label. It then also describes the swatch. */
  hint?: string;
  pressed: boolean;
  /**
   * Shown but not pickable. It stays hoverable and focusable (`aria-disabled`, not
   * `disabled`), so its hint can say why.
   */
  unavailable?: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  const reduced = useReducedMotion();
  return (
    <Hint label={hint} describe={hint !== label}>
      <motion.button
        type="button"
        data-color={color ?? undefined}
        aria-label={label}
        aria-pressed={pressed}
        aria-disabled={unavailable || undefined}
        whileTap={reduced || unavailable ? undefined : { scale: 0.85 }}
        transition={springs.snappy}
        onClick={() => {
          if (!unavailable) onClick();
        }}
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-full border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-disabled:cursor-not-allowed aria-disabled:opacity-25',
          color ? 'bg-tint text-tint-accent' : 'bg-card text-muted-foreground',
          pressed ? 'border-foreground/70 ring-2 ring-foreground/15' : 'border-foreground/10',
        )}
      >
        {children}
      </motion.button>
    </Hint>
  );
}
