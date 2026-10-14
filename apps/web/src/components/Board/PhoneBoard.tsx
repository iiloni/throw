import { Check, CheckCheck, ChevronDown, ChevronRight, Plus, Search, X } from 'lucide-react';
import {
  AnimatePresence,
  animate,
  motion,
  useDragControls,
  useMotionValue,
  useReducedMotion,
} from 'motion/react';
import { Dialog, DropdownMenu } from 'radix-ui';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { IconButton } from '@/components/IconButton/IconButton';
import { ProjectIcon } from '@/components/ProjectIcon/ProjectIcon';
import { useBackHandler } from '@/lib/backButton';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { BoardSettingsPanel } from './BoardSettingsPanel';
import { CardList } from './CardList';
import { drag, holding, pageStride } from './drag';
import { type Category, isClosed, type Status, type Task } from './model';
import { StatusFilter, zoneStatuses } from './SideZone';
import { StatusTile } from './StatusTile';
import {
  board,
  countIn,
  createTask,
  current,
  listTasks,
  selectProject,
  sendTasks,
  update,
} from './state';
import { TaskCard } from './TaskCard';

/** Clear space at the end of a column, for the backlog tray resting over it. */
const TRAY_SPACE = 'calc(var(--dock-height) + var(--safe-bottom) + 3rem)';
const DAY = 86_400_000;

/**
 * The board on a phone. The columns are the board, one page at a time; the backlog is a tray
 * that rests at the bottom as the dock, and the closed tasks are a history behind the header's
 * done count. Neither is a column, so moving work in and out of them is its own gesture: pull
 * a card up out of the tray, or finish it into the done pocket past the last column.
 */
export function PhoneBoard({
  projectMenu,
  syncIndicator,
  initialBacklog = false,
  onSearch,
  onReset,
  searchContent,
  onBacklogChange,
  onReturnBoard,
}: {
  projectMenu?: ReactNode;
  syncIndicator?: ReactNode;
  initialBacklog?: boolean;
  onSearch?: () => void;
  onReset?: () => void;
  searchContent?: ReactNode;
  onBacklogChange?: (open: boolean) => void;
  onReturnBoard?: () => void;
}) {
  const state = board.use();
  const { project } = current(state);
  const active = project.statuses.filter((status) => status.category === 'active');
  const done =
    project.statuses.find((status) => status.category === 'done' && status.isDefault) ??
    project.statuses.find((status) => status.category === 'done');
  const reduced = useReducedMotion();
  const pager = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [history, setHistory] = useState(false);

  function turnTo(index: number, behavior: ScrollBehavior = 'smooth') {
    const element = pager.current;
    element?.scrollTo({
      left: index * pageStride(element),
      behavior: reduced ? 'instant' : behavior,
    });
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 pt-[var(--safe-top)]">
        <div className="flex h-16 items-center gap-2 pr-3 pl-5">
          {projectMenu ?? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  aria-label="Switch project"
                  className="flex min-h-11 min-w-0 items-center gap-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="truncate font-display font-extrabold text-[1.75rem] leading-tight tracking-[-0.03em]">
                    {project.name}
                  </span>
                  <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="start"
                  sideOffset={8}
                  className="shell-menu glass-thick z-50 w-64 rounded-3xl p-2"
                >
                  {state.boards.map(({ project: item }) => (
                    <DropdownMenu.Item
                      key={item.id}
                      onSelect={() => {
                        selectProject(item.id);
                        turnTo(0, 'instant');
                      }}
                      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm outline-none data-[highlighted]:bg-accent"
                    >
                      <ProjectIcon name={item.icon} className="size-4 shrink-0" />
                      {item.name}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
          <span className="flex-1" />
          <DoneCount onOpen={() => setHistory(true)} />
          <BoardSettingsPanel side="bottom" onReset={onReset} />
        </div>
        {syncIndicator && (
          <div className="px-5 text-muted-foreground empty:hidden">{syncIndicator}</div>
        )}
        {!searchContent && <FlowTrack statuses={active} page={page} onTurn={turnTo} />}
      </header>

      {searchContent ? (
        <div className="min-h-0 flex-1 pb-[var(--dock-space)]">{searchContent}</div>
      ) : (
        <div className="relative flex min-h-0 flex-1">
          <div
            ref={pager}
            data-pager=""
            onScroll={(event) =>
              setPage(Math.round(event.currentTarget.scrollLeft / pageStride(event.currentTarget)))
            }
            className="phone-pager flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
          >
            {active.map((status) => (
              <div key={status.id} data-page="" data-origin="active" className={pageClass}>
                <CardList
                  listId={`status:${status.id}`}
                  endSpace={TRAY_SPACE}
                  tight
                  className="flex-1"
                />
              </div>
            ))}
          </div>
          <PeekEdge side={-1} shown={page > 0} />
          <PeekEdge side={1} shown={page < active.length - 1} />
          {done && <DonePocket status={done} shown={page === active.length - 1} />}
        </div>
      )}

      <BacklogTray
        initialOpen={initialBacklog}
        onSearch={() => {
          setPage(0);
          onSearch?.();
        }}
        onChange={onBacklogChange}
        onCreate={(inBacklog) => {
          onReturnBoard?.();
          createTask(inBacklog ? undefined : active[page]?.id);
        }}
      />
      <MoveDrawer />
      <ClosedSheet open={history} onClose={() => setHistory(false)} />
    </div>
  );
}

const pageClass = 'flex w-full shrink-0 snap-center flex-col px-[var(--page-inset)]';

/**
 * The current column by name, and the active columns as one track in the order work moves
 * through them: the ones behind are filled in, so the header says how far along the board
 * the page is. The next column is named at the end, a step further along.
 */
function FlowTrack({
  statuses,
  page,
  onTurn,
}: {
  statuses: Status[];
  page: number;
  onTurn: (index: number) => void;
}) {
  const state = board.use();
  const status = statuses[page];
  const next = statuses[page + 1];
  // Which way the name slides: the way the board turned.
  const [last, setLast] = useState(page);
  const [direction, setDirection] = useState(1);
  if (page !== last) {
    setDirection(Math.sign(page - last));
    setLast(page);
  }
  if (!status) return null;
  return (
    <div className="px-5 pb-2">
      <div className="flex h-9 items-center gap-2 overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.h2
            key={status.id}
            className="flex min-w-0 items-baseline gap-2"
            custom={direction}
            variants={{
              enter: (side: number) => ({ opacity: 0, x: side * 28 }),
              exit: (side: number) => ({ opacity: 0, x: side * -28 }),
            }}
            initial="enter"
            animate={{ opacity: 1, x: 0 }}
            exit="exit"
            transition={springs.snappy}
          >
            <span className="truncate font-bold font-display text-xl tracking-[-0.01em]">
              {status.name}
            </span>
            <span className="text-muted-foreground text-sm tabular-nums">
              {countIn(state, status.id)}
            </span>
          </motion.h2>
        </AnimatePresence>
        <span className="flex-1" />
        {next && (
          <button
            type="button"
            onClick={() => onTurn(page + 1)}
            className="flex h-9 shrink-0 items-center gap-0.5 rounded-full pr-1.5 pl-3 text-muted-foreground text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
          >
            {next.name}
            <ChevronRight aria-hidden className="size-4" />
          </button>
        )}
      </div>
      <nav aria-label="Columns" className="flex gap-1">
        {statuses.map((item, index) => (
          <button
            key={item.id}
            type="button"
            aria-label={item.name}
            aria-current={index === page ? 'page' : undefined}
            onClick={() => onTurn(index)}
            className="flex h-6 min-w-0 flex-1 items-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
          >
            <span className="relative h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
              <span
                className={cn(
                  'absolute inset-0 rounded-full bg-foreground/25 transition-opacity duration-300',
                  index < page ? 'opacity-100' : 'opacity-0',
                )}
              />
              {index === page && (
                <motion.span
                  layoutId="phone-flow"
                  className="absolute inset-0 rounded-full bg-foreground"
                  transition={springs.snappy}
                />
              )}
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
}

/**
 * What was finished this week, and the way into everything closed. A card sent to a closed
 * status flies into it, and the count bumps as it arrives.
 */
function DoneCount({ onOpen }: { onOpen: () => void }) {
  const state = board.use();
  const { project, tasks } = current(state);
  const closedIds = project.statuses.filter((status) => isClosed(status.category));
  const doneIds = closedIds.filter((status) => status.category === 'done').map(({ id }) => id);
  const since = Date.now() - 7 * DAY;
  const count = tasks.filter(
    (task) => doneIds.includes(task.statusId) && (task.closedAt ?? 0) > since,
  ).length;
  return (
    <button
      type="button"
      data-closed-trigger=""
      data-status-home={closedIds.map(({ id }) => id).join(' ')}
      aria-label={`${count} done this week. Show closed tasks`}
      onClick={onOpen}
      className="flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-foreground/[0.06] pr-3.5 pl-3 font-semibold text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
    >
      <CheckCheck aria-hidden className="size-4 text-brand-link" strokeWidth={2.5} />
      <motion.span
        key={count}
        className="tabular-nums"
        initial={{ scale: 1.6, color: 'var(--brand-link)' }}
        animate={{ scale: 1, color: 'var(--foreground)' }}
        transition={springs.snappy}
      >
        {count}
      </motion.span>
    </button>
  );
}

/**
 * While a card is held, a page beside the current one peeks in at the screen's edge as a
 * bare surface, without its cards: a target that turns the board, kept quiet. It leans
 * further in while the card waits there. The surface lies over the pager rather than being
 * the page itself, so the pages keep their width and scroll position under a finger, which
 * Chrome on Android does not re-snap.
 */
function PeekEdge({ side, shown }: { side: -1 | 1; shown: boolean }) {
  const held = drag.use();
  const visible = held?.phase === 'dragging' && shown;
  const waiting = visible && held.page === side;
  return (
    <motion.div
      aria-hidden
      className={cn(
        'pointer-events-none absolute top-1 bottom-[calc(var(--safe-bottom)+4.5rem)] z-10 w-10 rounded-3xl transition-colors',
        side < 0 ? '-left-[1.625rem]' : '-right-[1.625rem]',
        waiting ? 'bg-brand/25' : 'bg-foreground/[0.07]',
      )}
      initial={false}
      animate={{ x: visible ? (waiting ? -side * 8 : 0) : side * 24, opacity: visible ? 1 : 0 }}
      transition={springs.snappy}
    />
  );
}

/**
 * Past the last column there is no page, but a pocket: dropping a card there finishes it.
 * It is a status target for the drag engine, and only one while a card is held, so the
 * landing copy flies on to the done count instead.
 */
function DonePocket({ status, shown }: { status: Status; shown: boolean }) {
  const held = drag.use();
  const visible = held?.phase === 'dragging' && shown;
  const over = visible && held.target?.kind === 'status' && held.target.statusId === status.id;
  return (
    <motion.div
      aria-hidden
      data-drop-status={visible ? status.id : undefined}
      className={cn(
        '-right-10 absolute top-1 bottom-[calc(var(--safe-bottom)+4.5rem)] z-10 flex w-[4.5rem] flex-col items-center justify-center gap-2 rounded-l-3xl pr-10 transition-colors',
        visible ? 'pointer-events-auto' : 'pointer-events-none',
        over ? 'bg-brand text-brand-foreground' : 'bg-brand/20 text-brand-link',
      )}
      initial={false}
      animate={{ x: visible ? (over ? -16 : 0) : 48, opacity: visible ? 1 : 0 }}
      transition={springs.snappy}
    >
      <motion.span animate={{ scale: over ? 1.25 : 1 }} transition={springs.snappy}>
        <Check aria-hidden className="size-5" strokeWidth={3} />
      </motion.span>
      <span className="font-bold text-[0.6875rem] uppercase tracking-[0.1em] [writing-mode:vertical-rl]">
        {status.name}
      </span>
    </motion.div>
  );
}

type Detent = 'closed' | 'half' | 'full';

const dockButton =
  'relative flex size-[var(--dock-height)] shrink-0 items-center justify-center rounded-[var(--dock-radius)] outline-none focus-visible:ring-2 focus-visible:ring-ring/70';

/**
 * The backlog as a tray under the board. Closed, it is the dock: the backlog's handle beside
 * search and the create button. Half open, it is a supply to take work from, with the board
 * still above: lifting a card sinks the tray out of the way so the whole screen is board to
 * place it on. Full, it is the backlog to groom, and its cards are reordered in place.
 */
function BacklogTray({
  onCreate,
  initialOpen,
  onSearch,
  onChange,
}: {
  onCreate: (inBacklog: boolean) => void;
  initialOpen: boolean;
  onSearch?: () => void;
  onChange?: (open: boolean) => void;
}) {
  const state = board.use();
  const held = drag.use();
  const { project } = current(state);
  const statuses = zoneStatuses('backlog', project.statuses);
  const count = listTasks({ ...state, backlogFilter: null }, 'backlog').length;
  const [detent, setDetent] = useState<Detent>(initialOpen ? 'half' : 'closed');
  // What the tray leaves off screen at half height, kept clear at the end of its list.
  const [hidden, setHidden] = useState(0);
  const tray = useRef<HTMLElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const safe = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const y = useMotionValue(0);
  const panFrom = useRef(0);
  // Grooming keeps the tray where it is; anything else held wants the board.
  const sunk = held !== null && detent !== 'full';

  const offsets = () => trayOffsets(tray.current, head.current, safe.current);

  function goTo(next: Detent) {
    setDetent(next);
    onChange?.(next !== 'closed');
    setHidden(next === 'half' ? offsets().half : 0);
    // Let go at the height it was at: there is no new detent to move it.
    if (next === detent) animate(y, offsets()[next], reduced ? { duration: 0 } : springs.smooth);
  }

  useBackHandler(detent !== 'closed', () => goTo('closed'));
  const placed = useRef(false);
  useLayoutEffect(() => {
    const at = trayOffsets(tray.current, head.current, safe.current);
    const to = sunk ? at.sunk : at[detent];
    setHidden(detent === 'half' ? at.half : 0);
    if (placed.current) animate(y, to, reduced ? { duration: 0 } : springs.smooth);
    else y.jump(to);
    placed.current = true;
  }, [sunk, detent, y, reduced]);

  useLayoutEffect(() => {
    const onResize = () => {
      const at = offsets();
      y.jump(at[detent]);
      setHidden(detent === 'half' ? at.half : 0);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  return (
    <motion.section
      ref={tray}
      aria-label="Backlog"
      data-detent={detent}
      data-drop-block=""
      data-origin="backlog"
      style={{ y }}
      className="glass-thick fixed inset-x-0 top-[calc(var(--safe-top)+0.5rem)] bottom-0 z-30 mx-auto flex w-full max-w-md flex-col rounded-t-[1.75rem]"
    >
      <div ref={safe} aria-hidden className="pointer-events-none absolute h-[var(--safe-bottom)]" />
      <motion.div
        ref={head}
        className="shrink-0 touch-none select-none px-3 pt-2 pb-2"
        onPanStart={() => {
          panFrom.current = y.get();
        }}
        onPan={(_, info) => {
          const at = offsets();
          y.set(Math.min(at.closed, Math.max(0, panFrom.current + info.offset.y)));
        }}
        onPanEnd={(_, info) => {
          const at = offsets();
          const aim = y.get() + info.velocity.y * 0.15;
          const order: Detent[] = ['full', 'half', 'closed'];
          const nearest = order.reduce((best, next) =>
            Math.abs(at[next] - aim) < Math.abs(at[best] - aim) ? next : best,
          );
          goTo(nearest);
        }}
      >
        <div aria-hidden className="mx-auto mb-2 h-1 w-9 rounded-full bg-foreground/20" />
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-expanded={detent !== 'closed'}
            aria-keyshortcuts="ArrowUp ArrowDown"
            onKeyDown={(event) => {
              const order: Detent[] = ['closed', 'half', 'full'];
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
              event.preventDefault();
              goTo(
                order[
                  Math.max(
                    0,
                    Math.min(2, order.indexOf(detent) + (event.key === 'ArrowUp' ? 1 : -1)),
                  )
                ]!,
              );
            }}
            data-status-home={statuses.map(({ id }) => id).join(' ')}
            onClick={() => goTo(detent === 'closed' ? 'half' : 'closed')}
            className={cn(
              'flex h-[var(--dock-height)] min-w-0 flex-1 items-center gap-3 rounded-[var(--dock-radius)] px-4 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/70',
              detent === 'closed' && 'bg-foreground/[0.06]',
            )}
          >
            <CardStack count={count} />
            <span className="font-bold font-display text-lg tracking-[-0.01em]">Backlog</span>
            <span className="text-muted-foreground text-sm tabular-nums">{count}</span>
          </button>
          <motion.button
            type="button"
            aria-label="Search"
            onClick={() => {
              setDetent('closed');
              onSearch?.();
            }}
            whileTap={{ scale: 0.88 }}
            transition={springs.snappy}
            className={cn(dockButton, 'bg-foreground/[0.06] text-foreground')}
          >
            <Search className="size-6" aria-hidden />
          </motion.button>
          <motion.button
            type="button"
            aria-label={detent === 'closed' ? 'New task' : 'New task in the backlog'}
            onClick={() => onCreate(detent !== 'closed')}
            whileTap={{ scale: 0.88 }}
            transition={springs.snappy}
            className={cn(
              dockButton,
              'bg-brand text-brand-foreground shadow-[0_8px_24px_-6px_color-mix(in_oklab,var(--brand)_55%,transparent),inset_0_1px_0_rgb(255_255_255/0.45)]',
            )}
          >
            <Plus className="size-7" strokeWidth={2.25} aria-hidden />
          </motion.button>
        </div>
      </motion.div>
      <div className="flex min-h-0 flex-1 flex-col" inert={detent === 'closed' && !held}>
        <StatusFilter zone="backlog" className="px-4 pt-1" />
        <CardList
          listId="backlog"
          showStatus={state.backlogFilter === null}
          endSpace={`calc(${hidden}px + var(--safe-bottom) + 1rem)`}
          className="flex-1"
        />
      </div>
    </motion.section>
  );
}

/** How far down the tray sits at each detent; `sunk` is out of sight, under a held card. */
function trayOffsets(tray: HTMLElement | null, head: HTMLElement | null, safe: HTMLElement | null) {
  const height = tray?.offsetHeight ?? window.innerHeight;
  const peek = (head?.offsetHeight ?? 0) + (safe?.offsetHeight ?? 0);
  return { full: 0, half: Math.round(height * 0.42), closed: height - peek, sunk: height };
}

/** The backlog's handle shows a stack of cards, as deep as the backlog, up to three. */
function CardStack({ count }: { count: number }) {
  const depth = Math.min(3, count);
  return (
    <span aria-hidden className="relative h-6 w-7 shrink-0">
      {Array.from({ length: Math.max(depth, 1) }, (_, index) => (
        <motion.span
          // biome-ignore lint/suspicious/noArrayIndexKey: the stack's layers are positions, not items.
          key={index}
          className={cn(
            'absolute inset-y-0 w-5 rounded-[5px] border border-border bg-card shadow-sm',
            depth === 0 && 'border-dashed bg-transparent shadow-none',
          )}
          initial={false}
          animate={{ x: index * 4, rotate: (index - 1) * 6, y: index === 2 ? -1 : 0 }}
          transition={springs.snappy}
        />
      ))}
    </span>
  );
}

/** The status groups, in the board's order. */
function byCategory(statuses: Status[]) {
  const groups: { name: string; statuses: Status[] }[] = [
    { name: 'Backlog', statuses: [] },
    { name: 'Active', statuses: [] },
    { name: 'Closed', statuses: [] },
  ];
  const slot: Record<Category, number> = { backlog: 0, active: 1, done: 2, cancelled: 2 };
  for (const status of statuses) groups[slot[status.category]]!.statuses.push(status);
  return groups;
}

/**
 * Where a held card is sent anywhere, wherever it came from: a lip at the bottom edge that
 * opens into a grid of every status when the card is brought onto it. Selected cards open
 * it too. It lies over the tray, which sinks out of the way while a card is held.
 */
function MoveDrawer() {
  const state = board.use();
  const held = drag.use();
  const fingerDown = holding.use();
  const { project } = current(state);
  const selected = state.selection.length;
  const dragging = held?.phase === 'dragging';
  // Selecting by holding a card must not open the grid under the finger that is still down.
  const pick = selected > 0 && !dragging && !fingerDown;
  // A held card opens the grid by being brought to the lip, and closes it by leaving.
  const open = pick || (dragging && held.over);
  const send = (statusId: string) => {
    sendTasks(state.selection, statusId);
    update({ selection: [] });
  };
  if (!open && !dragging) return null;

  return (
    <div data-drop-block="" className="pointer-events-none fixed inset-x-0 bottom-0 z-50">
      <motion.div
        layout
        transition={springs.snappy}
        data-drop-expand=""
        style={{ borderTopLeftRadius: 28, borderTopRightRadius: 28 }}
        className="glass-thick pointer-events-auto mx-auto w-full max-w-md overflow-hidden pb-[var(--safe-bottom)]"
      >
        <motion.div
          layout="position"
          aria-hidden
          className="mx-auto mt-2 h-1 w-9 rounded-full bg-foreground/20"
        />
        {pick && (
          <motion.div layout="position" className="flex h-12 items-center pr-1.5 pl-4">
            <span className="flex-1 font-medium text-sm tabular-nums">{selected} selected</span>
            <IconButton label="Clear selection" onClick={() => update({ selection: [] })}>
              <X />
            </IconButton>
          </motion.div>
        )}
        {open ? (
          <motion.div
            layout="position"
            className={cn('space-y-2.5 px-3 pt-2 pb-3', pick && 'pt-0')}
          >
            {byCategory(project.statuses).map((group) => (
              <section key={group.name}>
                <h3 className="px-1 pb-1.5 font-semibold text-[0.6875rem] text-muted-foreground uppercase tracking-[0.06em]">
                  {group.name}
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {group.statuses.map((status) => (
                    <StatusTile
                      key={status.id}
                      status={status}
                      shape="row"
                      onPick={pick ? () => send(status.id) : undefined}
                    />
                  ))}
                </div>
              </section>
            ))}
          </motion.div>
        ) : (
          <motion.p
            layout="position"
            className="flex h-10 items-center justify-center pb-1 font-medium text-muted-foreground text-xs"
          >
            Move to a status
          </motion.p>
        )}
      </motion.div>
    </div>
  );
}

/** Closed tasks by when they were closed, newest first. */
function closedByDay(tasks: Task[]) {
  const today = new Date().setHours(0, 0, 0, 0);
  const label = (at: number) =>
    at >= today
      ? 'Today'
      : at >= today - DAY
        ? 'Yesterday'
        : at >= today - 6 * DAY
          ? 'This week'
          : 'Earlier';
  const groups: { label: string; tasks: Task[] }[] = [];
  for (const task of tasks) {
    const name = label(task.closedAt ?? 0);
    const last = groups.at(-1);
    if (last?.label === name) last.tasks.push(task);
    else groups.push({ label: name, tasks: [task] });
  }
  return groups;
}

/**
 * Everything closed, as a history rather than a column: grouped by day, filtered to done or
 * cancelled. A card held here reopens through the move drawer.
 */
function ClosedSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = board.use();
  const controls = useDragControls();
  useBackHandler(open, onClose);
  const groups = closedByDay(listTasks(state, 'closed'));
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <AnimatePresence>
        {open && (
          <Dialog.Content
            asChild
            forceMount
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              document.querySelector<HTMLElement>('[role="dialog"][aria-label="Closed"]')?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              document.querySelector<HTMLElement>('[data-closed-trigger]')?.focus();
            }}
          >
            <motion.section
              role="dialog"
              aria-modal="true"
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !event.defaultPrevented) {
                  event.preventDefault();
                  onClose();
                }
              }}
              aria-label="Closed"
              tabIndex={-1}
              data-origin="closed"
              data-drop-block=""
              className="fixed inset-x-0 top-[calc(var(--safe-top)+0.5rem)] bottom-0 z-40 mx-auto flex w-full max-w-md flex-col rounded-t-[1.75rem] bg-background shadow-[0_-12px_40px_-12px_oklch(0_0_0/0.35)]"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={springs.smooth}
              drag="y"
              dragControls={controls}
              dragListener={false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 120 || info.velocity.y > 500) onClose();
              }}
            >
              <div
                className="shrink-0 touch-none select-none"
                onPointerDown={(event) => controls.start(event)}
              >
                <div aria-hidden className="mx-auto mt-2 h-1 w-9 rounded-full bg-foreground/20" />
                <div className="flex h-14 items-center pr-2 pl-5">
                  <Dialog.Title asChild>
                    <h2 className="flex-1 font-bold font-display text-xl tracking-[-0.01em]">
                      Closed
                    </h2>
                  </Dialog.Title>
                  <IconButton label="Close" onClick={onClose}>
                    <X />
                  </IconButton>
                </div>
              </div>
              <StatusFilter zone="closed" />
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3.5 pb-[calc(var(--safe-bottom)+1.5rem)] [scrollbar-width:none]">
                {groups.map((group) => (
                  <section key={group.label}>
                    <h3 className="px-1.5 pt-3 pb-2 font-semibold text-[0.6875rem] text-muted-foreground uppercase tracking-[0.06em]">
                      {group.label}
                    </h3>
                    <div className="space-y-3">
                      {group.tasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          showStatus={state.closedFilter === null}
                        />
                      ))}
                    </div>
                  </section>
                ))}
                {groups.length === 0 && (
                  <p className="py-10 text-center text-muted-foreground text-sm">
                    {state.awaitingTasks ? 'Loading tasks…' : 'Nothing closed.'}
                  </p>
                )}
              </div>
            </motion.section>
          </Dialog.Content>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
