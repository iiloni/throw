import { ListTree, X } from 'lucide-react';
import {
  AnimatePresence,
  animate,
  type MotionStyle,
  type MotionValue,
  motion,
  frame as motionFrame,
  PresenceContext,
  useIsPresent,
  useMotionValue,
  useMotionValueEvent,
  usePresence,
  useReducedMotion,
  useTransform,
} from 'motion/react';
import {
  memo,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import {
  BoardSearch,
  BoardSearchSidebar,
  SEARCH_SIDEBAR_MIN,
  SEARCH_SPACE,
  SIDEBAR_WIDTH,
} from '@/components/BoardSearch/BoardSearch';
import { IconButton } from '@/components/IconButton/IconButton';
import { ProjectIcon } from '@/components/ProjectIcon/ProjectIcon';
import { ScrollArea, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { afterPaint, animateSteadySpring, springs, stopSteady } from '@/lib/motion';
import { useMotionCheck } from '@/lib/useMotionCheck';
import { cn } from '@/lib/utils';
import { BoardColumn, ColumnHeader } from './BoardColumn';
import { BoardSettingsPanel } from './BoardSettingsPanel';
import { useSpotlightCleanup } from './blockers';
import { CardList } from './CardList';
import {
  CompactSplitBoard,
  useBoardHandoff,
  useCompactBoard,
  useWidening,
} from './CompactSplitBoard';
import { drag, makingWay } from './drag';
import { LayoutMorph } from './LayoutMorph';
import type { Status, Task } from './model';
import {
  SelectionControls,
  type SelectionTab,
  SelectionTabContent,
  selectedTasks,
  selectionTabs,
  selectionTabTitle,
} from './SelectionActions';
import { type RailGeometry, railGeometry, SideZone, useRailSpring, ZONE_GAP } from './SideZone';
import {
  type BoardState,
  board,
  clampTaskPaneWidth,
  countIn,
  current,
  railResize,
  selectProject,
  setSubtasksAsCards,
  setTaskPaneExpanded,
  setTaskPaneWidth,
  taskPaneResize,
  update,
  useBoardSettings,
  useCollapsedColumns,
  useRailWidths,
  useTaskPaneExpanded,
  useTaskPaneWidth,
} from './state';
import { PANE_MIN, SplitHandle, TaskPane } from './TaskView';
import { SelectionContentContext, TaskContentContext } from './taskContent';
import {
  TaskEditorReadyContext,
  TaskPaneExpandContext,
  TaskPaneWidthContext,
} from './taskMotionContext';

const HANDLE_WIDTH = 24;
/** The pane's `pr-6`: the closed rail reaches the window's edge, the pane does not. */
const PANE_MARGIN = 24;

/**
 * An element's width, followed as it changes. `hold` stops following it while nothing drawn
 * reads it, and takes it up again where it has got to: each change renders the board.
 */
export function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const held = useRef(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Rendered before the frame is painted, so what is laid out from the width (a gallery
    // beside the task pane sliding open) keeps up with it instead of trailing a frame behind.
    const observer = new ResizeObserver(([entry]) => {
      if (!held.current) flushSync(() => setWidth(entry!.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const hold = useCallback((holding: boolean) => {
    if (held.current === holding) return;
    held.current = holding;
    if (!holding && ref.current) setWidth(ref.current.getBoundingClientRect().width);
  }, []);
  return [ref, width, hold] as const;
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
  // A sticky rail lies over its end of the scroller, so the columns are cut at its edge rather
  // than at the scroller's: the board's side fade (styles.css) stands there, moving with it.
  useLayoutEffect(() => {
    const viewport = element.current?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!viewport) return;
    const property = trailing ? '--inset-right' : '--inset-left';
    const inset = (width: number) => viewport.style.setProperty(property, `${width}px`);
    inset(rail.value.get());
    const stop = rail.value.on('change', inset);
    return () => {
      stop();
      viewport.style.removeProperty(property);
    };
  }, [trailing, rail.value]);
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
  useSpotlightCleanup();
  const state = board.use();
  const held = drag.use();
  const { project } = current(state);
  const [settings] = useBoardSettings();
  // Bound rails sit at the two ends of the columns' scroller and scroll away with them.
  const backlogBound = settings.backlogRail === 'bound';
  const closedBound = settings.closedRail === 'bound';
  const [frame, frameWidth] = useWidth();
  const [row, rowWidth, holdRow] = useWidth();
  const docked = frameWidth >= SEARCH_SIDEBAR_MIN;
  const paneSpace = usePaneSpace(state, frameWidth);
  const [railWidths] = useRailWidths();
  const resizing = railResize.use();
  const active = project.statuses.filter((status) => status.category === 'active');
  const dragging = makingWay(held);
  // A gallery covers the columns. A held card still needs somewhere to go, so their statuses
  // join the dropzones of the rail beside it (`SideZone`), which leaves the gallery its width.
  const covered = state.backlog === 'full' || state.closed === 'full';
  const restWidth = boardRestWidth({ frameWidth, rowWidth, searching: state.searching, paneSpace });
  // Beside a task on a narrow window or an unfolded foldable, the board takes a phone's layout.
  const compact = useCompactBoard(restWidth, state.openTaskId !== null && paneSpace === 0);
  const handoff = useBoardHandoff(row, compact, project.id);
  const widening = useWidening(compact, restWidth, row);
  // The compact layout, and the full one while it is held at its resting width, are laid out
  // for that width: the row narrowing or widening under the task pane's slide would render
  // the whole board on every frame of it for nothing.
  useLayoutEffect(() => holdRow(compact || widening !== null), [compact, widening, holdRow]);
  const reduced = useReducedMotion() ?? false;
  const paneCover = usePaneCover(state);
  const rails = railGeometry({
    rowWidth: widening ?? rowWidth,
    restWidth,
    views: { backlog: state.backlog, closed: state.closed },
    widths: railWidths,
    resize: resizing,
    holding: dragging,
    origin: held?.origin ?? null,
    peek: state.railPeek,
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
          <BoardUnderPane {...paneCover}>
            {docked && <BoardSearchSidebar />}
            <div
              ref={row}
              className={cn(
                'relative flex min-w-0 flex-1',
                (compact || widening !== null) && 'overflow-hidden',
              )}
            >
              {compact ? (
                <CompactSplitBoard handoff={handoff} restWidth={restWidth} searchDocked={docked} />
              ) : (
                <>
                  {!backlogBound && backlogRail}
                  <div
                    data-board-layout=""
                    className="absolute inset-0 flex"
                    style={widening === null ? undefined : { width: widening, right: 'auto' }}
                  >
                    {/* The columns carry the top and bottom margin, so a rail in here runs full height. */}
                    <ScrollArea sides data-seam="" className="flex-1">
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
                        {!covered &&
                          active.map((status, index) => (
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
                </>
              )}
              {!docked && <BoardSearch />}
              <SelectionBar />
              <LayoutMorph root={row} compact={compact} reduced={reduced} />
            </div>
          </BoardUnderPane>

          <OpenTaskPane frameWidth={frameWidth} cover={paneCover.cover} />
        </div>
      </div>
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
      color={status.color}
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
              category={status.color ? status.category : undefined}
              count={count}
              onCollapse={() => setCollapsed(status.id, true)}
            />
          }
        />
      )}
    </BoardColumn>
  );
}

function openTaskOf(state: BoardState) {
  const data = current(state);
  return [...data.tasks, ...(data.hiddenTasks ?? [])].find((task) => task.id === state.openTaskId);
}

/** The effective task pane width: live drag width if held, otherwise stored, clamped to the frame. */
function useEffectivePaneWidth(frameWidth: number) {
  const [storedWidth] = useTaskPaneWidth();
  const liveWidth = taskPaneResize.use();
  return clampTaskPaneWidth(liveWidth ?? storedWidth, frameWidth, PANE_MIN);
}

/**
 * The row's resting width once the docked search sidebar and open task pane have finished
 * sliding: what the rails lay their galleries out for at once, as Catch's page takes its
 * width beside a note, so their cards move once instead of on every frame of either slide.
 */
export function boardRestWidth({
  frameWidth,
  rowWidth,
  searching,
  paneSpace,
}: {
  frameWidth: number;
  rowWidth: number;
  searching: boolean;
  paneSpace: number;
}) {
  const searchSpace = frameWidth >= SEARCH_SIDEBAR_MIN && searching ? SIDEBAR_WIDTH : 0;
  return frameWidth > 0 ? Math.max(0, frameWidth - searchSpace - paneSpace) : rowWidth;
}

/**
 * The width the open task pane takes from the board once it has slid open (or shut): what the
 * board lays its galleries out for at once, as Catch's page takes its width beside a note, so
 * their cards move once instead of on every frame of the slide.
 */
export function usePaneSpace(state: BoardState, frameWidth: number) {
  const paneWidth = useEffectivePaneWidth(frameWidth);
  return openTaskOf(state) ? paneWidth + HANDLE_WIDTH + PANE_MARGIN : 0;
}

/**
 * Whether the open task is expanded over the whole board, as Catch's “Expand note” takes the
 * Gallery's width. Only a real task can be: the prototype's has no control to collapse it.
 */
function useExpandedPane(state: BoardState) {
  const [stored] = useTaskPaneExpanded();
  const expandable = useContext(TaskContentContext) !== null;
  return { expandable, expanded: expandable && stored && openTaskOf(state) !== undefined };
}

/**
 * How far an expanded task covers the board (0 to 1), which the open pane drives, and whether
 * it is expanded over it now.
 */
export function usePaneCover(state: BoardState) {
  const cover = useMotionValue(0);
  return { cover, covering: useExpandedPane(state).expanded };
}

/**
 * The board, and its docked search, beside an open task. An expanding task grows over it as
 * it fades, and it stays mounted and laid out for the split beneath, so collapsing finds it as
 * it was: its columns, scroll and compact layout (`CompactSplitBoard`) never change for it.
 * Out of reach while covered, and not drawn once it is wholly hidden.
 */
export function BoardUnderPane({
  cover,
  covering,
  children,
}: {
  cover: MotionValue<number>;
  covering: boolean;
  children: ReactNode;
}) {
  const opacity = useTransform(() => 1 - cover.get());
  const hidden = useMotionCheck(cover, (value) => value >= 1);
  return (
    <motion.div
      data-board-under-pane=""
      inert={covering}
      aria-hidden={covering || undefined}
      className="flex min-w-0 flex-1"
      style={{ opacity, visibility: hidden ? 'hidden' : undefined }}
    >
      {children}
    </motion.div>
  );
}

/**
 * The open task beside the board, taking width from it, with a handle to adjust the split.
 * Expanded, it also grows over the board (`cover`) to the frame's full width.
 */
export const OpenTaskPane = memo(function OpenTaskPane({
  frameWidth,
  cover,
}: {
  frameWidth: number;
  cover?: MotionValue<number>;
}) {
  const state = board.use();
  const paneWidth = useEffectivePaneWidth(frameWidth);
  const [resizing, setResizing] = useState(false);
  const reduced = useReducedMotion();
  const openTask = openTaskOf(state);
  const { expandable, expanded } = useExpandedPane(state);

  useEffect(() => {
    if (!openTask) {
      taskPaneResize.set(null);
      setResizing(false);
    }
  }, [openTask]);

  useEffect(() => () => taskPaneResize.set(null), []);

  function resize(width: number, keyboard: boolean) {
    if (keyboard) {
      taskPaneResize.set(null);
      setTaskPaneWidth(width);
      return;
    }
    taskPaneResize.set(width);
  }

  function hold(active: boolean) {
    if (active) {
      setResizing(true);
      return;
    }
    const live = taskPaneResize.get();
    if (live !== null) setTaskPaneWidth(live);
    taskPaneResize.set(null);
    setResizing(false);
  }

  return (
    <AnimatePresence initial={false}>
      {openTask && (
        <OpenTaskPaneFrame
          key="pane"
          task={openTask}
          paneWidth={paneWidth}
          frameWidth={frameWidth}
          maxWidth={Math.max(PANE_MIN, frameWidth * 0.62)}
          expandable={expandable}
          expanded={expanded}
          cover={cover}
          resizing={resizing}
          reduced={!!reduced}
          onResize={resize}
          onActive={hold}
        />
      )}
    </AnimatePresence>
  );
});

/**
 * The clipping frame around the open task: outer padding would hold the frame open at its
 * margin width until unmount, and flex-shrinking the task would crush its card and side column
 * on every frame of the slide. Keeping padding and a minimum target width on the inner frame
 * slides the whole pane rigidly in and out without reflow or an end-of-close shift.
 */
function OpenTaskPaneFrame({
  task,
  paneWidth,
  frameWidth,
  maxWidth,
  expandable,
  expanded,
  cover,
  resizing,
  reduced,
  onResize,
  onActive,
}: {
  task: Task;
  paneWidth: number;
  frameWidth: number;
  maxWidth: number;
  expandable: boolean;
  expanded: boolean;
  cover?: MotionValue<number>;
  resizing: boolean;
  reduced: boolean;
  onResize: (width: number, keyboard: boolean) => void;
  onActive: (active: boolean) => void;
}) {
  const [present, safeToRemove] = usePresence();
  // Renders through the slide (the row's width follows it) hand over a new callback each time.
  const remove = useRef(safeToRemove);
  remove.current = safeToRemove;
  const totalWidth = paneWidth + HANDLE_WIDTH + PANE_MARGIN;
  // Already open as the board arrives: no slide in.
  const arrived = useContext(PresenceContext)?.initial === false;
  // How far open, apart from how wide: opening or closing the task swaps the board beside it
  // for another layout, whose mounting takes the first frames, so the slide steps by painted
  // frames and has all of its way still to go once they are drawn.
  const open = useMotionValue(arrived || reduced ? 1 : 0);
  // BlockNote waits for the pane to open, as it waits for the phone's task screen to settle:
  // loading and laying it out took frames from the middle of the slide.
  const [settled, setSettled] = useState(arrived || reduced);
  const target = useMotionValue(totalWidth);
  // Expanding grows the pane over the board to the frame's width, from 0 (beside the board) to
  // 1 (over all of it). The pane's place in the row stays its split width, so the board keeps
  // its layout beneath; the rest reaches over it by a negative margin. Opened or closed while
  // expanded, the pane slides at its expanded width, as rigidly as at its split one.
  const expansion = useMotionValue(expanded ? 1 : 0);
  const room = Math.max(0, frameWidth - totalWidth);
  const gained = useTransform(() => expansion.get() * room);
  const width = useTransform(() => open.get() * (target.get() + gained.get()));
  const marginLeft = useTransform(() => -open.get() * gained.get());
  // The task lays out at the width it is going to, so only expanding reflows it, as Catch's.
  // Its split width as React renders it (a handle resize lands at once), and what expanding
  // gains on top as a variable the expansion drives.
  const gainedLength = useTransform(() => `${gained.get()}px`);
  // Over the board's own layers (a floating search, the selection's dock) only while over it.
  const zIndex = useTransform(() => (gained.get() > 0 ? 40 : 'auto'));
  const handleOpacity = useTransform(() => 1 - expansion.get());
  useLayoutEffect(() => {
    if (!cover) return;
    const update = () => cover.set(expansion.get() * open.get());
    update();
    const stopExpansion = expansion.on('change', update);
    const stopOpen = open.on('change', update);
    return () => {
      stopExpansion();
      stopOpen();
      cover.set(0);
    };
  }, [cover, expansion, open]);
  useLayoutEffect(() => {
    const goal = expanded ? 1 : 0;
    // Opening (or opened) already at its width: no expansion to see. A closing pane keeps it.
    if (!present) return;
    if (reduced || open.get() === 0) {
      stopSteady(expansion);
      expansion.jump(goal);
      return;
    }
    if (expansion.get() === goal) return;
    // Reflowing the task for its new width takes the first frame: keep that out of the
    // spring's time, as Catch does. A reversal continues from where it is.
    const cancel = afterPaint(() => {
      void animateSteadySpring(expansion, goal, springs.pane);
    });
    return () => {
      cancel();
      stopSteady(expansion);
    };
  }, [expanded, expansion, open, present, reduced]);
  const expand = useMemo(
    () => (expandable ? { expanded, toggle: () => setTaskPaneExpanded(!expanded) } : null),
    [expandable, expanded],
  );
  // The task lays out for the width it rests at: its column and workspace (ADR 0012) spring
  // across their breakpoints on the same spring as the pane.
  const layoutWidth = expanded
    ? Math.max(paneWidth, frameWidth - HANDLE_WIDTH - PANE_MARGIN)
    : paneWidth;
  useEffect(() => {
    if (resizing || reduced) {
      target.jump(totalWidth);
      return;
    }
    const resized = animate(target, totalWidth, springs.pane);
    return () => resized.stop();
  }, [target, totalWidth, resizing, reduced]);
  useEffect(() => {
    if (reduced) {
      open.jump(present ? 1 : 0);
      if (present) setSettled(true);
      else remove.current?.();
      return;
    }
    let live = true;
    const leave = () => {
      if (!live || present) return;
      live = false;
      remove.current?.();
    };
    // Gone once it is shut, rather than once the spring's tail has come to rest: each step is
    // a painted frame, and a busy page paints few.
    const unsubscribe = open.on('change', (value) => {
      if (!present) {
        if (value < 0.002) leave();
      } else if (value > 0.99) setSettled(true);
    });
    void animateSteadySpring(open, present ? 1 : 0, springs.pane).then(() => {
      if (present) setSettled(true);
      leave();
    });
    return () => {
      live = false;
      unsubscribe();
      stopSteady(open);
    };
  }, [open, present, reduced]);
  return (
    <motion.div
      inert={!present}
      data-task-pane-frame=""
      data-expanded={expanded ? '' : undefined}
      className="relative h-full shrink-0 overflow-hidden"
      style={{ width, marginLeft, opacity: open, zIndex }}
    >
      <motion.div
        className="flex h-full w-full pt-[calc(var(--safe-top)+1.25rem)] pr-6 pb-[max(1.5rem,calc(var(--safe-bottom)+0.75rem))]"
        style={
          {
            '--pane-gained': gainedLength,
            minWidth: `calc(${totalWidth}px + var(--pane-gained, 0px))`,
          } as MotionStyle
        }
      >
        {/* Expanded, there is nothing beside the task to share the width with: the grip
            fades and is out of reach, and its place is the task's margin. */}
        <motion.div
          className="flex shrink-0"
          inert={expanded}
          aria-hidden={expanded || undefined}
          style={{ opacity: handleOpacity }}
        >
          <SplitHandle width={paneWidth} max={maxWidth} onResize={onResize} onActive={onActive} />
        </motion.div>
        <div className="h-full min-w-0 flex-1">
          <TaskPaneWidthContext value={layoutWidth}>
            <TaskPaneExpandContext value={expand}>
              <TaskEditorReadyContext value={settled}>
                <TaskPane task={task} />
              </TaskEditorReadyContext>
            </TaskPaneExpandContext>
          </TaskPaneWidthContext>
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * What can be done with the cards selected on desktop, floating at the foot of the board over
 * the columns, and above the search bar while it floats there too. Its controls are an open
 * task's dock: status, priority, size and tags grow their pickers upward out of it.
 */
export function SelectionBar() {
  const state = board.use();
  const held = drag.use();
  const reduced = useReducedMotion();
  const shown = state.selection.length > 0 && held?.phase !== 'dragging';
  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          key="selection"
          className="pointer-events-none absolute inset-x-0 bottom-[calc(var(--board-search-space,0px)+max(1.25rem,calc(var(--safe-bottom)+0.75rem)))] z-30 flex justify-center px-6"
          initial={{ y: reduced ? 0 : 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: reduced ? 0 : 24, opacity: 0 }}
          transition={reduced ? { duration: 0 } : springs.snappy}
        >
          <SelectionDock reduced={!!reduced} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SelectionDock({ reduced }: { reduced: boolean }) {
  const state = board.use();
  const content = useContext(SelectionContentContext);
  const { project } = current(state);
  const [chosen, setChosen] = useState<SelectionTab | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const id = useId();
  const tabs = selectionTabs(project, selectedTasks(state), content);
  // Tags close once the selection spans projects, and stay closed when it narrows again.
  if (chosen && !tabs.includes(chosen)) setChosen(null);
  const tab = chosen && tabs.includes(chosen) ? chosen : null;
  const collapse = useCallback(() => {
    setChosen(null);
    if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!tab) return;
    // As an open task's dock: Escape and a press elsewhere close the picker, keeping the
    // selection, which the next Escape lets go.
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      event.stopPropagation();
      collapse();
    }
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setChosen(null);
    }
    document.addEventListener('keydown', dismissOnEscape, true);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      document.removeEventListener('keydown', dismissOnEscape, true);
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [tab, collapse]);
  return (
    <div
      ref={root}
      className="glass-thick pointer-events-auto flex w-full max-w-md flex-col overflow-hidden rounded-[var(--dock-radius)]"
    >
      {/* After the panel in the flow, so Tab reaches the panel from the control that opened it. */}
      <div className="order-last flex h-[var(--dock-height)] items-center gap-1 pr-1.5 pl-4">
        <span className="shrink-0 pr-1 font-medium text-sm tabular-nums">
          {state.selection.length} selected
        </span>
        <div role="toolbar" aria-label="Selected tasks" className="h-full min-w-0 flex-1">
          <SelectionControls
            tabs={tabs}
            tooltips
            onOpen={(next, element) => {
              trigger.current = element;
              setChosen(next === tab ? null : next);
            }}
            controlProps={(name) => ({
              'aria-expanded': name === tab,
              'aria-controls': `${id}-${name}`,
            })}
          />
        </div>
        <IconButton
          label="Clear selection"
          shortcut="clearSelection"
          onClick={() => update({ selection: [] })}
        >
          <X />
        </IconButton>
      </div>
      <AnimatePresence initial={false}>
        {tab && (
          <SelectionPanelFrame
            key={tab}
            id={`${id}-${tab}`}
            label={selectionTabTitle[tab]}
            reduced={reduced}
          >
            <div
              className={cn(
                'px-2 pt-2 [--tags-max:min(55dvh,28rem)]',
                tab === 'tags'
                  ? 'flex max-h-[min(55dvh,28rem)] flex-col overflow-hidden'
                  : 'max-h-[min(55dvh,28rem)] overflow-y-auto overscroll-contain [scrollbar-width:thin]',
                tab === 'status' && 'px-3 pb-2',
              )}
            >
              <SelectionTabContent tab={tab} onDone={collapse} />
            </div>
          </SelectionPanelFrame>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A picker growing out of the selection's dock. A leaving one is inert. */
function SelectionPanelFrame({
  id,
  label,
  reduced,
  children,
}: {
  id: string;
  label: string;
  reduced: boolean;
  children: ReactNode;
}) {
  const isPresent = useIsPresent();
  return (
    <motion.div
      id={id}
      role="region"
      aria-label={label}
      inert={!isPresent}
      className="flex flex-col justify-end overflow-hidden [&>*]:shrink-0"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={reduced ? { duration: 0 } : springs.smooth}
    >
      {children}
    </motion.div>
  );
}
