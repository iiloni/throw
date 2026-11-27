import { CheckCheck, Columns3, Inbox, type LucideIcon, Plus } from 'lucide-react';
import {
  AnimatePresence,
  animate,
  motion,
  useIsPresent,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react';
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { AnimatedHeight } from '@/components/AnimatedHeight/AnimatedHeight';
import { SEARCH_SPACE } from '@/components/BoardSearch/BoardSearch';
import { haptics } from '@/lib/haptics';
import { afterPaint, springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { CardList } from './CardList';
import { drag, makingWay, PAGE_HOLD_MS, pageStride } from './drag';
import { GALLERY_INSET, ZoneGallery } from './Gallery';
import type { Status } from './model';
import { FlowTrack, PeekEdge, pageClass } from './PhoneBoard';
import { StatusFilter, ZONES, zoneStatuses } from './SideZone';
import { StatusTile } from './StatusTile';
import { type BoardState, board, createTask, current, useCollapsedColumns } from './state';
import { useColumnPager } from './useColumnPager';

/**
 * Below this width the board beside an open task gives up its rails and row of columns for a
 * phone's layout. The rails' strips and the gaps beside them take 168 px, so a board this
 * narrow showed one column and a sliver of the next: an unfolded foldable, or a narrow
 * desktop window, with a task open.
 */
export const COMPACT_BELOW = 520;
/** Once compact, the board waits for this much room to lay its columns out again. */
export const COMPACT_LEAVE = 560;

/**
 * Whether a board this wide is compact, given whether it is now. The two thresholds keep a
 * split handle dragged across the line from switching layouts back and forth under it.
 * Unmeasured (0), the board stays as it is.
 */
export function compactFor(restWidth: number, compact: boolean) {
  if (restWidth <= 0) return compact;
  return compact ? restWidth < COMPACT_LEAVE : restWidth < COMPACT_BELOW;
}

/**
 * Whether the board lays itself out compactly, from its resting width (`boardRestWidth`): the
 * width it will have once the task pane has slid open or shut, so the layout changes once, as
 * the pane starts to move, rather than part way through.
 *
 * `arriving` is a task opened before its card has reached the board, as one just made is for a
 * render: the pane's room is unknown until it does, so the board keeps the layout it has
 * rather than taking the full one for a frame and starting over.
 */
export function useCompactBoard(restWidth: number, arriving = false) {
  const [compact, setCompact] = useState(false);
  const next = arriving ? compact : compactFor(restWidth, compact);
  if (next !== compact) setCompact(next);
  return next;
}

/**
 * The width the full layout lays itself out at while it takes over from the compact one: its
 * resting width at once, clipped by the half (`overflow-hidden`) as the task pane slides shut,
 * as the compact layout takes its own as the pane opens. Its columns are then laid out once,
 * where the cards carried back to them land, rather than on every frame of the slide. Null
 * once the half has reached it, and at any other time.
 */
export function useWidening(
  compact: boolean,
  restWidth: number,
  row: RefObject<HTMLElement | null>,
) {
  const [was, setWas] = useState(compact);
  const [widening, setWidening] = useState(false);
  let now = widening;
  if (was !== compact) {
    setWas(compact);
    setWidening(!compact);
    now = !compact;
  }
  useEffect(() => {
    const element = row.current;
    if (!now || !element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width >= restWidth - 0.5) setWidening(false);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [now, restWidth, row]);
  return now && restWidth > 0 ? restWidth : null;
}

export type CompactView = 'backlog' | 'board' | 'closed';

/**
 * What one layout of the board leaves for the other as it takes over: the column it was on,
 * how far each list was scrolled, and the compact board's view.
 */
export type BoardHandoff = {
  scope: string;
  column: string | null;
  lists: Map<string, number>;
  view: CompactView | null;
};

/** A list's scroller by the list it scrolls, the same in either layout. */
function listKey(scroller: HTMLElement) {
  const list = scroller.closest<HTMLElement>('[data-drop-list], [data-drop-status]');
  return list?.dataset.dropList ?? list?.dataset.dropStatus ?? null;
}

/** The first column at least half in view across the board's scroller. */
function columnInView(scroller: HTMLElement) {
  const start = scroller.getBoundingClientRect().left + Number(scroller.dataset.insetStart ?? 0);
  for (const column of scroller.querySelectorAll<HTMLElement>('[data-column]')) {
    const { left, width } = column.getBoundingClientRect();
    if (left + width / 2 >= start) return column.dataset.column ?? null;
  }
  return null;
}

/** Restores each list's remembered scroll under `root`. */
export function restoreLists(root: HTMLElement, handoff: BoardHandoff) {
  for (const scroller of root.querySelectorAll<HTMLElement>('[data-autoscroll]')) {
    const key = listKey(scroller);
    const top = key === null ? undefined : handoff.lists.get(key);
    if (top) scroller.scrollTop = top;
  }
}

/**
 * Carries the board's place between its full and compact layouts, under `root`: the column in
 * view and each list's scroll are kept as they change, and given to whichever layout takes
 * over. Selection and the open task live in the board's store, so they carry over on their
 * own. `LayoutMorph` carries the cards across from one layout to the other.
 */
export function useBoardHandoff(
  root: RefObject<HTMLElement | null>,
  compact: boolean,
  scope: string,
) {
  const memory = useRef<BoardHandoff | null>(null);
  if (memory.current?.scope !== scope)
    memory.current = { scope, column: null, lists: new Map(), view: null };
  const handoff = memory.current;
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const remember = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.dataset.autoscrollX !== undefined) {
        handoff.column = columnInView(target) ?? handoff.column;
        return;
      }
      if (target.dataset.autoscroll === undefined) return;
      const key = listKey(target);
      if (key !== null) handoff.lists.set(key, target.scrollTop);
    };
    // Scroll does not bubble; the board hears its lists' on the way down.
    element.addEventListener('scroll', remember, { capture: true, passive: true });
    return () => element.removeEventListener('scroll', remember, { capture: true });
  }, [root, handoff]);

  const last = useRef(compact);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs as the layout changes
  useLayoutEffect(() => {
    if (last.current === compact) return;
    last.current = compact;
    const element = root.current;
    if (!element) return;
    restoreLists(element, handoff);
    if (compact) return;
    const scroller = element.querySelector<HTMLElement>('[data-autoscroll-x]');
    const column =
      handoff.column === null
        ? null
        : scroller?.querySelector<HTMLElement>(`[data-column="${CSS.escape(handoff.column)}"]`);
    if (scroller && column) {
      const start =
        scroller.getBoundingClientRect().left + Number(scroller.dataset.insetStart ?? 0);
      scroller.scrollLeft += column.getBoundingClientRect().left - start - COLUMN_MARGIN;
    }
  }, [compact]);

  return handoff;
}

/** Room left before a column brought back into view, as the board's own edge leaves. */
const COLUMN_MARGIN = 20;

/**
 * The compact board's surface. It takes its resting width (`boardRestWidth`) at once, as the
 * full layout's rails do, so its cards are laid out once rather than on every frame of the
 * task pane's slide; the half clips it while the pane is on its way.
 */
export function CompactFrame({ width, children }: { width?: number; children: ReactNode }) {
  return (
    <div
      data-board-layout=""
      data-compact-board=""
      className="relative flex min-w-0 flex-1 shrink-0 flex-col pt-[calc(var(--safe-top)+1.25rem)]"
      style={width ? { width, flex: 'none' } : undefined}
    >
      {children}
    </div>
  );
}

/**
 * A board's columns one at a time, as a phone pages through them, under the flow track that
 * names the current one and folds and opens them. A held card turns the page at either side.
 */
export function CompactPager({
  columns,
  handoff,
  start = null,
  shown = true,
  origin,
  onPage,
  page: renderPage,
}: {
  columns: Status[];
  handoff: BoardHandoff;
  /** The column to open on when the full layout left none. */
  start?: string | null;
  /** Off screen behind another view, its pager does not turn under a held card. */
  shown?: boolean;
  origin: (column: Status) => string;
  /** Hears the column on screen as it changes. */
  onPage?: (column: string) => void;
  page: (column: Status) => ReactNode;
}) {
  const state = board.use();
  const { project } = current(state);
  const collapsed = useCollapsedColumns(project);
  // Opened beside a task, it opens on the task's own column.
  const opened = openStatusOf(state);
  const { pagerRef, pages, page, pager, turnTo, folding } = useColumnPager(
    columns,
    collapsed,
    columns.some((column) => column.id === opened) ? opened : (handoff.column ?? start),
  );
  const id = pages[page]?.id ?? null;
  useEffect(() => {
    if (id === null) return;
    handoff.column = id;
    onPage?.(id);
  }, [id, handoff, onPage]);
  // Hidden behind another view the pager loses its scroll; shown again, it is on its page.
  // Firefox snaps it back to the start once it is laid out again, so it is placed once more
  // after the frame is drawn.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs as the pager is shown
  useLayoutEffect(() => {
    const element = pagerRef.current;
    if (!shown || !element) return;
    const place = () => {
      const left = page * pageStride(element);
      if (Math.abs(element.scrollLeft - left) > 1) element.scrollLeft = left;
    };
    place();
    return afterPaint(place);
  }, [shown]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div data-morph-enter="">
        <FlowTrack statuses={pages} page={page} onTurn={turnTo} folding={folding} />
      </div>
      {/* Clipped, so the pages peeking in at its sides stay inside the board's half. */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div
          ref={pagerRef}
          data-pager={shown ? '' : undefined}
          {...pager}
          className="phone-pager flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
        >
          {pages.map((column) => (
            <div key={column.id} data-page="" data-origin={origin(column)} className={pageClass}>
              {renderPage(column)}
            </div>
          ))}
        </div>
        <PeekEdge side={-1} shown={page > 0} />
        <PeekEdge side={1} shown={page < pages.length - 1} />
      </div>
    </div>
  );
}

/** How far the dock floats off the board's foot, as the search bar does. */
const DOCK_LIFT = 'max(1.25rem, calc(var(--safe-bottom) + 0.75rem))';
/** The room a list leaves at its end, so its last card scrolls clear of the dock. */
const DOCK_END = `max(${SEARCH_SPACE}, calc(var(--dock-height) + ${DOCK_LIFT} + 0.75rem))`;
/** How far a list scrolls one way before the dock slides away or back, as Catch's does. */
const DOCK_TRAVEL = 48;

/**
 * Whether the dock has slid away under a list scrolled down, as Catch's dock does under its
 * page: once any list under `root` has travelled `DOCK_TRAVEL` down it goes, and as far back
 * up, or near a list's top, it returns. A column turned or a view chosen (`reset`) starts with
 * it in view, as does focus entering it.
 */
export function useDockScroll(
  root: RefObject<HTMLElement | null>,
  dock: RefObject<HTMLElement | null>,
  enabled: boolean,
  reset: string,
) {
  const [hidden, setHidden] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new view or column starts with the dock in view
  useLayoutEffect(() => {
    setHidden(false);
    const element = root.current;
    if (!enabled || !element) return;
    const last = new WeakMap<HTMLElement, number>();
    const at = (list: HTMLElement) =>
      Math.max(0, Math.min(list.scrollTop, list.scrollHeight - list.clientHeight));
    let travel = 0;
    // A view shown again restores its lists after layout: where they are then is where they start.
    let ready = false;
    const frame = requestAnimationFrame(() => {
      ready = true;
      for (const list of element.querySelectorAll<HTMLElement>('[data-autoscroll]'))
        last.set(list, at(list));
    });
    const reveal = () => {
      travel = 0;
      setHidden(false);
    };
    const onScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.dataset.pager !== undefined) return reveal();
      if (target.dataset.autoscroll === undefined) return;
      const y = at(target);
      const before = last.get(target);
      last.set(target, y);
      if (!ready || before === undefined) return;
      // Keyboard focus never lands in a dock that is away.
      if (y < DOCK_TRAVEL || dock.current?.querySelector(':focus-visible')) return reveal();
      const delta = y - before;
      if (!delta) return;
      travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
      if (Math.abs(travel) < DOCK_TRAVEL) return;
      setHidden(travel > 0);
      travel = 0;
    };
    const face = dock.current;
    // Scroll does not bubble; the board hears its lists' on the way down.
    element.addEventListener('scroll', onScroll, { capture: true, passive: true });
    face?.addEventListener('focusin', reveal);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('scroll', onScroll, { capture: true });
      face?.removeEventListener('focusin', reveal);
    };
  }, [enabled, reset]);
  return enabled && hidden;
}

/** The status of the task open beside the board, if it is among the board's tasks. */
function openStatusOf(state: BoardState) {
  const { tasks, hiddenTasks = [] } = current(state);
  const id = state.openTaskId;
  if (id === null) return null;
  return (
    tasks.find((task) => task.id === id)?.statusId ??
    hiddenTasks.find((task) => task.id === id)?.statusId ??
    null
  );
}

/** The compact board's view holding a status's tasks. */
function viewOf(status: Status | undefined): CompactView | null {
  if (!status) return null;
  if (status.category === 'active') return 'board';
  return ZONES.backlog.categories.includes(status.category) ? 'backlog' : 'closed';
}

/**
 * The project board beside an open task when there is too little room for its row: a phone's
 * board in the desktop's half. The backlog, the columns and the closed tasks are three views
 * of the same width under one switch in a dock along the foot, as Catch's tabs are, with the
 * create button floating beside it, so cards keep the whole half rather than sharing it with
 * two rails' strips. The columns page one at a
 * time. The dock slides away as a list scrolls down and back as it scrolls up, and gives its
 * place to the search and selection bars. While a card is held it holds the statuses of the
 * other views, and holding the card on the board's own target opens the columns to place it in.
 */
export function CompactSplitBoard({
  handoff,
  restWidth,
  searchDocked = false,
}: {
  handoff: BoardHandoff;
  /** Its resting width, for `CompactFrame`. */
  restWidth?: number;
  /** Search is a sidebar beside the board rather than a bar over its foot. */
  searchDocked?: boolean;
}) {
  const state = board.use();
  const held = drag.use();
  const { project } = current(state);
  const ids = useId();
  const body = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // It opens on the view holding the task beside it, where the card just tapped is.
  const [view, setViewState] = useState<CompactView>(
    () =>
      viewOf(project.statuses.find((status) => status.id === openStatusOf(state))) ??
      handoff.view ??
      (state.backlog === 'full' ? 'backlog' : state.closed === 'full' ? 'closed' : 'board'),
  );
  const setView = (next: CompactView) => {
    handoff.view = next;
    setViewState(next);
  };
  // Each view is first drawn when it is first shown: the board arrives while the task pane
  // opens, and the closed view's gallery alone can be most of a project's cards.
  const [drawn, setDrawn] = useState(() => new Set([view]));
  if (!drawn.has(view)) setDrawn(new Set(drawn).add(view));
  const [column, setColumn] = useState(handoff.column);
  const active = project.statuses.filter((status) => status.category === 'active');
  const dragging = makingWay(held);

  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A view shown again picks up its lists where they were left.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs as the view changes
  useLayoutEffect(() => {
    const layer = body.current?.querySelector<HTMLElement>(`[data-view="${view}"]`);
    if (layer) restoreLists(layer, handoff);
  }, [view]);

  // A card held on the board's target opens the columns, to be placed among them.
  const toBoard = dragging && held.over && view !== 'board';
  // biome-ignore lint/correctness/useExhaustiveDependencies: setView is stable in effect
  useEffect(() => {
    if (!toBoard) return;
    const timer = setTimeout(() => {
      haptics.threshold();
      setView('board');
    }, PAGE_HOLD_MS);
    return () => clearTimeout(timer);
  }, [toBoard]);

  // The search and selection bars float where the dock does, and take its place.
  const away = !dragging && ((state.searching && !searchDocked) || state.selection.length > 0);
  const scrolledAway = useDockScroll(body, dock, !dragging && !away, `${view} ${column}`);

  const tab = (value: CompactView) => ({ id: `${ids}-${value}-tab`, controls: `${ids}-${value}` });
  const tabs: DockTab[] = [
    { value: 'backlog', ...tab('backlog'), label: ZONES.backlog.title, icon: Inbox },
    { value: 'board', ...tab('board'), label: 'Board', icon: Columns3 },
    { value: 'closed', ...tab('closed'), label: ZONES.closed.title, icon: CheckCheck },
  ];
  // Where a held card can go that is not in front of it.
  const targets =
    view === 'board'
      ? [...zoneStatuses('backlog', project.statuses), ...zoneStatuses('closed', project.statuses)]
      : zoneStatuses(view === 'backlog' ? 'closed' : 'backlog', project.statuses);
  // A new task goes into the column on screen, as the phone's create button does, or else
  // into the backlog.
  const into =
    view === 'board' ? (active.find((status) => status.id === column) ?? active[0]) : undefined;

  const layer = (value: CompactView, content: ReactNode) => (
    <div
      key={value}
      id={`${ids}-${value}`}
      role="tabpanel"
      aria-labelledby={`${ids}-${value}-tab`}
      data-view={value}
      // Hidden rather than unmounted once drawn, so a card carried out of a view keeps the
      // touch it began.
      hidden={view !== value}
      className={cn('absolute inset-0 flex-col', view === value ? 'flex' : 'hidden')}
    >
      {drawn.has(value) && content}
    </div>
  );

  return (
    <CompactFrame width={restWidth}>
      <div ref={body} className="relative min-h-0 flex-1">
        {layer(
          'board',
          <CompactPager
            columns={active}
            handoff={handoff}
            shown={view === 'board'}
            origin={() => 'active'}
            onPage={setColumn}
            page={(status) => (
              <CardList
                listId={`status:${status.id}`}
                endSpace={DOCK_END}
                tight
                className="flex-1"
              />
            )}
          />,
        )}
        {(['backlog', 'closed'] as const).map((zone) =>
          layer(
            zone,
            <div data-origin={zone} className="flex min-h-0 flex-1 flex-col">
              <div data-morph-enter="">
                <StatusFilter zone={zone} className="px-5" />
              </div>
              <div className="relative flex min-h-0 flex-1 flex-col">
                <ZoneGallery
                  zone={zone}
                  width={Math.max(0, width - GALLERY_INSET * 2)}
                  anchor="start"
                  endSpace={DOCK_END}
                />
              </div>
            </div>,
          ),
        )}
      </div>
      <CompactDock
        dockRef={dock}
        away={!dragging && (away || scrolledAway)}
        inert={away}
        action={
          state.actions &&
          !dragging && (
            <CreateButton
              key="create"
              label={into ? `New task in ${into.name}` : 'New task in the backlog'}
              onCreate={() => createTask(into?.id)}
            />
          )
        }
      >
        {dragging ? (
          <DockFace key="targets">
            {/* Wraps into rows, growing the dock upward. */}
            <div className="grid auto-rows-[3rem] grid-cols-[repeat(auto-fit,minmax(6rem,1fr))] gap-1.5 p-1.5">
              <BoardTarget expands={view !== 'board'} over={toBoard} />
              {targets.map((status) => (
                <StatusTile
                  key={status.id}
                  status={status}
                  shape="row"
                  className="h-full min-w-0"
                />
              ))}
            </div>
          </DockFace>
        ) : (
          <DockFace key="views">
            <div className="flex p-1">
              <DockTabs
                label="Board view"
                value={view}
                tabs={tabs}
                onChange={(next) => {
                  haptics.selection();
                  setView(next);
                }}
              />
            </div>
          </DockFace>
        )}
      </CompactDock>
    </CompactFrame>
  );
}

/**
 * The compact board's dock: a glass bar floating at the half's foot, as Catch's dock floats at
 * the window's. Away (scrolled off, or under the search or selection bar), it slides down out
 * of the half; its faces trade places as an open task's dock and the board's do.
 */
function CompactDock({
  dockRef,
  away,
  inert,
  action,
  children,
}: {
  dockRef: RefObject<HTMLDivElement | null>;
  away: boolean;
  /** Its place is taken: keyboard focus passes it by. */
  inert: boolean;
  /** A button floating beside the dock, as Catch's create button floats beside its tabs. */
  action?: ReactNode;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const progress = useMotionValue(away ? 1 : 0);
  useLayoutEffect(() => {
    const to = away ? 1 : 0;
    if (reduced) {
      progress.jump(to);
      return;
    }
    const animation = animate(progress, to, { ...springs.smooth, bounce: 0 });
    return () => animation.stop();
  }, [away, reduced, progress]);
  const y = useTransform(() => {
    const share = progress.get();
    return share === 0 ? '0px' : `calc(${share} * (100% + ${DOCK_LIFT}))`;
  });
  return (
    // Clipped at the half's foot, so a dock slid away is gone rather than hanging below it.
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center overflow-hidden px-5 pt-6"
      style={{ paddingBottom: DOCK_LIFT }}
    >
      {/* Bottom-aligned: a held card's targets grow the dock upward beside the button. */}
      <motion.div
        ref={dockRef}
        data-compact-dock=""
        data-drop-block=""
        data-away={away ? '' : undefined}
        inert={inert}
        className="flex w-full max-w-md items-end"
        style={{ y }}
      >
        <div className="glass-thick pointer-events-auto min-w-0 flex-1 overflow-hidden rounded-[var(--dock-radius)]">
          <AnimatedHeight>
            <AnimatePresence initial={false}>{children}</AnimatePresence>
          </AnimatedHeight>
        </div>
        <AnimatePresence initial={false}>{action}</AnimatePresence>
      </motion.div>
    </div>
  );
}

/**
 * The create button floating beside the dock, as Catch's is: it folds away into the dock's
 * side while a card is held, so the targets take the width.
 */
function CreateButton({ label, onCreate }: { label: string; onCreate: () => void }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className="pointer-events-auto shrink-0"
      initial={{ width: 0, marginLeft: 0, opacity: 0, scale: 0.4 }}
      animate={{ width: 64, marginLeft: 12, opacity: 1, scale: 1 }}
      exit={{ width: 0, marginLeft: 0, opacity: 0, scale: 0.4 }}
      transition={reduced ? { duration: 0 } : springs.smooth}
    >
      <motion.button
        type="button"
        aria-label={label}
        onClick={() => {
          haptics.toggle();
          onCreate();
        }}
        whileTap={{ scale: 0.88 }}
        transition={springs.snappy}
        className="flex size-[var(--dock-height)] items-center justify-center rounded-[var(--dock-radius)] bg-brand text-brand-foreground shadow-[0_8px_24px_-6px_color-mix(in_oklab,var(--brand)_45%,transparent),inset_0_1px_0_rgb(255_255_255/0.35)] outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
      >
        <Plus className="size-7" strokeWidth={2.25} aria-hidden />
      </motion.button>
    </motion.div>
  );
}

/** One face of the dock, trading places with the other. Leaving, it gives up its room. */
function DockFace({ children }: { children: ReactNode }) {
  const present = useIsPresent();
  const reduced = useReducedMotion();
  return (
    <motion.div
      aria-hidden={!present || undefined}
      inert={!present}
      className={cn(!present && 'absolute inset-x-0 bottom-0')}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: reduced ? 0 : 0.16 } }}
      transition={reduced ? { duration: 0 } : springs.smooth}
    >
      {children}
    </motion.div>
  );
}

type DockTab = {
  value: CompactView;
  id: string;
  controls: string;
  label: string;
  icon: LucideIcon;
};

/**
 * The dock's switch, as Catch's tabs: equal segments on the glass, one indicator sliding
 * between them. Each shows its icon, and its name where the dock is wide enough.
 */
function DockTabs({
  label,
  value,
  tabs,
  onChange,
}: {
  label: string;
  value: CompactView;
  tabs: DockTab[];
  onChange: (value: CompactView) => void;
}) {
  const reduced = useReducedMotion();
  const index = Math.max(
    0,
    tabs.findIndex((item) => item.value === value),
  );
  return (
    <div
      role="tablist"
      aria-label={label}
      className="@container relative grid h-[calc(var(--dock-height)-0.5rem)] min-w-0 flex-1 auto-cols-fr grid-flow-col"
      onKeyDown={(event) => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        const next =
          event.key === 'Home'
            ? tabs[0]
            : event.key === 'End'
              ? tabs[tabs.length - 1]
              : step
                ? tabs[(index + step + tabs.length) % tabs.length]
                : null;
        if (!next) return;
        event.preventDefault();
        onChange(next.value);
        document.getElementById(next.id)?.focus();
      }}
    >
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 rounded-[calc(var(--dock-radius)-0.25rem)] bg-foreground/[0.08] shadow-[inset_0_1px_0_var(--glass-highlight)]"
        style={{ width: `${100 / tabs.length}%` }}
        initial={false}
        animate={{ x: `${index * 100}%` }}
        transition={reduced ? { duration: 0 } : springs.snappy}
      />
      {tabs.map((item) => {
        const selected = item.value === value;
        const Icon = item.icon;
        return (
          <button
            key={item.value}
            id={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={item.controls}
            aria-label={item.label}
            tabIndex={selected ? 0 : -1}
            onClick={() => !selected && onChange(item.value)}
            className={cn(
              'relative flex min-w-0 items-center justify-center gap-1.5 rounded-[calc(var(--dock-radius)-0.25rem)] px-2 font-medium text-sm outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/70',
              selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon aria-hidden className="size-5 shrink-0" />
            {/* Named only where each tab has room for its name, as Catch's tabs are icons. */}
            <span aria-hidden className="hidden truncate @min-[21rem]:inline">
              {item.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The columns' place among a held card's targets: holding the card on it opens them, from the
 * backlog or the closed tasks, so the card can be placed in a column rather than sent to one.
 * On the columns themselves it marks where the card already is.
 */
function BoardTarget({ expands, over }: { expands: boolean; over: boolean }) {
  return (
    <div
      aria-hidden
      data-drop-expand={expands ? '' : undefined}
      className={cn(
        'flex h-full min-w-0 select-none items-center justify-center gap-2 rounded-2xl border px-2.5 font-medium text-[0.8125rem] transition-colors duration-150',
        over
          ? 'border-brand bg-accent text-foreground shadow-md'
          : expands
            ? 'border-transparent bg-foreground/[0.06] text-foreground/75'
            : 'border-dashed border-foreground/15 text-muted-foreground',
      )}
    >
      <Columns3 aria-hidden className="size-4" />
      Board
    </div>
  );
}
