import {
  type AnimationPlaybackControls,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
} from 'motion/react';
import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

/** Springs to its content's height as the content changes, as Catch's pickers do. */
export function AnimatedHeight({
  children,
  anchor = 'bottom',
  follow = false,
}: {
  children: ReactNode;
  anchor?: 'top' | 'bottom';
  /**
   * Takes the content's height as it is rather than springing to it, for while something
   * inside is animating its own height: two springs chasing each other fall out of step.
   */
  follow?: boolean;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const height = useMotionValue<number | 'auto'>('auto');
  // The content's height when last measured, which is still the old one when the content
  // changes and the frame stops following in the same commit.
  const measured = useRef<number>(undefined);
  const spring = useRef<AnimationPlaybackControls>(undefined);
  const reducedMotion = useReducedMotion();
  const following = useRef(follow);
  following.current = follow || !!reducedMotion;

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const from = measured.current;
      const to = content.offsetHeight;
      measured.current = to;
      if (from === undefined) return;
      // While following, a spring still landing keeps chasing the content rather than
      // stopping short of it.
      if (following.current && spring.current?.state !== 'running') return;
      if (height.get() === 'auto') height.jump(from);
      spring.current = animate(height, to, {
        ...springs.smooth,
        // Once following again, the content takes its height back when the spring lands.
        onComplete: () => {
          if (following.current) height.jump('auto');
        },
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [height]);

  const isFollowing = follow || !!reducedMotion;
  useLayoutEffect(() => {
    if (!isFollowing) {
      // Hold the old height before paint, so the spring starts from it once the new content
      // is measured.
      if (height.get() === 'auto' && measured.current !== undefined) height.jump(measured.current);
      return;
    }
    if (spring.current?.state !== 'running') height.jump('auto');
  }, [isFollowing, height]);

  return (
    <motion.div
      className={cn(
        'flex flex-col overflow-hidden',
        anchor === 'bottom' ? 'justify-end' : 'justify-start',
      )}
      style={{ height }}
    >
      <div ref={contentRef} className="shrink-0">
        {children}
      </div>
    </motion.div>
  );
}
