import { ListTree, X } from 'lucide-react';
import {
  AnimatePresence,
  motion,
  frame as motionFrame,
  useMotionValueEvent,
  useTransform,
} from 'motion/react';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  BoardSearch,
  BoardSearchSidebar,
  SEARCH_SIDEBAR_MIN,
  SEARCH_SPACE,
} from '@/components/BoardSearch/BoardSearch';
import { IconButton } from '@/components/IconButton/IconButton';
import { ProjectIcon } from '@/components/ProjectIcon/ProjectIcon';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { BoardColumn, ColumnHeader } from './BoardColumn';
import { BoardSettingsPanel } from './BoardSettingsPanel';
import { CardList } from './CardList';
import { drag, makingWay } from './drag';
import type { Status } from './model';
import {
  type RailGeometry,
  railGeometry,
  SideZone,
  TILES_WIDTH,
  useRailSpring,
  ZONE_GAP,
} from './SideZone';
import { StatusMenu } from './StatusMenu';
import { StatusTile } from './StatusTile';
import {
  board,
  countIn,
  current,
  railResize,
  selectProject,
  sendTasks,
  setSubtasksAsCards,
  update,
  useBoardSettings,
  useCollapsedColumns,
  useRailWidths,
} from './state';
import { PANE_MIN, SplitHandle, TaskPane } from './TaskView';
import { TaskPaneWidthContext } from './taskMotionContext';

const HANDLE_WIDTH = 24;
/** The pane's `pr-6`: the closed rail reaches the window's edge, the pane does not. */
const PANE_MARGIN = 24;

export function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Rendered before the frame is painted, so what is laid out from the width (a gallery
    // beside the task pane sliding open) keeps up with it instead of trailing a frame behind.
    const observer = new ResizeObserver(([entry]) =>
      flushSync(() => setWidth(entry!.contentRect.width)),
    );
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
function ColumnsEdge({
  geometry,
  trailing = false,
}: {
  geometry: RailGeometry;
  trailing?: boolean;
}) {
  // The rail's own spring, so the columns move exactly with it: springing when it changes
  // state, following it while the row or its edge is resized.
  const rail = useRailSpring(geometry.zone, geometry.mode, geometry.tracking);
  return <EdgeSpacer rail={rail} trailing={trailing} />;
}

const EDGE = ZONE_GAP - COLUMN_GAP;

function EdgeSpacer({
  rail,
  trailing,
}: {
  rail: ReturnType<typeof useRailSpring>;
  trailing: boolean;
}) {
  const spring = useTransform(() => rail.value.get() + EDGE);
  const element = useRef<HTMLSpanElement>(null);
  const drawn = useRef<number | null>(null);
  // Measured once the new width is drawn: a scroller cannot scroll past what is laid out yet.
  const follow = useCallback(() => {
    const span = element.current;
    if (!trailing || !span) return;
    const now = span.getBoundingClientRect().width;
    const scroller = document.querySelector<HTMLElement>('[data-autoscroll-x]');
    if (scroller && drawn.current !== null) scroller.scrollLeft += now - drawn.current;
    drawn.current = now;
  }, [trailing]);
  useLayoutEffect(follow);
  useMotionValueEvent(spring, 'change', () => motionFrame.postRender(follow));
  const width = typeof rail.width === 'number' ? rail.width + EDGE : spring;
  return <motion.span ref={element} aria-hidden className="shrink-0" style={{ width }} />;
}

/** With the columns' own gap, the space between a bound rail and the column beside it. */
function RailGap() {
  return <span aria-hidden style={{ width: ZONE_GAP - COLUMN_GAP }} className="shrink-0" />;
}

/**
 * The board on a wide screen: backlog, active columns and the closed zone in a row, with an
 * open task taking width from all three.
 */
export function DesktopBoard({ onReset }: { onReset?: () => void }) {
  const state = board.use();
  const held = drag.use();
  const { project } = current(state);
  const [settings] = useBoardSettings();
  // Bound rails sit at the two ends of the columns' scroller and scroll away with them.
  const backlogBound = settings.backlogRail === 'bound';
  const closedBound = settings.closedRail === 'bound';
  const [frame, frameWidth] = useWidth();
  const [row, rowWidth] = useWidth();
  const [railWidths] = useRailWidths();
  const resizing = railResize.use();
  const active = project.statuses.filter((status) => status.category === 'active');
  const dragging = makingWay(held);
  // A gallery covers the columns. A held card still needs somewhere to go, so they come
  // back as dropzones for as long as it is held.
  const covered = state.backlog === 'full' || state.closed === 'full';
  const rails = railGeometry({
    rowWidth,
    views: { backlog: state.backlog, closed: state.closed },
    widths: railWidths,
    resize: resizing,
    holding: dragging,
    origin: held?.origin ?? null,
  });

  // A wheel turned where nothing scrolls up and down (the page, a rail's strip, a column
  // short enough to fit) moves the board sideways instead of doing nothing.
  useEffect(() => {
    const element = row.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      for (
        let node = event.target instanceof Element ? event.target : null;
        node && node !== element;
        node = node.parentElement
      ) {
        if (node.scrollHeight <= node.clientHeight + 1) continue;
        const overflow = getComputedStyle(node).overflowY;
        if (overflow === 'auto' || overflow === 'scroll') return;
      }
      const scroller = element.querySelector<HTMLElement>('[data-autoscroll-x]');
      if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;
      event.preventDefault();
      // Firefox reports a mouse wheel in lines.
      scroller.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 32 : 1);
    };
    // Not passive: the wheel is taken from the page only when the board uses it.
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [row]);

  // A bound closed rail opens past the end of the scroller, so the scroller follows it.
  const closedView = state.closed;
  const followed = useRef(closedView);
  useEffect(() => {
    if (followed.current === closedView) return;
    followed.current = closedView;
    const scroller = row.current?.querySelector<HTMLElement>('[data-autoscroll-x]');
    if (!closedBound || !scroller || closedView === 'strip') return;
    const started = performance.now();
    let frame = requestAnimationFrame(function follow(now) {
      scroller.scrollLeft = scroller.scrollWidth;
      if (now - started < 700) frame = requestAnimationFrame(follow);
    });
    return () => cancelAnimationFrame(frame);
  }, [closedBound, closedView, row]);

  const docked = frameWidth >= SEARCH_SIDEBAR_MIN;
  const backlogRail = <SideZone zone="backlog" geometry={rails.backlog} />;
  const closedRail = <SideZone zone="closed" geometry={rails.closed} />;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Stands where the navigation rail will be. */}
      {!state.actions && (
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
            onClick={() => setSubtasksAsCards(!state.subtasksAsCards)}
            className={cn('size-10', state.subtasksAsCards && 'bg-accent')}
          >
            <ListTree />
          </IconButton>
          <BoardSettingsPanel onReset={onReset} />
        </nav>
      )}

      <div ref={frame} className="flex min-w-0 flex-1 flex-col">
        {/* No title row: the rail names the project, and the board keeps the height. */}
        <div className="flex min-h-0 flex-1">
          {docked && <BoardSearchSidebar />}
          <div ref={row} className="relative flex min-w-0 flex-1">
            {!backlogBound && backlogRail}
            <div className="absolute inset-0 flex">
              {/* The columns carry the top and bottom margin, so a rail in here runs full height. */}
              <ScrollArea className="flex-1">
                <ScrollAreaViewport
                  data-origin="active"
                  data-autoscroll-x=""
                  data-inset-start={backlogBound ? 0 : rails.backlog.drawn}
                  data-inset-end={closedBound ? 0 : rails.closed.drawn}
                  className="[&>div]:!flex-row [&>div]:h-full [&>div]:gap-3"
                >
                  {backlogBound ? (
                    <>
                      {backlogRail}
                      <RailGap />
                    </>
                  ) : (
                    <ColumnsEdge geometry={rails.backlog} />
                  )}
                  {covered
                    ? dragging && (
                        <motion.div
                          className="mt-[calc(var(--safe-top)+1.25rem)] mb-6 flex shrink-0 flex-col gap-2.5 p-1"
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
                    : active.map((status, index) => (
                        <StatusColumn key={status.id} status={status} index={index} />
                      ))}
                  {closedBound ? (
                    <>
                      <RailGap />
                      {closedRail}
                    </>
                  ) : (
                    <ColumnsEdge geometry={rails.closed} trailing />
                  )}
                </ScrollAreaViewport>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </div>
            {/* Keeps a sticky closed rail at the far edge when the backlog is not beside it. */}
            <span aria-hidden className="pointer-events-none flex-1" />
            {!closedBound && closedRail}
            {!docked && <BoardSearch />}
          </div>

          <OpenTaskPane frameWidth={frameWidth} />
        </div>
      </div>

      <SelectionBar>
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
      </SelectionBar>
    </div>
  );
}

/** An active status's column, which folds to a strip and is remembered folded per project. */
function StatusColumn({ status, index }: { status: Status; index: number }) {
  const state = board.use();
  const { project } = current(state);
  const { isCollapsed, setCollapsed } = useCollapsedColumns(project);
  const count = countIn(state, status.id);
  return (
    <BoardColumn
      columnId={status.id}
      name={status.name}
      category={status.category}
      count={count}
      collapsed={isCollapsed(status.id)}
      onToggle={(value) => setCollapsed(status.id, value)}
      index={index}
      className="min-w-[17.5rem] max-w-[27rem] grow basis-[17.5rem]"
    >
      {(revealed) => (
        <CardList
          listId={`status:${status.id}`}
          revealed={revealed}
          endSpace={SEARCH_SPACE}
          className="flex-1 pb-2"
          header={
            <ColumnHeader
              name={status.name}
              count={count}
              onCollapse={() => setCollapsed(status.id, true)}
            />
          }
        />
      )}
    </BoardColumn>
  );
}

/**
 * The open task beside the board, taking width from it, with a handle to adjust the split.
 */
export function OpenTaskPane({ frameWidth }: { frameWidth: number }) {
  const state = board.use();
  const data = current(state);
  const [paneWidth, setPaneWidth] = useState(440);
  const [resizing, setResizing] = useState(false);
  const openTask = [...data.tasks, ...(data.hiddenTasks ?? [])].find(
    (task) => task.id === state.openTaskId,
  );
  return (
    <AnimatePresence initial={false}>
      {openTask && (
        <motion.div
          key="pane"
          className="flex shrink-0 overflow-hidden pt-[calc(var(--safe-top)+1.25rem)] pr-6 pb-[max(1.5rem,calc(var(--safe-bottom)+0.75rem))]"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: paneWidth + HANDLE_WIDTH + PANE_MARGIN, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={resizing ? { duration: 0 } : springs.pane}
        >
          <SplitHandle
            width={paneWidth}
            max={Math.max(PANE_MIN, frameWidth * 0.62)}
            onResize={setPaneWidth}
            onActive={setResizing}
          />
          <div className="min-w-0 flex-1" style={{ width: paneWidth }}>
            <TaskPaneWidthContext value={paneWidth}>
              <TaskPane task={openTask} />
            </TaskPaneWidthContext>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** What can be done with the cards selected on desktop, floating at the foot of the board. */
export function SelectionBar({ children }: { children: ReactNode }) {
  const state = board.use();
  const held = drag.use();
  return (
    <AnimatePresence>
      {state.selection.length > 0 && held?.phase !== 'dragging' && (
        <motion.div
          className={cn(
            'glass-thick -translate-x-1/2 fixed left-1/2 z-30 flex h-12 items-center gap-1 rounded-2xl pr-1.5 pl-4',
            // Above the search bar while it is open, which holds the same place.
            state.searching ? 'bottom-[calc(var(--board-search-space,0px)+1.25rem)]' : 'bottom-5',
          )}
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={springs.snappy}
        >
          <span className="pr-2 font-medium text-sm tabular-nums">
            {state.selection.length} selected
          </span>
          {children}
          <IconButton label="Clear selection" onClick={() => update({ selection: [] })}>
            <X />
          </IconButton>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
