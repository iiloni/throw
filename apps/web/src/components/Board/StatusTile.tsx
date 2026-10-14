import { motion } from 'motion/react';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { drag } from './drag';
import { StatusGlyph } from './glyphs';
import type { Status } from './model';
import { board, countIn } from './state';

type Props = {
  status: Status;
  /** Set when cards are selected: the tile is then a button that moves them. */
  onPick?: () => void;
  /** `row` is the compact form in the phone dock, `narrow` a block for a rail that is a strip. */
  shape?: 'block' | 'row' | 'narrow';
  className?: string;
};

/**
 * A place to send a card without placing it: a held card dropped here, or a selection sent
 * here, moves to the status and keeps its priority.
 */
export function StatusTile({ status, onPick, shape = 'block', className }: Props) {
  const held = drag.use();
  const count = countIn(board.use(), status.id);
  const over = held?.target?.kind === 'status' && held.target.statusId === status.id;
  return (
    <motion.button
      type="button"
      data-drop-status={status.id}
      tabIndex={onPick ? 0 : -1}
      onClick={onPick}
      animate={{ scale: over ? 1.04 : 1 }}
      whileTap={onPick ? { scale: 0.95 } : undefined}
      transition={springs.snappy}
      className={cn(
        'flex min-h-0 min-w-0 select-none items-center gap-2 rounded-2xl border text-left outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/60',
        shape === 'block' && 'flex-1 flex-col justify-center px-3 py-2 text-center',
        shape === 'narrow' && 'flex-1 flex-col justify-center px-1 py-2 text-center',
        shape === 'row' && 'h-12 px-2.5',
        over
          ? 'border-brand bg-accent text-foreground shadow-md'
          : 'border-transparent bg-foreground/[0.06] text-foreground/75',
        className,
      )}
    >
      {shape !== 'row' && <StatusGlyph category={status.category} className="size-5" />}
      <span
        className={cn(
          'min-w-0 max-w-full truncate font-medium',
          shape === 'block' ? 'text-sm' : 'text-[0.8125rem]',
        )}
      >
        {status.name}
      </span>
      <span
        className={cn('text-muted-foreground text-xs tabular-nums', shape === 'row' && 'ml-auto')}
      >
        {count}
      </span>
    </motion.button>
  );
}
