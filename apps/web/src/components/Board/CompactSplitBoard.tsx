import { CheckCheck, Columns3, Inbox, Plus } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { SEARCH_SPACE } from '@/components/BoardSearch/BoardSearch';
import { IconButton } from '@/components/IconButton/IconButton';
import { SegmentedTabs } from '@/components/SegmentedTabs/SegmentedTabs';
import { haptics } from '@/lib/haptics';
import { afterPaint, curves } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { CardList } from './CardList';
import { drag, makingWay, PAGE_HOLD_MS, pageStride } from './drag';
import { GALLERY_INSET, ZoneGallery } from './Gallery';
import type { Status } from './model';
import { FlowTrack, PeekEdge, pageClass } from './PhoneBoard';
import { StatusFilter, ZONES, type Zone, zoneStatuses } from './SideZone';
import { StatusTile } from './StatusTile';
import { board, countIn, createTask, current, useCollapsedColumns } from './state';
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
 */
export function useCompactBoard(restWidth: number) {
  const [compact, setCompact] = useState(false);
  const next = compactFor(restWidth, compact);
  if (next !== compact) setCompact(next);
  return next;
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
 * own. The full layout fades back in as the compact one does (`CompactFrame`).
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
  const reduced = useReducedMotion();

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
    if (reduced) return;
    for (const layer of element.querySelectorAll<HTMLElement>(
      ':scope > .board-rail, :scope > [data-board-layout]',
    ))
      layer.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: curves.enter.duration * 1000,
        easing: `cubic-bezier(${curves.enter.ease.join(',')})`,
      });
  }, [compact]);

  return handoff;
}

/** Room left before a column brought back into view, as the board's own edge leaves. */
const COLUMN_MARGIN = 20;

/** The compact board's surface, fading in over the layout it replaces. */
export function CompactFrame({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      data-board-layout=""
      data-compact-board=""
      className="flex min-w-0 flex-1 flex-col pt-[calc(var(--safe-top)+1.25rem)]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={reduced ? { duration: 0 } : curves.enter}
    >
      {children}
    </motion.div>
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
  page: renderPage,
}: {
  columns: Status[];
  handoff: BoardHandoff;
  /** The column to open on when the full layout left none. */
  start?: string | null;
  /** Off screen behind another view, its pager does not turn under a held card. */
  shown?: boolean;
  origin: (column: Status) => string;
  page: (column: Status) => ReactNode;
}) {
  const state = board.use();
  const { project } = current(state);
  const collapsed = useCollapsedColumns(project);
  const { pagerRef, pages, page, pager, turnTo, folding } = useColumnPager(
    columns,
    collapsed,
    handoff.column ?? start,
  );
  const id = pages[page]?.id ?? null;
  useEffect(() => {
    if (id !== null) handoff.column = id;
  }, [id, handoff]);
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
      <FlowTrack statuses={pages} page={page} onTurn={turnTo} folding={folding} />
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

/**
 * The project board beside an open task when there is too little room for its row: a phone's
 * board in the desktop's half. The backlog, the columns and the closed tasks are three views
 * of the same width under one switch, so cards keep the whole half rather than sharing it with
 * two rails' strips. The columns page one at a time. While a card is held, the switch turns
 * into the statuses of the other views, and holding it on the board's own target opens the
 * columns to place it in.
 */
export function CompactSplitBoard({ handoff }: { handoff: BoardHandoff }) {
  const state = board.use();
  const held = drag.use();
  const { project } = current(state);
  const ids = useId();
  const body = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [view, setViewState] = useState<CompactView>(
    () =>
      handoff.view ??
      (state.backlog === 'full' ? 'backlog' : state.closed === 'full' ? 'closed' : 'board'),
  );
  const setView = (next: CompactView) => {
    handoff.view = next;
    setViewState(next);
  };
  const active = project.statuses.filter((status) => status.category === 'active');
  const dragging = makingWay(held);
  const count = (zone: Zone) =>
    zoneStatuses(zone, project.statuses).reduce(
      (sum, status) => sum + countIn(state, status.id),
      0,
    );

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

  const tab = (value: CompactView) => ({ id: `${ids}-${value}-tab`, controls: `${ids}-${value}` });
  const badge = (zone: Zone) => (
    <span className="pl-1 text-muted-foreground text-xs tabular-nums">{count(zone)}</span>
  );
  const options = [
    {
      value: 'backlog' as const,
      ...tab('backlog'),
      label: ZONES.backlog.title,
      icon: <Inbox aria-hidden className="size-4" />,
      badge: badge('backlog'),
    },
    {
      value: 'board' as const,
      ...tab('board'),
      label: 'Board',
      icon: <Columns3 aria-hidden className="size-4" />,
    },
    {
      value: 'closed' as const,
      ...tab('closed'),
      label: ZONES.closed.title,
      icon: <CheckCheck aria-hidden className="size-4" />,
      badge: badge('closed'),
    },
  ];
  // Where a held card can go that is not in front of it.
  const targets =
    view === 'board'
      ? [...zoneStatuses('backlog', project.statuses), ...zoneStatuses('closed', project.statuses)]
      : zoneStatuses(view === 'backlog' ? 'closed' : 'backlog', project.statuses);

  const layer = (value: CompactView, content: ReactNode) => (
    <div
      key={value}
      id={`${ids}-${value}`}
      role="tabpanel"
      aria-labelledby={`${ids}-${value}-tab`}
      data-view={value}
      // Hidden rather than unmounted, so a card carried out of a view keeps the touch it began.
      hidden={view !== value}
      className={cn('absolute inset-0 flex-col', view === value ? 'flex' : 'hidden')}
    >
      {content}
    </div>
  );

  return (
    <CompactFrame>
      <div className="relative mb-2 h-12 shrink-0 px-5">
        <div
          className={cn('flex h-full items-center gap-1', dragging && 'opacity-0')}
          inert={dragging}
        >
          <div className="min-w-0 flex-1">
            <SegmentedTabs
              label="Board view"
              value={view}
              onValueChange={(next) => next && setView(next)}
              options={options}
            />
          </div>
          {view === 'backlog' && state.actions && (
            <IconButton label="New task in the backlog" onClick={() => createTask()}>
              <Plus />
            </IconButton>
          )}
        </div>
        {/* Wraps into rows over the flow track below, which takes no card. */}
        <AnimatePresence>
          {dragging && (
            <motion.div
              key="targets"
              className="absolute top-0 right-5 left-5 z-10 grid auto-rows-[2.75rem] grid-cols-[repeat(auto-fit,minmax(5rem,1fr))] gap-2 rounded-b-2xl bg-background pb-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
            >
              <BoardTarget expands={view !== 'board'} over={toBoard} />
              {targets.map((status) => (
                <StatusTile
                  key={status.id}
                  status={status}
                  shape="row"
                  className="h-full min-w-0"
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div ref={body} className="relative min-h-0 flex-1">
        {layer(
          'board',
          <CompactPager
            columns={active}
            handoff={handoff}
            shown={view === 'board'}
            origin={() => 'active'}
            page={(status) => (
              <CardList
                listId={`status:${status.id}`}
                endSpace={SEARCH_SPACE}
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
              <StatusFilter zone={zone} className="px-5" />
              <div className="relative flex min-h-0 flex-1 flex-col">
                <ZoneGallery
                  zone={zone}
                  width={Math.max(0, width - GALLERY_INSET * 2)}
                  anchor="start"
                />
              </div>
            </div>,
          ),
        )}
      </div>
    </CompactFrame>
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
