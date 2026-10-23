import { Check } from 'lucide-react';
import { motion, useTransform } from 'motion/react';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { current } from './state';
import { swipe, swipeX } from './swipe';

/** What a card swiped to the right uncovers: the done status it closes into. */
export function SwipeReveal({ taskId }: { taskId: string }) {
  const state = swipe.use();
  const opacity = useTransform(swipeX, [0, 48], [0, 1]);
  if (state?.taskId !== taskId) return null;
  const done = current().project.statuses.find(
    (status) => status.category === 'done' && status.isDefault,
  );
  return (
    <motion.div
      aria-hidden
      data-swipe-reveal={state.armed ? 'armed' : ''}
      style={{ opacity }}
      className={cn(
        'absolute inset-x-0 top-0 bottom-3 flex items-center gap-2 rounded-2xl pl-5 font-semibold text-sm transition-colors duration-150',
        state.armed ? 'bg-brand text-brand-foreground' : 'bg-brand/15 text-brand-link',
      )}
    >
      <motion.span animate={{ scale: state.armed ? 1.25 : 1 }} transition={springs.snappy}>
        <Check className="size-5" strokeWidth={3} />
      </motion.span>
      {done?.name}
    </motion.div>
  );
}
