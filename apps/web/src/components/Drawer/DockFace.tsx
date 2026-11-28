import { motion, useIsPresent, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * One face of the dock, trading places with another inside `AnimatePresence`: the board's dock
 * and an open task's, or one screen's dock and the next one's, as Catch's dock does for a note.
 */
export function DockFace({ children }: { children: ReactNode }) {
  const present = useIsPresent();
  const reduced = useReducedMotion();
  return (
    <motion.div
      aria-hidden={!present || undefined}
      inert={!present}
      // Leaving, it stops taking up room so the new face sits where it will rest.
      className={cn(!present && 'absolute inset-x-0 top-0')}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92, transition: { duration: reduced ? 0 : 0.16 } }}
      transition={reduced ? { duration: 0 } : springs.smooth}
    >
      {children}
    </motion.div>
  );
}
