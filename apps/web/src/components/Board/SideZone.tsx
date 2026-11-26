import {
  CheckCheck,
  Inbox,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelRightClose,
  Plus,
} from 'lucide-react';
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from 'motion/react';
import {
  Fragment,
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import { IconButton } from '@/components/IconButton/IconButton';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useBacklogSpotlightBlocker, useStatusSpotlightBlocker } from './blockers';
import { drag, makingWay } from './drag';
import { GALLERY_INSET, ZoneGallery } from './Gallery';
import { StatusGlyph } from './glyphs';
import type { Category, Project, Status } from './model';
import { StatusTile } from './StatusTile';
import {
  board,
  countIn,
  createTask,
  current,
  type RailWidths,
  railResize,
  setRailWidth,
  update,
  visibleIds,
  type ZoneState,
} from './state';
import { SplitHandle } from './TaskView';

export const ZONES = {
  backlog: { title: 'Backlog', categories: ['backlog'] as Category[], icon: Inbox },
  closed: { title: 'Closed', categories: ['done', 'cancelled'] as Category[], icon: CheckCheck },
};
export type Zone = keyof typeof ZONES;

export const STRIP_WIDTH = 64;
/**
 * A strip under a held card takes the gap beside it and no more, so its statuses read
 * across without it lying over a column, which is a drop target too.
 */
const HELD_STRIP_WIDTH = 80;

/** A rail open as a single column. Its edge drags it wider, up to the whole board. */
export const PANEL_WIDTH = 304;
/** A rail's edge let go of this close to a strip or to the whole board snaps to it. */
export const RAIL_SNAP = 72;
/**
 * Between a rail and the first column beside it. The rails lie over the ends of the columns'
 * scroller, so scrolled columns pass through this space and on under the rail.
 */
export const ZONE_GAP = 20;
/**
 * A strip beside a gallery under a held card takes the gallery's gap (both zone gaps, as no
 * columns lie between them) and stops at the gallery's edge, so the active statuses' names
 * read across it beside its own without the gallery giving up any width.
 */
const GALLERY_STRIP_WIDTH = STRIP_WIDTH + ZONE_GAP * 2;
/**
 * How far the rail's resize grip (24 px wide) reaches past its edge, to sit centred between
 * the rail's cards, inset by the gallery's padding, and the column a zone gap beyond.
 */
const EDGE_GRIP_OUTSET = 12 + (ZONE_GAP - GALLERY_INSET) / 2;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(min, max), Math.max(min, value));

/** How a rail is laid out on the board this moment. */
export type RailGeometry = {
  /** The width it takes from the columns: where the columns start beside it. */
  zone: number;
  /** The width it is drawn at, which widens a strip over the gap while it shows dropzones. */
  drawn: number;
  /** The width its cards are laid out at: never narrower than a single column. */
  content: number;
  /** The widest its edge can be dragged: as far as it goes beside the other rail. */
  max: number;
  /** A change of this springs the rail; any other change of width follows exactly. */
  mode: string;
  /** Its edge is held, so it follows the pointer. */
  tracking: boolean;
};

/**
 * Both rails' widths from the row they share. A rail open as a panel keeps the width its
 * edge was dragged to, as far as the row allows beside the other rail; one being dragged
 * takes the pointer's width.
 */
export function railGeometry({
  rowWidth,
  restWidth = rowWidth,
  views,
  widths,
  resize,
  holding,
  origin,
}: {
  rowWidth: number;
  /**
   * The row's width once the docked search sidebar and task pane have finished sliding: the
   * rails' cards are laid out for it at once, while the rails themselves follow the row as
   * it goes.
   */
  restWidth?: number;
  views: Record<Zone, ZoneState>;
  widths: RailWidths;
  resize: { zone: Zone; width: number } | null;
  /**
   * A card is held and the board makes way for it. A gallery keeps its width: the active
   * statuses it covers become dropzones in the strip beside it, so its cards do not narrow
   * and re-wrap under the card (and back again at the drop).
   */
  holding: boolean;
  /** The zone the held card came from. */
  origin: string | null;
}) {
  // Each rail's width in a row this wide, and the widest its edge could take it.
  const widthsIn = (row: number) => {
    const fullWidth = Math.max(0, row - STRIP_WIDTH - ZONE_GAP * 2);
    const room = (other: number) => row - ZONE_GAP * 2 - other;
    const panel = (zone: Zone, max: number) =>
      clamp(widths[zone] ?? PANEL_WIDTH, PANEL_WIDTH, max - RAIL_SNAP);
    // What each rail would take beside a strip: the room the other has is what it leaves.
    const natural = (zone: Zone) =>
      views[zone] === 'full'
        ? fullWidth
        : views[zone] === 'panel'
          ? panel(zone, room(STRIP_WIDTH))
          : STRIP_WIDTH;
    const of = (zone: Zone, other: Zone) => {
      const view = views[zone];
      const max = room(natural(other));
      const live = resize?.zone === zone ? resize.width : null;
      const width =
        live ?? (view === 'full' ? fullWidth : view === 'panel' ? panel(zone, max) : STRIP_WIDTH);
      return { width, max, live };
    };
    return { fullWidth, backlog: of('backlog', 'closed'), closed: of('closed', 'backlog') };
  };
  const now = widthsIn(rowWidth);
  const rest = widthsIn(restWidth);
  const geometry = (zone: Zone): RailGeometry => {
    const view = views[zone];
    const { width, max, live } = now[zone];
    const tiles = holding && origin !== zone;
    const besideGallery = views[zone === 'backlog' ? 'closed' : 'backlog'] === 'full';
    return {
      zone: width,
      drawn:
        tiles && view === 'strip' && live === null
          ? besideGallery
            ? GALLERY_STRIP_WIDTH
            : HELD_STRIP_WIDTH
          : width,
      // A held edge lays the cards out as it goes; otherwise they are laid out once, for
      // where the row is going.
      content: Math.max(PANEL_WIDTH, live ?? rest[zone].width),
      max,
      mode: `${view}:${holding}:${tiles}:${widths[zone]}`,
      tracking: live !== null,
    };
  };
  return { fullWidth: now.fullWidth, backlog: geometry('backlog'), closed: geometry('closed') };
}

/**
 * Whether a rail has an edge to drag: a panel does, and so does one whose edge is held, until
 * it is let go. A strip opens from its button and a gallery goes back from its header, so
 * neither has one, and a rail standing in as dropzones for a held card keeps still.
 */
export function showsRailEdge(view: ZoneState, tracking: boolean, tiles: boolean) {
  return !tiles && (view === 'panel' || tracking);
}

/** Where a rail's edge let go of at `width` settles: a strip, a panel that wide, or full. */
export function settleRail(width: number, max: number): { view: ZoneState; width: number } {
  if (width <= PANEL_WIDTH - RAIL_SNAP) return { view: 'strip', width: PANEL_WIDTH };
  if (max - RAIL_SNAP > PANEL_WIDTH && width >= max - RAIL_SNAP)
    return { view: 'full', width: max };
  return { view: 'panel', width: clamp(width, PANEL_WIDTH, max - RAIL_SNAP) };
}

/**
 * A rail's width: a spring when the rail changes state (a strip opening, a gallery closing, a
 * card picked up), and otherwise its target exactly, as the row narrows while the docked search
 * sidebar or task pane slides open or a window or the rail's own edge is dragged. Re-firing a
 * spring at a target that moves every frame made those changes lag and bounce.
 *
 * `width` is what to draw: the motion value while it springs, and the plain number otherwise,
 * so React writes it in the same commit as the row's new width rather than a frame later.
 * `value` follows either way, for whatever tracks the rail as it moves.
 */
export function useRailSpring(target: number, mode: string, tracking: boolean) {
  const reducedMotion = useReducedMotion();
  const value = useMotionValue(target);
  const last = useRef({ target, mode });
  const changed = last.current.target !== target;
  // A spring under way keeps going, to wherever its target has moved.
  const springing =
    changed && !tracking && !reducedMotion && (last.current.mode !== mode || value.isAnimating());
  if (changed && !springing && value.get() !== target) {
    value.stop();
    value.jump(target);
  }
  useLayoutEffect(() => {
    const before = last.current;
    last.current = { target, mode };
    if (before.target !== target && springing) animate(value, target, springs.smooth);
  }, [target, mode, springing, value]);
  const moving = springing || value.isAnimating();
  return { value, width: moving ? value : target };
}

/** How long a strip is held to open straight into the gallery. */
export const STRIP_HOLD_MS = 400;
/** How far a held pointer may wander before the press stops counting as a hold. */
const STRIP_HOLD_SLOP = 10;

/**
 * A strip's press: a tap or click opens it as a column, and holding it opens the gallery
 * outright. The click that follows a hold is swallowed, so letting go does not take the
 * gallery back to a column; a keyboard's click (detail 0) never comes from a hold.
 */
export function useStripPress({ onPress, onHold }: { onPress: () => void; onHold: () => void }) {
  const timer = useRef<number | undefined>(undefined);
  const origin = useRef({ x: 0, y: 0 });
  const held = useRef(false);

  const cancel = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      held.current = false;
      cancel();
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        held.current = true;
        haptics.threshold();
        onHold();
      }, STRIP_HOLD_MS);
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      if (
        timer.current !== undefined &&
        Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) >
          STRIP_HOLD_SLOP
      )
        cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    // A touch held this long would also bring up the browser's menu over the gallery.
    onContextMenu(event: MouseEvent<HTMLElement>) {
      if (timer.current !== undefined || held.current) event.preventDefault();
    },
    onClick(event: MouseEvent<HTMLElement>) {
      if (held.current && event.detail !== 0) {
        held.current = false;
        event.preventDefault();
        return;
      }
      held.current = false;
      onPress();
    },
  };
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
 * the window, over the ends of the columns' scroller, and never take a column's surface. An
 * open panel's inner edge drags it to any width between a column and the whole board;
 * a gallery goes back to a column from its header.
 */
export function SideZone({ zone, geometry }: { zone: Zone; geometry: RailGeometry }) {
  const state = board.use();
  const held = drag.use();
  const reduced = useReducedMotion();
  const { project } = current(state);
  const { title, icon: Icon } = ZONES[zone];
  const statuses = zoneStatuses(zone, project.statuses);
  const view = state[zone];
  const count = statuses.reduce((sum, status) => sum + countIn(state, status.id), 0);
  // A card held from this zone keeps the zone as it is, so it can still be placed here.
  const tiles = makingWay(held) && held.origin !== zone;
  const other = zone === 'backlog' ? 'closed' : 'backlog';
  // A gallery covers the active columns, so their statuses join the dropzones: in the strip
  // beside it, or in the gallery itself when the card came from that strip's zone. The
  // gallery keeps its width either way, so its cards stay where the card is aimed at them.
  const active =
    tiles && (view === 'strip' ? state[other] === 'full' : view === 'full' && held.origin === other)
      ? project.statuses.filter((status) => status.category === 'active')
      : [];
  const groups = [
    { title, statuses },
    ...(active.length > 0 ? [{ title: 'Active', statuses: active }] : []),
  ];
  // In the order of the board: backlog, active, closed.
  if (zone === 'closed') groups.reverse();
  const hasBlocker = useBacklogSpotlightBlocker(
    project,
    state.subtasksAsCards,
    visibleIds(state),
    zone === 'backlog' && view === 'strip' && !geometry.tracking && !tiles,
  );
  const { width } = useRailSpring(geometry.drawn, geometry.mode, geometry.tracking);
  const start = zone === 'backlog';
  // A gallery takes the board, so the opposite zone steps back to its strip.
  const setView = (next: ZoneState) =>
    update((before) => ({ [zone]: next, [other]: next === 'full' ? 'strip' : before[other] }));
  // The snap the held edge would make if let go now, to mark crossing into another.
  const snap = useRef<ZoneState>(view);
  const galleryToggle = useRef<HTMLButtonElement>(null);
  const stripPress = useStripPress({
    onPress: () => setView('panel'),
    onHold: () => setView('full'),
  });

  function commit(next: { view: ZoneState; width: number }) {
    if (next.view === 'panel') setRailWidth(zone, next.width);
    if (next.view !== view) setView(next.view);
  }

  function resize(next: number, keyboard: boolean) {
    if (keyboard) {
      // The keys walk a panel's width and step on to the gallery at the end. Closing is the
      // close button's.
      const settled = settleRail(Math.max(PANEL_WIDTH, next), geometry.max);
      commit(settled);
      // A gallery has no edge, so the focus moves to the toggle that takes it back.
      if (settled.view === 'full') galleryToggle.current?.focus();
      return;
    }
    railResize.set({ zone, width: next });
    const region = settleRail(next, geometry.max).view;
    if (region !== snap.current) haptics.threshold();
    snap.current = region;
  }

  function hold(active: boolean) {
    if (active) {
      snap.current = view;
      railResize.set({ zone, width: geometry.zone });
      return;
    }
    const live = railResize.get();
    if (live?.zone === zone) commit(settleRail(live.width, geometry.max));
    railResize.set(null);
  }

  return (
    <motion.aside
      aria-label={title}
      data-origin={zone}
      data-status-home={statuses.map((status) => status.id).join(' ')}
      data-side={start ? 'start' : 'end'}
      className="board-rail relative z-20 flex min-h-0 shrink-0 flex-col"
      style={{ width }}
    >
      {/* Clips the rail's content as it springs; the edge's grip reaches out past it. */}
      <div className="absolute inset-0 overflow-hidden">
        <AnimatePresence initial={false}>
          {tiles ? (
            // The rail keeps its width and turns into the targets: nothing on the board moves
            // or is covered for a card that is only passing.
            <motion.div
              key="tiles"
              className={cn(
                'absolute inset-0 flex flex-col pt-[calc(var(--safe-top)+1.25rem)] pb-6',
                view === 'strip' ? 'gap-2 px-1' : 'gap-2.5 px-3.5',
              )}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
            >
              {groups.map((group) => (
                <Fragment key={group.title}>
                  {(view !== 'strip' || groups.length > 1) && (
                    <p
                      className={cn(
                        'truncate pt-1.5 pb-1 font-semibold text-[0.6875rem] text-muted-foreground uppercase tracking-[0.06em]',
                        view === 'strip' ? 'px-1 text-center' : 'px-1.5',
                      )}
                    >
                      {group.title}
                    </p>
                  )}
                  {group.statuses.map((status) => (
                    <StatusTile
                      key={status.id}
                      status={status}
                      shape={view === 'strip' ? 'narrow' : 'block'}
                    />
                  ))}
                </Fragment>
              ))}
            </motion.div>
          ) : view === 'strip' && !geometry.tracking ? (
            <motion.button
              key="strip"
              type="button"
              aria-label={`Open ${title.toLowerCase()}, ${count} tasks`}
              data-spotlight={hasBlocker ? 'blocker' : undefined}
              data-spotlight-instant={reduced ? '' : undefined}
              {...stripPress}
              className="spotlight-strip group absolute inset-0 flex select-none flex-col items-center gap-4 pt-[calc(var(--safe-top)+2.375rem)] text-muted-foreground outline-none [-webkit-touch-callout:none] hover:bg-foreground/[0.04] hover:text-foreground active:bg-foreground/[0.07] focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:ring-inset"
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
              // The header follows the rail's live width down to a single column, so its
              // actions stay at the rail's edge while the search sidebar or task pane slides.
              style={{ width: `max(100%, ${PANEL_WIDTH}px)`, [start ? 'left' : 'right']: 0 }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="column-head flex h-14 shrink-0 items-center gap-2 pr-2.5 pl-5">
                <h2 className="font-display font-semibold text-lg tracking-[-0.01em]">{title}</h2>
                <span className="flex-1 text-muted-foreground text-sm tabular-nums">{count}</span>
                {zone === 'backlog' && state.actions && (
                  <IconButton label="New task in the backlog" onClick={() => createTask()}>
                    <Plus />
                  </IconButton>
                )}
                <IconButton
                  ref={galleryToggle}
                  label={view === 'full' ? 'Back to a column' : 'Open as a gallery'}
                  onClick={() => setView(view === 'full' ? 'panel' : 'full')}
                >
                  {view === 'full' ? <Minimize2 /> : <Maximize2 />}
                </IconButton>
                <IconButton label={`Close ${title.toLowerCase()}`} onClick={() => setView('strip')}>
                  {start ? <PanelLeftClose /> : <PanelRightClose />}
                </IconButton>
              </div>
              <StatusFilter zone={zone} />
              <div className="relative flex min-h-0 flex-1">
                <div
                  className="absolute inset-y-0 flex min-h-0 flex-col"
                  // Laid out at its resting width from the start, so opening the rail reveals the
                  // cards and widening it fans them out into columns rather than re-wrapping them
                  // on every frame; keeping at least 100% avoids clipping cards while the rail
                  // narrows ahead of them.
                  style={{
                    width: `max(100%, ${geometry.content}px)`,
                    [start ? 'left' : 'right']: 0,
                  }}
                >
                  <ZoneGallery
                    zone={zone}
                    width={geometry.content - GALLERY_INSET * 2}
                    anchor={start ? 'start' : 'end'}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {showsRailEdge(view, geometry.tracking, tiles) && (
        <SplitHandle
          width={geometry.zone}
          min={STRIP_WIDTH}
          keyMin={PANEL_WIDTH}
          max={geometry.max}
          grows={start ? 'right' : 'left'}
          label={`Resize ${title.toLowerCase()}`}
          subtle
          className="absolute bottom-0 z-10 top-[calc(var(--safe-top)+4.75rem)]"
          // Centred in the space between the rail's cards and the column beside it.
          style={{ [start ? 'right' : 'left']: -EDGE_GRIP_OUTSET }}
          onResize={resize}
          onActive={hold}
        />
      )}
    </motion.aside>
  );
}

/**
 * The zone's statuses as filters. While one of the zone's own cards is held they are also
 * where it is dropped to change status, so they grow into targets, over the row's margins so
 * the cards below keep their places.
 */
export function StatusFilter({
  zone,
  anyCard,
  className,
}: {
  zone: Zone;
  /** Take cards from anywhere: on a phone the zone is a page, and these are its targets. */
  anyCard?: boolean;
  className?: string;
}) {
  const state = board.use();
  const held = drag.use();
  const statuses = zoneStatuses(zone, current(state).project.statuses);
  const filter = zone === 'backlog' ? state.backlogFilter : state.closedFilter;
  const setFilter = (value: string | null) =>
    update(zone === 'backlog' ? { backlogFilter: value } : { closedFilter: value });
  const targets = makingWay(held) && (anyCard || held.origin === zone);
  if (statuses.length < 2) return null;
  const chip =
    // A filter is a pill; as a drop target it grows to a tile with the status tiles' corners,
    // which at a filter's height is the same radius.
    'flex shrink-0 items-center rounded-2xl px-3.5 text-sm outline-none transition-[height,margin,background-color,color,border-color,box-shadow] duration-200 focus-visible:ring-[3px] focus-visible:ring-ring/60';
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
      {statuses.map((status) => (
        <StatusFilterChip
          key={status.id}
          zone={zone}
          status={status}
          project={current(state).project}
          subtasksAsCards={state.subtasksAsCards}
          visible={visibleIds(state)}
          filter={filter}
          targets={targets}
          over={held?.target?.kind === 'status' && held.target.statusId === status.id}
          chip={chip}
          onSelect={() => setFilter(filter === status.id ? null : status.id)}
        />
      ))}
    </div>
  );
}

function StatusFilterChip({
  zone,
  status,
  project,
  subtasksAsCards,
  visible,
  filter,
  targets,
  over,
  chip,
  onSelect,
}: {
  zone: Zone;
  status: Status;
  project: Project;
  subtasksAsCards: boolean;
  visible: ReadonlySet<string> | null;
  filter: string | null;
  targets: boolean;
  over: boolean;
  chip: string;
  onSelect: () => void;
}) {
  const reduced = useReducedMotion();
  const hasHiddenBlocker = useStatusSpotlightBlocker(
    status.id,
    project,
    subtasksAsCards,
    visible,
    zone === 'backlog' && !targets && filter !== null && filter !== status.id,
  );
  return (
    <button
      type="button"
      data-drop-status={targets ? status.id : undefined}
      data-spotlight={hasHiddenBlocker ? 'blocker' : undefined}
      data-spotlight-instant={reduced ? '' : undefined}
      aria-pressed={filter === status.id}
      onClick={onSelect}
      className={cn(
        chip,
        'border',
        // A target grows over the space around the row, not into it, so the cards below it
        // stay where they are while a card is held.
        targets ? '-my-1.5 h-11 flex-1 justify-center' : 'h-8',
        over
          ? 'border-brand bg-accent text-foreground shadow-md'
          : filter === status.id && !targets
            ? 'border-transparent bg-foreground text-background'
            : hasHiddenBlocker
              ? 'border-destructive/75 bg-destructive/12 text-foreground'
              : 'border-transparent bg-foreground/[0.06] text-foreground/75 hover:bg-foreground/[0.1]',
      )}
    >
      {status.color && (
        <StatusGlyph category={status.category} color={status.color} className="-ml-0.5 mr-1.5" />
      )}
      {status.name}
    </button>
  );
}
