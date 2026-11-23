import { type HTMLMotionProps, motion, useIsPresent, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { afterPaint, curves, springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * The glass filter card that rises above a search field, for an `AnimatePresence` to mount.
 *
 * It opens and closes on transform and opacity alone: growing its height re-laid out the
 * card (and whatever sat around it) every frame and redrew its backdrop blur at each new
 * size. A uniform scale from its foot keeps the rounded corners and shadow true. The card
 * mounts hidden and starts once its sections have been drawn, so mounting them does not eat
 * the opening frames. The opacity is the card's own, never an ancestor's: a fading ancestor
 * would cut the blur off from what is behind it until the fade ended.
 */
export function FilterCard({ className, style, children, ...props }: HTMLMotionProps<'div'>) {
  const reduced = useReducedMotion();
  const present = useIsPresent();
  const [painted, setPainted] = useState(false);
  useEffect(() => afterPaint(() => setPainted(true)), []);
  const hidden = reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.96 };
  const shown = reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 };
  return (
    <motion.div
      {...props}
      initial={hidden}
      animate={painted ? shown : hidden}
      exit={hidden}
      transition={reduced ? curves.fade : { ...springs.smooth, opacity: curves.fade }}
      // Closing, it leaves the field and the results under it to the pointer at once.
      inert={!present}
      style={{ transformOrigin: 'bottom center', ...style }}
      className={cn('pointer-events-auto', !present && 'pointer-events-none', className)}
    >
      {children}
    </motion.div>
  );
}
