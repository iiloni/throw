import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { ScrollArea, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { drag } from './drag';
import { groupByPriority, priorityName } from './model';
import { board, current, listTasks } from './state';
import { TaskCard } from './TaskCard';

/**
 * The backlog across the whole board, in a band per priority. Cards read left to right, then
 * down, so a place between two of them reads as it does in a sentence. A held card is placed
 * with a caret in the gutter, and nothing moves until it is dropped: a whole grid reflowing
 * under the pointer was too busy for an overview (owner decision, 2026-10-19).
 */
export function BacklogGallery({ showStatus }: { showStatus: boolean }) {
  const state = board.use();
  const held = drag.use();
  const { project } = current(state);
  const tasks = listTasks(state, 'backlog');
  const dragging = held?.phase === 'dragging';
  const columns = useColumns(dragging);
  const placing = dragging && held.origin === 'backlog' && held.ids.length === 1;
  const target =
    placing && held.target?.kind === 'place' && held.target.listId === 'backlog'
      ? held.target
      : null;
  // While a card is placed here every priority shows, so an empty one can take it.
  const bands = groupByPriority(tasks).filter((group) => group.tasks.length > 0 || placing);
  return (
    <ScrollArea edges className="flex-1 [--scrollbar-inset:0.5rem]">
      <ScrollAreaViewport data-autoscroll="">
        <section
          ref={columns.ref}
          data-drop-list="backlog"
          data-layout="grid"
          aria-label="Backlog tasks"
          className="px-5 pt-1 pb-5"
        >
          {tasks.length === 0 && !placing && (
            <p className="py-10 text-center text-muted-foreground text-sm">
              {state.awaitingTasks ? 'Loading tasks…' : 'Nothing here.'}
            </p>
          )}
          {bands.map(({ priority, tasks: zone }) => {
            // The held card keeps its place, faded, so nothing moves while it is carried.
            const peers = zone.filter((task) => !(placing && held.ids.includes(task.id)));
            const at = target?.priority === priority ? target.index : null;
            return (
              <section key={priority}>
                <h3
                  className="zone-header"
                  data-mode="label"
                  data-zone-header={priority}
                  data-current={at !== null ? '' : undefined}
                >
                  <span className="zone-header-face">{priorityName(project, priority)}</span>
                </h3>
                <div
                  className="relative grid items-start gap-x-4 pb-3"
                  style={{ gridTemplateColumns: `repeat(${columns.count}, minmax(0, 1fr))` }}
                >
                  {peers.length === 0 && at !== null && (
                    <div className="mb-4 h-20 rounded-2xl border-2 border-brand border-dashed" />
                  )}
                  {zone.map((task) => {
                    const index = peers.indexOf(task);
                    return (
                      <div
                        key={task.id}
                        data-slot={task.id}
                        data-zone={priority}
                        className="relative mb-4"
                      >
                        {index >= 0 && at === index && <Caret side="start" />}
                        {index >= 0 && at === peers.length && index === peers.length - 1 && (
                          <Caret side="end" />
                        )}
                        <TaskCard task={task} showStatus={showStatus} />
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </section>
      </ScrollAreaViewport>
      <ScrollBar />
    </ScrollArea>
  );
}

const CARD_MIN = 272;
const GUTTER = 16;

/**
 * How many cards fit across. The board makes room for the active statuses while a card is
 * held, so the gallery narrows; its cards narrow with it rather than flowing into fewer
 * columns under the card.
 */
function useColumns(holding: boolean) {
  const ref = useRef<HTMLElement>(null);
  const [count, setCount] = useState(1);
  const frozen = useRef(holding);
  frozen.current = holding;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (frozen.current) return;
      const width = entry!.contentRect.width;
      setCount(Math.max(1, Math.floor((width + GUTTER) / (CARD_MIN + GUTTER))));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, count };
}

/** A bar in the gutter beside a card: where the held one would go. */
function Caret({ side }: { side: 'start' | 'end' }) {
  return (
    <motion.span
      aria-hidden
      layoutId="gallery-caret"
      transition={springs.snappy}
      className={cn(
        'absolute top-1 bottom-1 z-10 w-1 rounded-full bg-brand',
        side === 'start' ? '-left-2.5' : '-right-2.5',
      )}
    />
  );
}
