import {
  CheckCheck,
  Inbox,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelRightClose,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { IconButton } from '@/components/IconButton/IconButton';
import { ScrollArea, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { CardList } from './CardList';
import { drag } from './drag';
import { type Category, groupByPriority, priorityName, type Status } from './model';
import { StatusTile } from './StatusTile';
import {
  board,
  countIn,
  current,
  listTasks,
  update,
  useBoardSettings,
  type ZoneState,
} from './state';
import { TaskCard } from './TaskCard';

export const ZONES = {
  backlog: { title: 'Backlog', categories: ['backlog'] as Category[], icon: Inbox },
  closed: { title: 'Closed', categories: ['done', 'cancelled'] as Category[], icon: CheckCheck },
};
export type Zone = keyof typeof ZONES;

export const STRIP_WIDTH = 64;
const PANEL_WIDTH = 304;

export function zoneWidth(view: ZoneState, fullWidth: number) {
  return view === 'full' ? fullWidth : view === 'panel' ? PANEL_WIDTH : STRIP_WIDTH;
}

export function zoneStatuses(zone: Zone, statuses: Status[]) {
  return statuses.filter((status) => ZONES[zone].categories.includes(status.category));
}

/**
 * The backlog or the closed zone: a strip, a column, or a gallery across the board. While a
 * card from elsewhere is held, it is a column of dropzones, one per status, whatever state
 * it was in.
 *
 * These are not columns and do not look like them: they are rails that run the height of
 * the window, over the ends of the columns' scroller, and never take a column's surface.
 */
export function SideZone({ zone, fullWidth }: { zone: Zone; fullWidth: number }) {
  const state = board.use();
  const held = drag.use();
  const [settings] = useBoardSettings();
  const { project } = current(state);
  const { title, icon: Icon } = ZONES[zone];
  const statuses = zoneStatuses(zone, project.statuses);
  const view = state[zone];
  const count = statuses.reduce((sum, status) => sum + countIn(state, status.id), 0);
  const dragging = held?.phase === 'dragging';
  // A card held from this zone keeps the zone as it is, so it can still be placed here.
  const tiles = dragging && held.origin !== zone;
  const width = zoneWidth(view, fullWidth);
  const other = zone === 'backlog' ? 'closed' : 'backlog';
  // A gallery takes the board, so the opposite zone steps back to its strip.
  const setView = (next: ZoneState) =>
    update((before) => ({ [zone]: next, [other]: next === 'full' ? 'strip' : before[other] }));

  return (
    <motion.aside
      aria-label={title}
      data-origin={zone}
      data-status-home={statuses.map((status) => status.id).join(' ')}
      data-side={zone === 'backlog' ? 'start' : 'end'}
      data-surface={settings.railSurface}
      className="board-rail relative z-20 flex min-h-0 shrink-0 flex-col overflow-hidden"
      initial={false}
      animate={{ width }}
      transition={springs.smooth}
    >
      <AnimatePresence initial={false}>
        {tiles ? (
          // The rail keeps its width and turns into the targets: nothing on the board moves
          // or is covered for a card that is only passing.
          <motion.div
            key="tiles"
            className={cn(
              'absolute inset-0 flex flex-col pt-[calc(var(--safe-top)+1.25rem)] pb-6',
              view === 'strip' ? 'gap-2 px-2' : 'gap-2.5 px-3.5',
            )}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            {view !== 'strip' && (
              <p className="px-1.5 pt-1.5 pb-1 font-semibold text-[0.6875rem] text-muted-foreground uppercase tracking-[0.06em]">
                {title}
              </p>
            )}
            {statuses.map((status) => (
              <StatusTile
                key={status.id}
                status={status}
                shape={view === 'strip' ? 'strip' : 'block'}
              />
            ))}
          </motion.div>
        ) : view === 'strip' ? (
          <motion.button
            key="strip"
            type="button"
            aria-label={`Open ${title.toLowerCase()}, ${count} tasks`}
            onClick={() => setView('panel')}
            className="group absolute inset-0 flex flex-col items-center gap-4 pt-[calc(var(--safe-top)+2.375rem)] text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:ring-inset"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            <Icon className="size-5" aria-hidden />
            <span className="font-display font-semibold text-sm [writing-mode:vertical-rl]">
              {title}
            </span>
            <span className="text-xs tabular-nums">{count}</span>
          </motion.button>
        ) : (
          <motion.div
            key="open"
            className="absolute inset-y-0 flex min-h-0 flex-col pt-[calc(var(--safe-top)+1.25rem)]"
            // Laid out at its resting width from the start, so opening reveals the cards
            // instead of re-wrapping them at every width on the way.
            style={{ width, [zone === 'backlog' ? 'left' : 'right']: 0 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex h-14 shrink-0 items-center gap-2 pr-2.5 pl-5">
              <h2 className="font-display font-semibold text-lg tracking-[-0.01em]">{title}</h2>
              <span className="flex-1 text-muted-foreground text-sm tabular-nums">{count}</span>
              <IconButton
                label={view === 'full' ? 'Back to a column' : 'Open as a gallery'}
                onClick={() => setView(view === 'full' ? 'panel' : 'full')}
              >
                {view === 'full' ? <Minimize2 /> : <Maximize2 />}
              </IconButton>
              <IconButton label={`Close ${title.toLowerCase()}`} onClick={() => setView('strip')}>
                {zone === 'backlog' ? <PanelLeftClose /> : <PanelRightClose />}
              </IconButton>
            </div>
            <StatusFilter zone={zone} />
            {view === 'full' ? (
              <Gallery zone={zone} />
            ) : zone === 'backlog' ? (
              <CardList
                listId="backlog"
                showStatus={state.backlogFilter === null}
                className="flex-1"
              />
            ) : (
              <ScrollArea className="flex-1 [--scrollbar-inset:0.5rem]">
                <ScrollAreaViewport>
                  <div className="space-y-3 px-3.5 pt-1 pb-4">
                    {listTasks(state, 'closed').map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        showStatus={state.closedFilter === null}
                      />
                    ))}
                  </div>
                </ScrollAreaViewport>
                <ScrollBar />
              </ScrollArea>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.aside>
  );
}

/**
 * The zone's statuses as filters. While one of the zone's own cards is held they are also
 * where it is dropped to change status, so they grow into targets.
 */
export function StatusFilter({ zone, className }: { zone: Zone; className?: string }) {
  const state = board.use();
  const held = drag.use();
  const statuses = zoneStatuses(zone, current(state).project.statuses);
  const filter = zone === 'backlog' ? state.backlogFilter : state.closedFilter;
  const setFilter = (value: string | null) =>
    update(zone === 'backlog' ? { backlogFilter: value } : { closedFilter: value });
  const targets = held?.phase === 'dragging' && held.origin === zone;
  if (statuses.length < 2) return null;
  const chip =
    'flex shrink-0 items-center rounded-full px-3.5 text-sm outline-none transition-[height,background-color,color,border-color] duration-200 focus-visible:ring-[3px] focus-visible:ring-ring/60';
  return (
    <div className={cn('flex shrink-0 flex-wrap items-center gap-2 px-4 pb-4', className)}>
      {!targets && (
        <button
          type="button"
          aria-pressed={filter === null}
          onClick={() => setFilter(null)}
          className={cn(
            chip,
            'h-8',
            filter === null
              ? 'bg-foreground text-background'
              : 'bg-foreground/[0.06] text-foreground/75 hover:bg-foreground/[0.1]',
          )}
        >
          All
        </button>
      )}
      {statuses.map((status) => {
        const over = held?.target?.kind === 'status' && held.target.statusId === status.id;
        return (
          <button
            key={status.id}
            type="button"
            data-drop-status={targets ? status.id : undefined}
            aria-pressed={filter === status.id}
            onClick={() => setFilter(filter === status.id ? null : status.id)}
            className={cn(
              chip,
              'border',
              targets ? 'h-11 flex-1 justify-center' : 'h-8',
              over
                ? 'border-brand bg-accent text-foreground'
                : filter === status.id && !targets
                  ? 'border-transparent bg-foreground text-background'
                  : 'border-transparent bg-foreground/[0.06] text-foreground/75 hover:bg-foreground/[0.1]',
            )}
          >
            {status.name}
          </button>
        );
      })}
    </div>
  );
}

/** A zone across the whole board: cards in as many columns as fit. */
function Gallery({ zone }: { zone: Zone }) {
  const state = board.use();
  const { project } = current(state);
  const tasks = listTasks(state, zone);
  const filter = zone === 'backlog' ? state.backlogFilter : state.closedFilter;
  const bands =
    zone === 'backlog'
      ? groupByPriority(tasks).filter((group) => group.tasks.length > 0)
      : [{ priority: null, tasks }];
  return (
    <ScrollArea className="flex-1 [--scrollbar-inset:0.5rem]">
      <ScrollAreaViewport>
        <div className="px-5 pt-1 pb-5">
          {bands.map((band) => (
            <section key={band.priority ?? 'all'}>
              {band.priority !== null && (
                <h3 className="zone-header" data-mode="label">
                  <span className="zone-header-face">{priorityName(project, band.priority)}</span>
                </h3>
              )}
              <div className="columns-[17rem] gap-4 pb-3">
                {band.tasks.map((task) => (
                  <div key={task.id} className="mb-4 break-inside-avoid">
                    <TaskCard task={task} showStatus={filter === null} />
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
