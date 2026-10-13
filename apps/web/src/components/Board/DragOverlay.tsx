import { motion, useSpring, useTransform, useVelocity } from 'motion/react';
import { createPortal } from 'react-dom';
import { springs } from '@/lib/motion';
import { drag, overlayPosition } from './drag';
import { board, current, useVariants } from './state';
import { TaskCard } from './TaskCard';

/**
 * The copy of the held card that follows the pointer. It lifts off the board, leans into its
 * own movement, and on release flies to wherever the card ended up.
 */
export function DragOverlay() {
  const held = drag.use();
  const state = board.use();
  const [variants] = useVariants();
  // The card swings back against the direction it is carried, like something held by a corner.
  const velocity = useVelocity(overlayPosition.x);
  const lean = useSpring(useTransform(velocity, [-1400, 0, 1400], [-6, 0, 6], { clamp: true }), {
    stiffness: 260,
    damping: 26,
  });
  if (!held) return null;
  const task = current(state).tasks.find((item) => item.id === held.ids[0]);
  if (!task) return null;
  const flying = held.phase === 'dragging';
  const tilt = variants.lift === 'tilt';
  const more = held.ids.length - 1;
  // Over a dropzone the card is being sent, not placed: it shrinks to a token so the
  // zones around it stay readable.
  const token = flying && held.target?.kind === 'status';

  return createPortal(
    <motion.div
      aria-hidden
      className="pointer-events-none fixed top-0 left-0 z-[60]"
      style={{ x: overlayPosition.x, y: overlayPosition.y, width: held.width }}
    >
      <motion.div
        style={{
          rotate: tilt && flying && !token ? lean : 0,
          // Scaled about the finger, so a shrinking card stays under it.
          transformOrigin: `${held.grab.x}px ${held.grab.y}px`,
        }}
        initial={{ scale: 1 }}
        animate={{
          scale: held.swallowed ? 0.2 : token ? 0.55 : flying ? (tilt ? 1.05 : 1.02) : 1,
          opacity: held.swallowed ? 0 : token ? 0.92 : 1,
        }}
        transition={held.swallowed ? { duration: 0.28, ease: [0.2, 0, 0, 1] } : springs.snappy}
      >
        {/* A held selection travels as a stack with the count on top. */}
        {[2, 1]
          .filter((depth) => depth <= more)
          .map((depth) => (
            <div
              key={depth}
              className="absolute inset-0 rounded-2xl border border-border bg-card shadow-md"
              style={{ rotate: `${depth * 3}deg`, translate: `${depth * 4}px ${depth * 5}px` }}
            />
          ))}
        <div className="relative">
          <TaskCard task={task} overlay />
          {more > 0 && (
            <span className="-top-2 -right-2 absolute flex h-6 min-w-6 items-center justify-center rounded-full bg-foreground px-1.5 font-semibold text-background text-xs tabular-nums">
              {held.ids.length}
            </span>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
