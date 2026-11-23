import { motion } from 'motion/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Hint } from '@/components/Hint/Hint';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

// As Catch's note toolbar: inset in the dock so their corners follow its corners, and only
// the one whose panel is open takes a surface.
const control =
  'relative flex size-full items-center justify-center rounded-[calc(var(--dock-radius)-0.25rem)] text-foreground/80 outline-none transition-colors duration-200 hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/70 aria-expanded:bg-foreground/[0.08] aria-expanded:text-foreground aria-expanded:shadow-[inset_0_1px_0_var(--glass-highlight)] [&_svg]:size-6! [&_svg]:shrink-0';

export type ControlProps = Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-expanded' | 'aria-controls'
>;

/**
 * One of a dock's controls, pressed in on Catch's toolbar spring: an open task's, or a board
 * selection's.
 */
export function DockControl({
  label,
  tooltip,
  onOpen,
  className,
  children,
  ...props
}: ControlProps & {
  label: string;
  tooltip: boolean;
  onOpen(element: HTMLButtonElement): void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Hint label={label} disabled={!tooltip}>
      <motion.button
        type="button"
        aria-label={label}
        className={cn(control, className)}
        whileTap={{ scale: 0.88 }}
        transition={springs.snappy}
        {...props}
        onClick={(event) => {
          // A dock over a clickable card keeps the tap to itself.
          event.stopPropagation();
          onOpen(event.currentTarget);
        }}
      >
        {children}
      </motion.button>
    </Hint>
  );
}
