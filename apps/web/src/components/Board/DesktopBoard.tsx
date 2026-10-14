import { ListTree, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { IconButton } from '@/components/IconButton/IconButton';
import { ProjectIcon } from '@/components/ProjectIcon/ProjectIcon';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { BoardSettingsPanel } from './BoardSettingsPanel';
import { CardList } from './CardList';
import { drag } from './drag';
import { heldView, railWidth, SideZone, STRIP_WIDTH, zoneWidth } from './SideZone';
import { StatusMenu } from './StatusMenu';
import { StatusTile } from './StatusTile';
import { board, countIn, current, selectProject, sendTasks, update } from './state';
import { PANE_MIN, SplitHandle, TaskPane } from './TaskView';

const TILES_WIDTH = 176;
const HANDLE_WIDTH = 24;
/** The pane's `pr-6`: the closed rail reaches the window's edge, the pane does not. */
const PANE_MARGIN = 24;
/**
 * Between a rail and the first column beside it. The rails lie over the ends of the columns'
 * scroller, so scrolled columns pass through this space and on under the rail.
 */
const ZONE_GAP = 20;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** The columns' own gap, which follows each of the scroller's end spacers. */
const COLUMN_GAP = 12;

/**
 * Holds the first or last column clear of the rail that lies over that end of the scroller.
 *
 * Space growing at the start pushes the columns along by itself. At the end it would only
 * add room past the last column and leave the rail lying over it, so the scroller follows
 * the trailing spacer: the closed rail pushes the columns as the backlog does.
 */
function ColumnsEdge({ rail, trailing = false }: { rail: number; trailing?: boolean }) {
  const width = rail + ZONE_GAP - COLUMN_GAP;
  const drawn = useRef(width);
  return (
    <motion.span
      ref={(element) => {
        if (element && trailing) drawn.current = element.getBoundingClientRect().width;
      }}
      aria-hidden
      className="shrink-0"
      initial={false}
      animate={{ width }}
      transition={springs.smooth}
      onUpdate={(latest) => {
        if (!trailing || typeof latest.width !== 'number') return;
        const scroller = document.querySelector<HTMLElement>('[data-autoscroll-x]');
        if (scroller) scroller.scrollLeft += latest.width - drawn.current;
        drawn.current = latest.width;
      }}
    />
  );
}

/**
 * The board on a wide screen: backlog, active columns and the closed zone in a row, with an
 * open task taking width from all three.
 */
export function DesktopBoard() {
  const state = board.use();
  const held = drag.use();
  const { project, tasks } = current(state);
  const [frame, frameWidth] = useWidth();
  const [row, rowWidth] = useWidth();
  const [paneWidth, setPaneWidth] = useState(440);
  const [resizing, setResizing] = useState(false);
  const active = project.statuses.filter((status) => status.category === 'active');
  const openTask = tasks.find((task) => task.id === state.openTaskId);
  const dragging = held?.phase === 'dragging';
  // A gallery covers the columns. A held card still needs somewhere to go, so they come
  // back as dropzones for as long as it is held.
  const covered = state.backlog === 'full' || state.closed === 'full';
  const fullWidth = Math.max(
    0,
    rowWidth - STRIP_WIDTH - ZONE_GAP * 2 - (dragging ? TILES_WIDTH : 0),
  );

  // Whether each rail is showing dropzones: a card is held that did not come from it.
  const backlogTiles = dragging && held.origin !== 'backlog';
  const closedTiles = dragging && held.origin !== 'closed';
  const backlogWidth = zoneWidth(heldView(state.backlog, backlogTiles), fullWidth);
  const closedWidth = zoneWidth(heldView(state.closed, closedTiles), fullWidth);

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Stands where the navigation rail will be. */}
      <nav
        aria-label="Projects"
        className="flex w-[4.5rem] shrink-0 flex-col items-center gap-2 border-border/70 border-r pt-[calc(var(--safe-top)+1.25rem)] pb-6"
      >
        {state.boards.map(({ project: item }) => (
          // The collapsed rail shows icons only; the name arrives on hover.
          <Tooltip key={item.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-color={item.color}
                aria-label={item.name}
                aria-current={item.id === project.id ? 'page' : undefined}
                onClick={() => selectProject(item.id)}
                className={cn(
                  'flex size-11 items-center justify-center rounded-2xl outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/60',
                  item.id === project.id
                    ? 'bg-tint text-foreground'
                    : 'text-muted-foreground hover:bg-foreground/[0.06]',
                )}
              >
                <ProjectIcon name={item.icon} className="size-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              sideOffset={10}
              variant="glass"
              className="rounded-xl px-3.5 py-2 font-display font-semibold text-base tracking-[-0.01em]"
            >
              {item.name}
            </TooltipContent>
          </Tooltip>
        ))}
        <span className="flex-1" />
        <IconButton
          label={
            state.subtasksAsCards ? 'Keep subtasks with their parent' : 'Show subtasks as cards'
          }
          aria-pressed={state.subtasksAsCards}
          onClick={() => update({ subtasksAsCards: !state.subtasksAsCards })}
          className={cn('size-10', state.subtasksAsCards && 'bg-accent')}
        >
          <ListTree />
        </IconButton>
        <BoardSettingsPanel />
      </nav>

      <div ref={frame} className="flex min-w-0 flex-1 flex-col">
        {/* No title row: the rail names the project, and the board keeps the height. */}
        <div className="flex min-h-0 flex-1">
          <div ref={row} className="relative flex min-w-0 flex-1 justify-between">
            <SideZone zone="backlog" fullWidth={fullWidth} />
            <div className="absolute inset-0 flex">
              <ScrollArea className="flex-1 pt-[calc(var(--safe-top)+1.25rem)] pb-6">
                <ScrollAreaViewport
                  data-origin="active"
                  data-autoscroll-x=""
                  data-inset-start={railWidth(state.backlog, fullWidth, backlogTiles)}
                  data-inset-end={railWidth(state.closed, fullWidth, closedTiles)}
                  className="[&>div]:!flex-row [&>div]:h-full [&>div]:gap-3"
                >
                  <ColumnsEdge rail={backlogWidth} />
                  {covered
                    ? dragging && (
                        <motion.div
                          className="flex shrink-0 flex-col gap-2.5 p-1"
                          style={{ width: TILES_WIDTH }}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                        >
                          <p className="px-1 pt-1 font-semibold text-[0.6875rem] text-muted-foreground uppercase tracking-[0.06em]">
                            Active
                          </p>
                          {active.map((status) => (
                            <StatusTile key={status.id} status={status} />
                          ))}
                        </motion.div>
                      )
                    : active.map((status) => (
                        <CardList
                          key={status.id}
                          listId={`status:${status.id}`}
                          surface
                          className="min-w-[17.5rem] max-w-[27rem] flex-1 pb-2"
                          header={
                            <div className="flex h-14 shrink-0 items-center gap-2.5 px-5">
                              <h2 className="truncate font-display font-semibold text-lg tracking-[-0.01em]">
                                {status.name}
                              </h2>
                              <span className="rounded-full bg-foreground/[0.07] px-2 py-0.5 text-muted-foreground text-xs tabular-nums">
                                {countIn(state, status.id)}
                              </span>
                            </div>
                          }
                        />
                      ))}
                  <ColumnsEdge rail={closedWidth} trailing />
                </ScrollAreaViewport>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </div>
            <SideZone zone="closed" fullWidth={fullWidth} />
          </div>

          <AnimatePresence initial={false}>
            {openTask && (
              <motion.div
                key="pane"
                className="flex shrink-0 overflow-hidden pt-[calc(var(--safe-top)+1.25rem)] pr-6 pb-6"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: paneWidth + HANDLE_WIDTH + PANE_MARGIN, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={resizing ? { duration: 0 } : springs.smooth}
              >
                <SplitHandle
                  width={paneWidth}
                  max={Math.max(PANE_MIN, frameWidth * 0.62)}
                  onResize={setPaneWidth}
                  onActive={setResizing}
                />
                <div className="min-w-0 flex-1" style={{ width: paneWidth }}>
                  <TaskPane task={openTask} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {state.selection.length > 0 && !dragging && (
          <motion.div
            className="glass-thick -translate-x-1/2 fixed bottom-5 left-1/2 z-30 flex h-12 items-center gap-1 rounded-2xl pr-1.5 pl-4"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={springs.snappy}
          >
            <span className="pr-2 font-medium text-sm tabular-nums">
              {state.selection.length} selected
            </span>
            <StatusMenu
              project={project}
              onSelect={(statusId) => {
                sendTasks(state.selection, statusId);
                update({ selection: [] });
              }}
            >
              <Button size="sm" className="rounded-xl">
                Move to
              </Button>
            </StatusMenu>
            <IconButton label="Clear selection" onClick={() => update({ selection: [] })}>
              <X />
            </IconButton>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
