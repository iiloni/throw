import { Check } from 'lucide-react';
import { motion, useTransform } from 'motion/react';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { doneStatus, swipe, swipeX } from './swipe';

/** What a card swiped to the right uncovers: the done status it closes into. */
export function SwipeReveal({ taskId }: { taskId: string }) {
  const state = swipe.use();
  // Only the swiped card follows the finger; the rest stay off the motion value.
  if (state?.taskId !== taskId) return null;
  return <Reveal armed={state.armed} />;
}

function Reveal({ armed }: { armed: boolean }) {
  const opacity = useTransform(swipeX, [0, 48], [0, 1]);
  return (
    <motion.div
      aria-hidden
      data-swipe-reveal={armed ? 'armed' : ''}
      style={{ opacity }}
      className={cn(
        'absolute inset-x-0 top-0 bottom-3 flex items-center gap-2 rounded-2xl pl-5 font-semibold text-sm transition-colors duration-150',
        armed ? 'bg-brand text-brand-foreground' : 'bg-brand/15 text-brand-link',
      )}
    >
      <motion.span animate={{ scale: armed ? 1.25 : 1 }} transition={springs.snappy}>
        <Check className="size-5" strokeWidth={3} />
      </motion.span>
      {doneStatus()?.name}
    </motion.div>
  );
}
