import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { CARD_SPACING, drag } from './drag';
import { groupByPriority, type Priority, priorityName, taskColor } from './model';
import { board, current, type ListId, listTasks, useVariants } from './state';
import { TaskCard } from './TaskCard';

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
  className?: string;
};

type HeaderMode = 'hidden' | 'label' | 'open' | 'rail';

/**
 * A column of cards in five priority zones.
 *
 * At rest the zones are marked as the `zonesAtRest` variant says. Under a held card the
 * column either folds every zone but one into rails (`stretch`) or keeps its layout and
 * dims the other zones (`inPlace`); the drag engine reads the result from the DOM.
 */
export function CardList({ listId, header, showStatus, endSpace, surface, className }: Props) {
  const state = board.use();
  const held = drag.use();
  const [variants] = useVariants();
  const { project } = current(state);

  const dragging = held?.phase === 'dragging';
  const target = dragging ? held.target : null;
  const over = target !== null && target.kind !== 'status' && target.listId === listId;
  const place = over && target.kind === 'place' ? target : null;
  const stretch = place !== null && variants.zoneModel === 'stretch';
  const inPlace = place !== null && variants.zoneModel === 'inPlace';

  // A held card stays mounted but out of the layout: a touch keeps reporting to the element
  // it began on, and stops if that element is removed.
  const lifted = (taskId: string) => dragging && held.ids.includes(taskId);
  const tasks = listTasks(state, listId);
  const groups = groupByPriority(tasks);
  const open = held?.priority;
  const gapHeight = held ? held.height + CARD_SPACING : 0;

  function mode(priority: Priority, count: number): HeaderMode {
    if (stretch) return priority === open ? 'open' : 'rail';
    if (inPlace) return 'label';
    return variants.zonesAtRest === 'always' && count > 0 ? 'label' : 'hidden';
  }

  return (
    <section
      data-drop-list={listId}
      data-over={over ? '' : undefined}
      data-surface={surface ? '' : undefined}
      className={cn('board-column relative flex min-h-0 min-w-0 flex-col rounded-3xl', className)}
    >
      {header}
      <div data-autoscroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div
          className="flex min-h-full flex-col px-3.5 pt-1 pb-1"
          style={endSpace ? { paddingBottom: endSpace } : undefined}
        >
          {groups.map(({ priority, tasks: zone }, groupIndex) => {
            const headerMode = mode(priority, zone.length);
            const folded = stretch && priority !== open;
            const accepts = stretch ? priority === open : inPlace;
            const name = priorityName(project, priority);
            const placed = zone.filter((task) => !lifted(task.id));
            return (
              <Fragment key={priority}>
                <div
                  data-zone-header={priority}
                  data-drop-rail={headerMode === 'rail' ? priority : undefined}
                  data-mode={headerMode}
                  data-current={place?.priority === priority ? '' : undefined}
                  data-charging={
                    held?.rail?.listId === listId && held.rail.priority === priority
                      ? ''
                      : undefined
                  }
                  // A little air between zones when nothing else separates them.
                  data-breath={
                    variants.zonesAtRest === 'edge' &&
                    zone.length > 0 &&
                    groups.slice(0, groupIndex).some((group) => group.tasks.length > 0)
                      ? ''
                      : undefined
                  }
                  className="zone-header"
                  style={
                    headerMode === 'rail'
                      ? priority < (open ?? 0)
                        ? { top: priority * RAIL }
                        : { bottom: (4 - priority) * RAIL }
                      : undefined
                  }
                >
                  <div className="zone-header-face">
                    <span className="truncate">{name}</span>
                    {headerMode === 'rail' && (
                      <>
                        <span aria-hidden className="flex min-w-0 flex-1 items-center gap-0.5">
                          {placed.slice(0, 12).map((task) => (
                            <span
                              key={task.id}
                              data-color={taskColor(project, task) ?? undefined}
                              className="h-1.5 w-3 shrink-0 rounded-full bg-[var(--tint-accent,var(--muted-foreground))] opacity-60"
                            />
                          ))}
                        </span>
                        <span className="tabular-nums opacity-70">{placed.length || ''}</span>
                      </>
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
                  const index = placed.indexOf(task);
                  return (
                    <Fragment key={task.id}>
                      <div
                        data-slot={task.id}
                        data-zone={priority}
                        hidden={away}
                        data-folded={folded ? '' : undefined}
                        data-dim={inPlace && place?.priority !== priority ? '' : undefined}
                        className="board-slot"
                      >
                        <div>
                          <div className="relative pb-3">
                            {variants.zonesAtRest === 'edge' && (
                              <span
                                aria-hidden
                                data-rank={priority}
                                data-first={index === 0 ? '' : undefined}
                                data-last={index === placed.length - 1 ? '' : undefined}
                                className="zone-edge"
                              />
                            )}
                            <TaskCard task={task} showStatus={showStatus} />
                          </div>
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
          {tasks.length === 0 && !dragging && (
            <p className="px-1 py-10 text-center text-muted-foreground text-sm">Nothing here.</p>
          )}
        </div>
      </div>
      {over && target.kind === 'list' && held && (
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
