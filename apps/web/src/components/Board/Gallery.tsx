import { motion } from 'motion/react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { ScrollArea, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { CARD_SPACING, drag } from './drag';
import { groupByPriority, PRIORITIES, priorityName } from './model';
import { board, current, listTasks } from './state';
import { TaskCard } from './TaskCard';

/**
 * How a card held in the full-width backlog lands (spec, open question 6). Being tried with
 * the owner: `none` sends it only, `gap` opens a place in reading order that the others flow
 * around, `caret` marks the place between two cards and moves nothing until the drop.
 */
export type GalleryDrop = 'none' | 'gap' | 'caret';

export function galleryDrop(): GalleryDrop {
  if (typeof window === 'undefined') return 'none';
  const asked = new URLSearchParams(location.search).get('gallery');
  if (asked === 'none' || asked === 'gap' || asked === 'caret')
    sessionStorage.setItem('throw-gallery-drop', asked);
  const kept = sessionStorage.getItem('throw-gallery-drop');
  return kept === 'gap' || kept === 'caret' ? kept : 'none';
}

/**
 * The backlog across the whole board, in a band per priority. Cards read left to right, then
 * down, so a place between two of them reads as it does in a sentence.
 */
export function BacklogGallery({ showStatus }: { showStatus: boolean }) {
  const state = board.use();
  const held = drag.use();
  const mode = galleryDrop();
  const { project } = current(state);
  const tasks = listTasks(state, 'backlog');
  const dragging = held?.phase === 'dragging';
  const columns = useColumns(dragging);
  const placing = mode !== 'none' && dragging && held.origin === 'backlog' && held.ids.length === 1;
  const target =
    placing && held.target?.kind === 'place' && held.target.listId === 'backlog'
      ? held.target
      : null;
  // While a card is placed here every priority shows, so an empty one can take it.
  const bands = groupByPriority(tasks).filter(
    (group) => group.tasks.length > 0 || (placing && PRIORITIES.includes(group.priority)),
  );
  if (mode === 'none') return <MasonryGallery showStatus={showStatus} />;
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
            const away = (id: string) => placing && held.ids.includes(id);
            // The cards it could land between: everything in the band but itself.
            const peers = zone.filter((task) => !away(task.id));
            const at = target?.priority === priority ? target.index : null;
            const gap = (
              <div
                key="gap"
                data-gap=""
                className="mb-4 rounded-2xl bg-foreground/[0.07]"
                style={{ height: (held?.height ?? 0) - CARD_SPACING + 12 }}
              />
            );
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
                  {peers.length === 0 && at !== null && mode === 'caret' && (
                    <div className="mb-4 h-20 rounded-2xl border-2 border-brand border-dashed" />
                  )}
                  {zone.map((task) => {
                    const index = peers.indexOf(task);
                    const lifted = away(task.id);
                    return (
                      <Fragment key={task.id}>
                        {mode === 'gap' && at === index && !lifted && gap}
                        <motion.div
                          layout={mode === 'gap' ? 'position' : false}
                          transition={springs.snappy}
                          data-slot={task.id}
                          data-zone={priority}
                          hidden={mode === 'gap' && lifted}
                          className="relative mb-4"
                        >
                          {mode === 'caret' && !lifted && at === index && <Caret side="start" />}
                          {mode === 'caret' &&
                            !lifted &&
                            at === peers.length &&
                            index === peers.length - 1 && <Caret side="end" />}
                          <TaskCard task={task} showStatus={showStatus} />
                        </motion.div>
                      </Fragment>
                    );
                  })}
                  {mode === 'gap' && at !== null && at >= peers.length && gap}
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

/** As the gallery was: columns that cards fill top to bottom, and no place to drop into. */
function MasonryGallery({ showStatus }: { showStatus: boolean }) {
  const state = board.use();
  const { project } = current(state);
  const tasks = listTasks(state, 'backlog');
  return (
    <ScrollArea edges className="flex-1 [--scrollbar-inset:0.5rem]">
      <ScrollAreaViewport>
        <div className="px-5 pt-1 pb-5">
          {tasks.length === 0 && (
            <p className="py-10 text-center text-muted-foreground text-sm">
              {state.awaitingTasks ? 'Loading tasks…' : 'Nothing here.'}
            </p>
          )}
          {groupByPriority(tasks)
            .filter((group) => group.tasks.length > 0)
            .map((band) => (
              <section key={band.priority}>
                <h3 className="zone-header" data-mode="label">
                  <span className="zone-header-face">{priorityName(project, band.priority)}</span>
                </h3>
                <div className="columns-[17rem] gap-4 pb-3">
                  {band.tasks.map((task) => (
                    <div key={task.id} className="mb-4 break-inside-avoid">
                      <TaskCard task={task} showStatus={showStatus} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
        </div>
      </ScrollAreaViewport>
      <ScrollBar />
    </ScrollArea>
  );
}
