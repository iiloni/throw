import { motion } from 'motion/react';
import { Fragment, type ReactNode } from 'react';
import { ScrollArea, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import { entryDelay, useEntryMotion } from '@/lib/entryMotion';
import { cn } from '@/lib/utils';
import { CARD_SPACING, drag, makingWay } from './drag';
import { hasPriorityIcon, PriorityIcon } from './glyphs';
import { groupByPriority, type Priority, priorityName, taskColor } from './model';
import { SwipeReveal } from './SwipeReveal';
import {
  board,
  createTask,
  current,
  type ListId,
  listStatusId,
  listTasks,
  sortedBySize,
  useBoardSettings,
  visibleIds,
} from './state';
import { TaskCard } from './TaskCard';
import { useTaskCardHidden } from './taskTransition';

/** A rail's height with the space under it, which is also how far apart they stack. */
const RAIL = 44;

type Props = {
  listId: ListId;
  header?: ReactNode;
  showStatus?: boolean;
  /** Space kept clear at the end of the list, for a dock floating over it. */
  endSpace?: string;
  /** Draw the column on its own faint surface, as Catch's deck does. */
  surface?: boolean;
  /** Take the side padding from the phone pager, which narrows it while a card is held. */
  tight?: boolean;
  /** Shown by opening a folded column: it fades in whole, so its cards skip their entry. */
  revealed?: boolean;
  className?: string;
};

type HeaderMode = 'hidden' | 'label' | 'open' | 'rail';

/**
 * A column of cards in five priority zones.
 *
 * At rest the zones are unmarked, or labelled if the user asks. Under a held card the column
 * either folds every zone but one into rails (`compact`) or keeps its layout and dims the
 * other zones (`full`); the drag engine reads the result from the DOM. A card just lifted
 * changes nothing but its own place, which stays open as a gap, until it moves.
 */
export function CardList({
  listId,
  header,
  showStatus,
  endSpace,
  surface,
  tight,
  revealed = false,
  className,
}: Props) {
  const state = board.use();
  const held = drag.use();
  const [settings] = useBoardSettings();
  const { project } = current(state);

  const dragging = held?.phase === 'dragging';
  const moving = makingWay(held);
  const target = dragging ? held.target : null;
  // Sorted by size, a column keeps no manual order: a card is sent to it, not placed in it,
  // and nothing in it moves while one is held (ADR 0008).
  const bySize = sortedBySize(state);
  const over =
    moving &&
    (target?.kind === 'status'
      ? bySize && target.statusId === listStatusId(listId)
      : target?.listId === listId);
  const place = target?.kind === 'place' && target.listId === listId ? target : null;
  const stretch = moving && place !== null && settings.heldColumn === 'compact';
  const inPlace = moving && place !== null && settings.heldColumn === 'full';

  // A held card stays mounted but out of the layout: a touch keeps reporting to the element
  // it began on, and stops if that element is removed.
  const lifted = (taskId: string) => dragging && held.ids.includes(taskId);
  const tasks = listTasks(state, listId);
  const groups: { priority: Priority | null; tasks: typeof tasks }[] = bySize
    ? [{ priority: null, tasks }]
    : groupByPriority(tasks);
  const open = held?.priority;
  const gapHeight = held ? held.height + CARD_SPACING : 0;
  // Cards arrive in a diagonal wave: across the columns, then down each one.
  const column = Math.max(
    0,
    project.statuses.findIndex((status) => `status:${status.id}` === listId),
  );
  const rows = new Map(tasks.map((task, row) => [task.id, row]));

  function mode(priority: Priority, count: number): HeaderMode {
    if (stretch) return priority === open ? 'open' : 'rail';
    if (inPlace) return 'label';
    return settings.zoneLabels && count > 0 ? 'label' : 'hidden';
  }

  return (
    <section
      aria-label={
        listId === 'backlog'
          ? 'Backlog tasks'
          : project.statuses.find((status) => status.id === listId.slice(7))?.name
      }
      data-drop-list={listId}
      data-drop-send={bySize ? '' : undefined}
      data-over={over ? '' : undefined}
      data-surface={surface && settings.surfaces ? '' : undefined}
      className={cn('board-column relative flex min-h-0 min-w-0 flex-col rounded-3xl', className)}
    >
      {header && (
        <EnteringHeader listId={listId} delay={entryDelay(column)} skip={revealed}>
          {header}
        </EnteringHeader>
      )}
      <ScrollArea edges className="card-scroller flex-1 [--scrollbar-inset:0.5rem]">
        <ScrollAreaViewport data-autoscroll="">
          <div
            className={cn(
              'flex flex-1 flex-col pt-1 pb-1',
              tight ? 'px-[var(--gutter)]' : 'px-3.5',
            )}
            style={endSpace ? { paddingBottom: endSpace } : undefined}
          >
            {groups.map(({ priority, tasks: zone }) => {
              if (priority === null)
                return (
                  <Fragment key="size">
                    {zone.map((task) => (
                      <div
                        key={task.id}
                        data-slot={task.id}
                        data-zone={task.priority}
                        className="board-slot"
                      >
                        <div>
                          <EnteringCard
                            taskId={task.id}
                            delay={entryDelay(column + (rows.get(task.id) ?? 0))}
                            skip={!!held || revealed}
                          >
                            <SwipeReveal taskId={task.id} />
                            <TaskCard task={task} showStatus={showStatus} />
                          </EnteringCard>
                        </div>
                      </div>
                    ))}
                  </Fragment>
                );
              const headerMode = mode(priority, zone.length);
              const folded = stretch && priority !== open;
              const accepts = stretch ? priority === open : inPlace || place?.priority === priority;
              const name = priorityName(project, priority);
              const placed = zone.filter((task) => !lifted(task.id));
              return (
                <Fragment key={priority}>
                  <div
                    data-zone-header={priority}
                    data-drop-rail={headerMode === 'rail' ? priority : undefined}
                    data-mode={headerMode}
                    data-current={moving && place?.priority === priority ? '' : undefined}
                    data-charging={
                      held?.rail?.listId === listId && held.rail.priority === priority
                        ? ''
                        : undefined
                    }
                    className="zone-header"
                    style={
                      headerMode === 'rail'
                        ? priority < (open ?? 0)
                          ? { top: (priority - 1) * RAIL }
                          : { bottom: (5 - priority) * RAIL }
                        : undefined
                    }
                  >
                    <div className="zone-header-face">
                      <span className="truncate">{name}</span>
                      {headerMode === 'rail' && (
                        <>
                          <span
                            aria-hidden
                            data-rail-detail=""
                            className="flex min-w-0 flex-1 items-center gap-0.5"
                          >
                            {placed.slice(0, 12).map((task) => (
                              <span
                                key={task.id}
                                data-color={taskColor(project, task) ?? undefined}
                                className="h-1.5 w-3 shrink-0 rounded-full bg-[var(--tint-accent,var(--muted-foreground))] opacity-60"
                              />
                            ))}
                          </span>
                          <span data-rail-detail="" className="tabular-nums opacity-70">
                            {placed.length || ''}
                          </span>
                        </>
                      )}
                      {headerMode === 'rail' && !hasPriorityIcon(priority) ? (
                        // Holds the chevron's place, so every rail's count lines up.
                        <span aria-hidden className="zone-chevron size-4 shrink-0" />
                      ) : (
                        <PriorityIcon priority={priority} className="zone-chevron" />
                      )}
                    </div>
                  </div>
                  {accepts && (
                    <Gap
                      active={place?.priority === priority && place.index === 0}
                      height={gapHeight}
                    />
                  )}
                  {zone.map((task) => {
                    // Same element either way, or React would remount the card mid-touch.
                    const away = lifted(task.id);
                    // Several held cards stay in place, faded, until they move; then the
                    // column closes up around them as it folds a zone.
                    const gathered = away && (held?.ids.length ?? 0) > 1;
                    const index = placed.indexOf(task);
                    return (
                      <Fragment key={task.id}>
                        <div
                          data-slot={task.id}
                          data-zone={priority}
                          hidden={away && !gathered}
                          data-folded={folded || (gathered && moving) ? '' : undefined}
                          data-dim={inPlace && place?.priority !== priority ? '' : undefined}
                          className="board-slot"
                        >
                          <div>
                            <EnteringCard
                              taskId={task.id}
                              delay={entryDelay(column + (rows.get(task.id) ?? 0))}
                              skip={!!held || revealed}
                            >
                              <SwipeReveal taskId={task.id} />
                              <TaskCard task={task} showStatus={showStatus} />
                            </EnteringCard>
                          </div>
                        </div>
                        {accepts && !away && (
                          <Gap
                            active={place?.priority === priority && place.index === index + 1}
                            height={gapHeight}
                          />
                        )}
                      </Fragment>
                    );
                  })}
                  {stretch && priority === open && <div className="min-h-6 flex-1" />}
                </Fragment>
              );
            })}
            {state.actions && (
              <button
                type="button"
                aria-label={`Add task to ${listId === 'backlog' ? 'backlog' : project.statuses.find((status) => status.id === listId.slice(7))?.name}`}
                onClick={() => createTask(listId === 'backlog' ? undefined : listId.slice(7))}
                className="mt-1 hidden min-h-11 items-center rounded-xl px-4 text-left text-muted-foreground text-sm outline-none hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring md:flex"
              >
                + Add task
              </button>
            )}
            {tasks.length === 0 && !moving && (
              <p className="px-1 py-10 text-center text-muted-foreground text-sm">
                {state.awaitingTasks
                  ? 'Loading tasks…'
                  : visibleIds(state)
                    ? 'Nothing matches here.'
                    : 'Nothing here.'}
              </p>
            )}
          </div>
        </ScrollAreaViewport>
        <ScrollBar />
      </ScrollArea>
      {over && target?.kind === 'list' && held && (
        <p className="pointer-events-none absolute inset-x-3 bottom-4 rounded-2xl bg-foreground py-2 text-center font-medium text-background text-sm">
          Move {held.ids.length} here
        </p>
      )}
    </section>
  );
}

/** Where the held card would land: the others part to make room for it. */
function Gap({ active, height }: { active: boolean; height: number }) {
  return (
    <div data-gap="" className="board-gap" style={{ height: active ? height : 0 }}>
      <div style={{ height: height - CARD_SPACING }} />
    </div>
  );
}

/**
 * A card's first arrival in the document (lib/entryMotion.ts): never again when it moves
 * column or sync updates it. A held card, or one a task is opening from or landing in, is
 * measured where it rests, so it shows at once, as is one a folded column opened to reveal.
 */
function EnteringCard({
  taskId,
  delay,
  skip,
  children,
}: {
  taskId: string;
  delay: number;
  skip: boolean;
  children: ReactNode;
}) {
  const hidden = useTaskCardHidden(taskId);
  const entry = useEntryMotion(`card:${taskId}`, true, delay, skip || hidden);
  return (
    <motion.div className="relative pb-3" style={entry}>
      {children}
    </motion.div>
  );
}

function EnteringHeader({
  listId,
  delay,
  skip,
  children,
}: {
  listId: ListId;
  delay: number;
  skip: boolean;
  children: ReactNode;
}) {
  return (
    <motion.div style={useEntryMotion(`column:${listId}`, true, delay, skip)}>
      {children}
    </motion.div>
  );
}
