import {
  animate,
  type MotionValue,
  motion,
  motionValue,
  useMotionValue,
  useReducedMotion,
} from 'motion/react';
import { memo, useCallback, useLayoutEffect, useReducer, useRef } from 'react';
import { ScrollArea, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import { entryDelayForTop, useEntryMotion } from '@/lib/entryMotion';
import { bandMasonry, columnAt, GAP, gridFor, type Point } from '@/lib/masonry';
import { afterPaint, springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { drag, makingWay } from './drag';
import { PriorityIcon } from './glyphs';
import { groupByPriority, type Priority, priorityName, type Task } from './model';
import { settleSubtaskLists } from './SubtaskUnderlay';
import { board, current, listTasks, sortedByField, useBoardSettings, visibleIds } from './state';
import { TaskCard } from './TaskCard';
import { useTaskCardHidden } from './taskTransition';

/**
 * Width changes closer together than this are one continuous resize (a rail's edge or the
 * task pane being dragged, the pane sliding open, a window being resized), which cards follow
 * exactly instead of springing behind. Catch's `NoteGrid` value.
 */
export const RESIZE_SETTLE_MS = 150;

/** The grid's padding inside the rail: the column's `px-3.5`. */
export const GALLERY_INSET = 14;
/**
 * The surface a held card lights up stands this far in from the rail's edges, so it reads as
 * a surface rather than the rail itself. The cards keep their inset; its 24 px corners sit
 * round the cards' 16 px ones.
 */
const SURFACE_MARGIN = 6;

/** A card's height before it has been measured: about a one-line card. */
const ESTIMATE = 88;

/** Card heights by task id, and the column width each was measured at, kept across mounts. */
const measured = new Map<string, { width: number; height: number }>();

const isMeasured = (id: string, width: number) => measured.get(id)?.width === width;

/** A card's last measured height: at another width, close enough until it is measured again. */
const heightOf = (id: string) => measured.get(id)?.height ?? ESTIMATE;

/**
 * A card's animated position and width. `target` is the slot it is at or moving to, and
 * `targetWidth` the column width it has or is growing to. As Catch's `NoteGrid`.
 */
type Place = {
  x: MotionValue<number>;
  y: MotionValue<number>;
  width: MotionValue<number>;
  target?: Point;
  targetWidth?: number;
};

type Item = { kind: 'card'; task: Task } | { kind: 'gap' };

/** What the drag engine reads from a masonry list (`drag.ts`), in the grid's coordinates. */
export type MasonryData = {
  columns: number;
  columnWidth: number;
  gap: number;
  bands: { priority: Priority | null; top: number; cards: number; peers: number[] }[];
};

/**
 * The backlog or the closed zone as Catch's masonry: each card goes to the top of the
 * shortest column, so the cards read left to right across the top and then down, newest
 * closed work first. The rail's single column and its gallery across the board are the same
 * grid at two widths, so opening the gallery fans the cards out into their columns and
 * closing it gathers them back, each card springing from where it is (Catch's motion).
 *
 * The backlog keeps a band per priority. A held card leaves a gap where it would land and the
 * other cards spring aside to make room as it moves, as in Catch's gallery (ADR 0008).
 *
 * Memoized: the board renders on every frame of the task pane sliding, and the grid, which
 * is laid out once for where the pane is going, need not.
 */
export const ZoneGallery = memo(function ZoneGallery({
  zone,
  width,
  anchor,
  endSpace,
}: {
  zone: 'backlog' | 'closed';
  /** The width the cards share, without the grid's padding. */
  width: number;
  /** The rail's edge the grid is pinned to as it widens: the window's side of the rail. */
  anchor: 'start' | 'end';
  /** Room after the last card, for a dock floating over the grid's end. */
  endSpace?: string;
}) {
  const state = board.use();
  const held = drag.use();
  const [settings] = useBoardSettings();
  const reducedMotion = useReducedMotion();
  const { project } = current(state);
  const tasks = listTasks(state, zone);
  const backlog = zone === 'backlog';
  const resorted = sortedByField(state);
  const banded = backlog && !resorted;
  const dragging = held?.phase === 'dragging';

  // The gallery keeps its width while a card is held (the active statuses' dropzones stand in
  // the strip beside it), so its cards stay where the card is aimed at them. Should it change
  // anyway, as when the window is resized, its cards narrow rather than flowing into fewer
  // columns under the card.
  const frozen = useRef<number | null>(null);
  const columnsNow = gridFor(Math.max(0, width)).columns;
  if (!dragging) frozen.current = null;
  else frozen.current ??= columnsNow;
  const grid = gridFor(Math.max(0, width), frozen.current ?? columnsNow);
  const { columnWidth } = grid;

  // A card from the backlog placed back into it. Before it has moved, its place is its own.
  const placingHere =
    backlog && dragging && held.ids.length === 1 && held.origin === 'backlog' && !resorted;
  const placing = placingHere && makingWay(held);
  const target =
    placingHere && held.target?.kind === 'place' && held.target.listId === 'backlog'
      ? held.target
      : null;
  // The grid closes up around the held card and opens a gap where it would land.
  const away = (id: string) => placingHere && held.ids.includes(id);

  const groups: { priority: Priority | null; tasks: Task[] }[] = banded
    ? groupByPriority(tasks)
    : [{ priority: null, tasks }];
  const bands = groups.map(({ priority, tasks: zoneTasks }) => {
    // The cards a held one is placed among: every card of the band but itself.
    const peers = placingHere ? zoneTasks.filter((task) => !held.ids.includes(task.id)) : zoneTasks;
    const items: Item[] = peers.map((task) => ({ kind: 'card', task }));
    const at = target && target.priority === priority ? target.index : null;
    if (at !== null) items.splice(Math.min(at, items.length), 0, { kind: 'gap' });
    // A gallery names its priorities; a single column only if the person asks, as columns do.
    // Every priority shows while a card is placed, so an empty one can take it.
    const heading =
      priority !== null &&
      (placing || (zoneTasks.length > 0 && (grid.columns > 1 || settings.zoneLabels)));
    return { priority, tasks: zoneTasks, peers, items, at, heading };
  });
  // Before a single column's grid has a width, nothing is placed.
  const gapHeight = held ? held.height : 0;
  // While the same cards stand in the same order at the same width, each keeps its column:
  // when one grows or shrinks in place (its subtasks unfolding), the cards below it move along
  // its column rather than crossing to others over it. Any other change lays them out afresh.
  const arrangement = JSON.stringify([
    grid.columns,
    columnWidth,
    bands.map((band) => [
      band.heading,
      band.items.map((item) => (item.kind === 'gap' ? null : item.task.id)),
    ]),
  ]);
  const columnsKept = useRef<{ arrangement: string; columns: Map<string, number> } | null>(null);
  const keep =
    columnsKept.current?.arrangement === arrangement ? columnsKept.current.columns : null;
  const layout =
    width > 0
      ? bandMasonry(
          bands.map((band) => ({
            heights: band.items.map((item) =>
              item.kind === 'gap' ? gapHeight : heightOf(item.task.id),
            ),
            heading: band.heading,
            keep: keep
              ? band.items.map((item) =>
                  item.kind === 'card' ? keep.get(item.task.id) : undefined,
                )
              : undefined,
          })),
          grid,
        )
      : null;

  const slotOf = new Map<string, Point>();
  let gapSlot: Point | null = null;
  if (layout) {
    let index = 0;
    for (const band of bands) {
      for (const item of band.items) {
        const slot = layout.slots[index++];
        if (!slot) continue;
        if (item.kind === 'gap') gapSlot = slot;
        else slotOf.set(item.task.id, slot);
      }
    }
  }
  const pending = tasks.some((task) => !away(task.id) && !isMeasured(task.id, columnWidth));
  // Columns are kept from a layout of measured cards only: one laid out from estimates is
  // laid out afresh once they are measured.
  columnsKept.current =
    layout && !pending
      ? {
          arrangement,
          columns: new Map([...slotOf].map(([id, slot]) => [id, columnAt(slot.x, grid)])),
        }
      : null;
  // The heights this layout was made with: measuring may have moved on by the time it is placed.
  const heights = new Map(tasks.map((task) => [task.id, heightOf(task.id)]));

  const masonryData: MasonryData | null = layout && {
    columns: grid.columns,
    columnWidth,
    gap: GAP,
    bands: bands.flatMap((band, index) => {
      const box = layout.bands[index];
      if (!box || (!band.heading && band.peers.length === 0)) return [];
      const ids = held?.ids ?? [];
      return [
        {
          priority: band.priority,
          top: box.top,
          cards: box.cards,
          peers: band.tasks
            .filter((task) => !ids.includes(task.id))
            .map((task) => heightOf(task.id)),
        },
      ];
    }),
  };

  const container = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const resizes = useRef<ResizeObserver | null>(null);
  const places = useRef(new Map<string, Place>());
  // Each band heading's position and the top it is at or moving to, placed with the cards.
  const headings = useRef(new Map<Priority, { y: MotionValue<number>; target?: number }>());
  const [, remeasured] = useReducer((count: number) => count + 1, 0);
  const measuredWidth = useRef(columnWidth);
  const resized = useRef({ width, at: 0 });
  // Cards waiting to spring to a new width, and the call that will start them.
  const settling = useRef({ places: new Set<Place>(), cancel: () => {} });
  // The heights the cards were last placed with, which tell a card growing or shrinking in
  // place (its subtasks unfolding, say) from the grid itself changing.
  const placedHeights = useRef(new Map<string, number>());
  const gridHeight = useMotionValue(layout?.height ?? 0);
  useLayoutEffect(() => () => settling.current.cancel(), []);

  function headingOf(priority: Priority) {
    let heading = headings.current.get(priority);
    if (!heading) {
      heading = { y: motionValue(0) };
      headings.current.set(priority, heading);
    }
    return heading;
  }

  function placeOf(id: string) {
    let place = places.current.get(id);
    if (!place) {
      place = { x: motionValue(0), y: motionValue(0), width: motionValue(columnWidth) };
      places.current.set(id, place);
    }
    return place;
  }

  const measure = useCallback(() => {
    const width = measuredWidth.current;
    if (width <= 0) return;
    // A card still growing or shrinking to this width is measured as it will be, once: its
    // height on the way there says nothing, and it changes every frame. So is a card whose
    // subtasks are unfolding or folding away: it is measured at the height they spring to.
    const settled: [string, HTMLElement][] = [];
    const growing: [string, HTMLElement, string][] = [];
    for (const [id, element] of elements.current) {
      if (element.hidden) continue;
      const live = places.current.get(id)?.width.get();
      if (live === undefined || live === width) settled.push([id, element]);
      else if (measured.get(id)?.width !== width) growing.push([id, element, element.style.width]);
    }
    // Written together, then read together, so the browser lays the cards out once.
    for (const [, element] of growing) element.style.width = `${width}px`;
    const unsettle = container.current ? settleSubtaskLists(container.current) : () => {};
    let changed = false;
    for (const [id, element] of [...settled, ...growing]) {
      const height = element.offsetHeight;
      const previous = measured.get(id);
      if (previous?.width !== width || previous.height !== height) {
        measured.set(id, { width, height });
        changed = true;
      }
    }
    for (const [, element, live] of growing) element.style.width = live;
    unsettle();
    if (changed) remeasured();
  }, []);

  const register = useCallback((id: string, element: HTMLElement | null) => {
    const previous = elements.current.get(id);
    if (previous && previous !== element) resizes.current?.unobserve(previous);
    if (element) {
      elements.current.set(id, element);
      resizes.current?.observe(element);
    } else {
      elements.current.delete(id);
    }
  }, []);

  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    // A card changes height later too, as when it is renamed or its tags change.
    resizes.current = new ResizeObserver(measure);
    for (const card of elements.current.values()) resizes.current.observe(card);
    return () => {
      resizes.current?.disconnect();
      resizes.current = null;
    };
  }, [measure]);

  useLayoutEffect(() => {
    measuredWidth.current = columnWidth;
  });

  // New cards are measured before the first paint, so they appear already in place.
  useLayoutEffect(measure);

  // Sends every card to its slot and width: new cards jump there, moved or resized ones
  // spring. Only cards on or near the screen spring; the rest jump.
  useLayoutEffect(() => {
    for (const id of places.current.keys()) {
      if (!elements.current.has(id)) places.current.delete(id);
    }
    if (!layout || pending) {
      gridHeight.jump(layout?.height ?? 0);
      return;
    }
    let resizing = false;
    let continuous = false;
    let shift = 0;
    if (resized.current.width !== width) {
      const now = performance.now();
      resizing = true;
      continuous = now - resized.current.at < RESIZE_SETTLE_MS;
      // A grid pinned to its end grows from its start: what was drawn stays where it was and
      // springs on from there. While the edge is held, the cards ride with it instead.
      if (anchor === 'end' && !continuous) shift = width - resized.current.width;
      resized.current = { width, at: now };
    }
    // A card that grew or shrank in place springs its height with `springs.pane` (its
    // subtasks unfolding: `SubtaskUnderlay`). The cards it moves, and the grid's own height,
    // take the same spring from the same frame, so they keep in step with its edge: no gap
    // opens behind it and none of them runs over it.
    let grewInPlace = false;
    for (const [id, height] of heights) {
      const before = placedHeights.current.get(id);
      if (before !== undefined && before !== height) grewInPlace = true;
    }
    placedHeights.current = heights;
    const following = grewInPlace && !resizing && !held && !reducedMotion;
    const transition = following ? springs.pane : springs.smooth;
    const gridTarget = layout.height;
    if (!following) gridHeight.jump(gridTarget);
    const headingMoves: [MotionValue<number>, number][] = [];
    for (const [index, band] of bands.entries()) {
      if (band.priority === null) continue;
      const heading = headingOf(band.priority);
      const top = layout.bands[index]?.top ?? 0;
      if (heading.target === undefined || reducedMotion) heading.y.jump(top);
      else if (heading.target !== top) {
        if (following) headingMoves.push([heading.y, top]);
        else animate(heading.y, top, springs.smooth);
      }
      heading.target = top;
    }
    const spring = (place: Place) => {
      if (!place.target || place.targetWidth === undefined) return;
      animate(place.x, place.target.x, transition);
      animate(place.y, place.target.y, transition);
      // The width is animated itself rather than scaled, so text reflows and stays crisp.
      animate(place.width, place.targetWidth, transition);
    };
    let visible: { top: number; bottom: number } | undefined;
    const onScreen = (y: number, height: number) => {
      if (!visible) {
        const margin = window.innerHeight / 2;
        const top = -(container.current?.getBoundingClientRect().top ?? 0) - margin;
        visible = { top, bottom: top + window.innerHeight + 2 * margin };
      }
      return y + height >= visible.top && y <= visible.bottom;
    };
    // A card just dropped is hidden while its copy flies to it, so it is already there.
    const landing = held?.phase === 'landing' ? held.ids : [];
    for (const task of tasks) {
      const slot = slotOf.get(task.id);
      if (!slot || !elements.current.has(task.id)) {
        // Out of the layout while held: it comes back at its new place, not from its old one.
        const place = places.current.get(task.id);
        if (place) place.target = undefined;
        continue;
      }
      const place = placeOf(task.id);
      const height = heightOf(task.id);
      if (!place.target || landing.includes(task.id)) {
        place.x.jump(slot.x);
        place.y.jump(slot.y);
        place.width.jump(columnWidth);
      } else if (shift !== 0) {
        place.x.jump(place.x.get() + shift);
      }
      const visiblyMoves =
        place.target && (onScreen(place.y.get(), height) || onScreen(slot.y, height));
      const moved =
        place.target && (shift !== 0 || place.target.x !== slot.x || place.target.y !== slot.y);
      const changedWidth = place.targetWidth !== columnWidth;
      place.target = slot;
      place.targetWidth = columnWidth;
      if (!moved && !changedWidth) continue;
      if (!visiblyMoves || reducedMotion) {
        place.x.jump(slot.x);
        place.y.jump(slot.y);
        place.width.jump(columnWidth);
      } else if (continuous) {
        place.width.jump(columnWidth);
        if (moved) spring(place);
      } else if (resizing || following) {
        settling.current.places.add(place);
      } else {
        spring(place);
      }
    }
    if ((resizing && settling.current.places.size > 0) || following) {
      // A resize is a long frame (every card is measured again, and the pane or gallery may
      // be mounting beside the grid). Springs keep time, so started now they would lose their
      // first moments to it and show up most of the way there. They start once it is painted.
      // So does a card's growing in place, after the same paint as its subtask list.
      settling.current.cancel();
      settling.current.cancel = afterPaint(() => {
        if (following) {
          animate(gridHeight, gridTarget, springs.pane);
          for (const [y, top] of headingMoves) animate(y, top, springs.pane);
        }
        for (const place of settling.current.places) spring(place);
        settling.current.places.clear();
      });
    }
  });

  const filter = backlog ? state.backlogFilter : state.closedFilter;
  const showStatus = filter === null;
  const moving = makingWay(held);
  const over = backlog && moving && held.target?.kind !== 'status' && Boolean(target);
  const label = backlog ? 'Backlog tasks' : 'Closed tasks';
  const empty = tasks.length === 0 && !placing;

  return (
    <section
      aria-label={label}
      data-drop-list={backlog ? 'backlog' : undefined}
      data-drop-send={backlog && resorted ? '' : undefined}
      data-layout={backlog ? 'masonry' : undefined}
      data-over={over ? '' : undefined}
      className="board-column relative flex min-h-0 min-w-0 flex-1 flex-col rounded-3xl"
      style={{ marginInline: SURFACE_MARGIN, marginBottom: SURFACE_MARGIN }}
    >
      <ScrollArea edges className="card-scroller flex-1 [--scrollbar-inset:0.5rem]">
        <ScrollAreaViewport data-autoscroll="">
          <div
            className="pt-1 pb-4"
            style={{ paddingInline: GALLERY_INSET - SURFACE_MARGIN, paddingBottom: endSpace }}
          >
            {empty && (
              <p className="px-1 py-10 text-center text-muted-foreground text-sm">
                {state.awaitingTasks
                  ? 'Loading tasks…'
                  : visibleIds(state)
                    ? 'Nothing matches here.'
                    : backlog
                      ? 'Nothing here.'
                      : 'Nothing closed.'}
              </p>
            )}
            <motion.div
              ref={container}
              data-masonry={masonryData ? JSON.stringify(masonryData) : undefined}
              className={cn('relative transition-none', anchor === 'end' && 'ml-auto')}
              style={{ width: Math.max(0, width), height: gridHeight }}
            >
              {layout &&
                bands.map((band) => {
                  if (band.priority === null) return null;
                  return (
                    <BandHeading
                      key={band.priority}
                      priority={band.priority}
                      name={priorityName(project, band.priority)}
                      y={headingOf(band.priority).y}
                      shown={band.heading}
                      current={band.at !== null && placing}
                      reducedMotion={Boolean(reducedMotion)}
                    />
                  );
                })}
              {gapSlot && (
                // Where the held card would land: a soft well that moves with the cards.
                <motion.div
                  aria-hidden
                  data-gap=""
                  className="absolute top-0 left-0 rounded-2xl bg-foreground/[0.07]"
                  style={{ width: columnWidth, height: gapHeight }}
                  initial={{ x: gapSlot.x, y: gapSlot.y }}
                  animate={{ x: gapSlot.x, y: gapSlot.y }}
                  transition={reducedMotion ? { duration: 0 } : springs.smooth}
                />
              )}
              {bands.map((band) =>
                band.tasks.map((task) => {
                  const slot = slotOf.get(task.id);
                  return (
                    <GridCard
                      key={task.id}
                      task={task}
                      place={placeOf(task.id)}
                      placed={isMeasured(task.id, columnWidth)}
                      hidden={away(task.id)}
                      entryDelay={entryDelayForTop(slot?.y ?? 0)}
                      skipEntry={Boolean(held)}
                      carried={state.carrying?.taskId === task.id}
                      showStatus={showStatus}
                      register={register}
                    />
                  );
                }),
              )}
            </motion.div>
          </div>
        </ScrollAreaViewport>
        <ScrollBar />
      </ScrollArea>
    </section>
  );
});

function BandHeading({
  priority,
  name,
  y,
  shown,
  current,
  reducedMotion,
}: {
  priority: Priority;
  name: string;
  /** Where the grid places it, as it places its cards. */
  y: MotionValue<number>;
  shown: boolean;
  current: boolean;
  reducedMotion: boolean;
}) {
  return (
    <motion.div
      data-zone-header={priority}
      data-mode="label"
      data-current={current ? '' : undefined}
      aria-hidden={!shown || undefined}
      className="zone-header absolute inset-x-0 top-0"
      style={{ y }}
      initial={false}
      animate={{ opacity: shown ? 1 : 0 }}
      transition={reducedMotion ? { duration: 0 } : { duration: shown ? 0.2 : 0.12 }}
    >
      <div className="zone-header-face">
        <span className="truncate">{name}</span>
        <PriorityIcon priority={priority} className="zone-chevron" />
      </div>
    </motion.div>
  );
}

function GridCard({
  task,
  place,
  placed,
  hidden,
  entryDelay,
  skipEntry,
  carried,
  showStatus,
  register,
}: {
  task: Task;
  place: Place;
  placed: boolean;
  hidden: boolean;
  entryDelay: number;
  skipEntry: boolean;
  carried: boolean;
  showStatus: boolean;
  register: (id: string, element: HTMLElement | null) => void;
}) {
  const opening = useTaskCardHidden(task.id);
  const entry = useEntryMotion(`card:${task.id}`, placed, entryDelay, skipEntry || opening);
  const ref = useCallback(
    (element: HTMLDivElement | null) => register(task.id, element),
    [task.id, register],
  );
  return (
    // The held card stays mounted but out of the layout: a touch keeps reporting to the
    // element it began on, and stops if that element is removed.
    <motion.div
      ref={ref}
      data-slot={task.id}
      data-zone={task.priority}
      hidden={hidden}
      // Motion places it. Reduced motion's global CSS transition would hold it back a frame
      // behind its neighbours, which are not transitioned (a subtask list opening to auto).
      className="absolute top-0 left-0 transition-none"
      style={{
        x: place.x,
        y: place.y,
        width: place.width,
        zIndex: carried ? 2 : undefined,
        visibility: placed ? undefined : 'hidden',
      }}
    >
      <motion.div style={entry}>
        <TaskCard task={task} showStatus={showStatus} />
      </motion.div>
    </motion.div>
  );
}
