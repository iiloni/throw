import { ChevronDown, Columns3, LayoutDashboard, Search, X } from 'lucide-react';
import { animate, motion, useMotionValue } from 'motion/react';
import { DropdownMenu } from 'radix-ui';
import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { IconButton } from '@/components/IconButton/IconButton';
import { ProjectIcon } from '@/components/ProjectIcon/ProjectIcon';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { BoardSettingsPanel } from './BoardSettingsPanel';
import { CardList } from './CardList';
import { drag } from './drag';
import type { Category, Status } from './model';
import { StatusFilter } from './SideZone';
import { StatusTile } from './StatusTile';
import { board, countIn, current, listTasks, selectProject, sendTasks, update } from './state';
import { TaskCard } from './TaskCard';

const DOCK_SPACE = 'var(--dock-space)';
type Drawer = 'closed' | 'half' | 'full';

/**
 * The board on a phone: one active column at a time, the closed zone at the right end, the
 * backlog in a drawer that rises from the dock, and the dock itself as the place cards are
 * sent when one is held or several are selected.
 */
export function PhoneBoard() {
  const state = board.use();
  const held = drag.use();
  const { project } = current(state);
  const active = project.statuses.filter((status) => status.category === 'active');
  const pager = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [drawer, setDrawer] = useState<Drawer>('closed');
  const pages = [...active.map((status) => status.name), 'Closed'];

  // A card lifted out of a full-height drawer needs the board to be reachable above it.
  const lifted = held?.phase === 'dragging' && held.origin === 'backlog';
  useEffect(() => {
    if (lifted) setDrawer((value) => (value === 'full' ? 'half' : value));
  }, [lifted]);

  function turnTo(index: number) {
    const element = pager.current;
    element?.scrollTo({ left: index * element.clientWidth, behavior: 'smooth' });
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="shrink-0 pt-[var(--safe-top)]">
        <div className="flex h-16 items-center gap-2 pr-3 pl-5">
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
                      pager.current?.scrollTo({ left: 0 });
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
          <span className="flex-1" />
          <BoardSettingsPanel side="bottom" />
        </div>
        <div className="flex gap-1.5 overflow-x-auto px-4 pb-4 [scrollbar-width:none]">
          {pages.map((name, index) => (
            <button
              key={name}
              type="button"
              aria-current={index === page ? 'page' : undefined}
              onClick={() => turnTo(index)}
              className={cn(
                'relative flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/60',
                index === page ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {index === page && (
                <motion.span
                  layoutId="phone-column"
                  aria-hidden
                  className="-z-10 absolute inset-0 rounded-full bg-foreground/[0.08]"
                  transition={springs.snappy}
                />
              )}
              {name}
              {active[index] && (
                <span className="text-xs tabular-nums opacity-60">
                  {countIn(state, active[index].id)}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      <div
        ref={pager}
        data-pager=""
        onScroll={(event) => {
          const element = event.currentTarget;
          setPage(Math.round(element.scrollLeft / element.clientWidth));
        }}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
      >
        {active.map((status) => (
          <div key={status.id} data-origin="active" className="flex w-full shrink-0 snap-center">
            <CardList listId={`status:${status.id}`} endSpace={DOCK_SPACE} className="flex-1" />
          </div>
        ))}
        <div data-origin="closed" className="flex w-full shrink-0 snap-center flex-col">
          <StatusFilter zone="closed" />
          <div
            className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 pt-1 [scrollbar-width:none]"
            style={{ paddingBottom: DOCK_SPACE }}
          >
            {listTasks(state, 'closed').map((task) => (
              <TaskCard key={task.id} task={task} showStatus={state.closedFilter === null} />
            ))}
          </div>
        </div>
      </div>

      <BacklogDrawer drawer={drawer} setDrawer={setDrawer} />
      <PhoneDock
        drawer={drawer}
        onBacklog={() => setDrawer(drawer === 'closed' ? 'half' : 'closed')}
        onBoard={() => setDrawer('closed')}
      />
    </div>
  );
}

/** How far down the drawer sits in each state. */
function rest(value: Drawer) {
  return value === 'full' ? 0 : value === 'half' ? window.innerHeight * 0.42 : window.innerHeight;
}

/** The backlog, rising from the dock: part of the screen first, then all of it. */
function BacklogDrawer({
  drawer,
  setDrawer,
}: {
  drawer: Drawer;
  setDrawer: (value: Drawer) => void;
}) {
  const state = board.use();
  const count = listTasks({ ...state, backlogFilter: null }, 'backlog').length;
  const y = useMotionValue(window.innerHeight);
  const grip = useRef<{ start: number; from: number } | null>(null);

  useEffect(() => {
    const controls = animate(y, rest(drawer), springs.smooth);
    return () => controls.stop();
  }, [drawer, y]);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    grip.current = { start: event.clientY, from: y.get() };
  }
  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const held = grip.current;
    if (!held) return;
    grip.current = null;
    const travelled = event.clientY - held.start;
    const order: Drawer[] = ['full', 'half', 'closed'];
    const index = order.indexOf(drawer);
    const next =
      Math.abs(travelled) < 40
        ? drawer
        : order[Math.max(0, Math.min(2, index + Math.sign(travelled)))]!;
    if (next === drawer) void animate(y, rest(drawer), springs.smooth);
    else setDrawer(next);
  }

  return (
    <motion.section
      aria-label="Backlog"
      aria-hidden={drawer === 'closed'}
      inert={drawer === 'closed'}
      data-drop-block=""
      data-origin="backlog"
      className="glass-thick fixed inset-x-0 top-[calc(var(--safe-top)+0.5rem)] bottom-0 z-20 flex flex-col rounded-t-[28px] border-b-0"
      style={{ y }}
    >
      <div
        className="shrink-0 touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={(event) => {
          if (grip.current)
            y.set(Math.max(0, grip.current.from + event.clientY - grip.current.start));
        }}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div aria-hidden className="flex justify-center pt-2.5">
          <span className="h-1 w-9 rounded-full bg-foreground/20" />
        </div>
        <div className="flex h-14 items-center gap-2.5 px-5">
          <h2 className="font-display font-semibold text-xl tracking-[-0.01em]">Backlog</h2>
          <span className="text-muted-foreground text-sm tabular-nums">{count}</span>
        </div>
      </div>
      <StatusFilter zone="backlog" />
      {/* At part height the drawer hangs off the screen; the list must end where the screen does. */}
      <motion.div
        className="flex min-h-0 flex-col"
        style={{ height: `calc(100% - 8.25rem)`, paddingBottom: y }}
      >
        <CardList
          listId="backlog"
          showStatus={state.backlogFilter === null}
          endSpace={DOCK_SPACE}
          className="flex-1"
        />
      </motion.div>
    </motion.section>
  );
}

const TABS = [
  { id: 'backlog', label: 'Backlog', icon: LayoutDashboard },
  { id: 'board', label: 'Board', icon: Columns3 },
  { id: 'search', label: 'Search', icon: Search },
] as const;

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
 * The dock. At rest it is the three tabs. With a card held or cards selected it becomes a
 * grid of every status, grouped by category, so a card reaches any of them without the
 * board being scrolled.
 */
function PhoneDock({
  drawer,
  onBacklog,
  onBoard,
}: {
  drawer: Drawer;
  onBacklog: () => void;
  onBoard: () => void;
}) {
  const state = board.use();
  const held = drag.use();
  const { project } = current(state);
  const selected = state.selection.length;
  const dragging = held?.phase === 'dragging';
  const pick = selected > 0 && !dragging;
  const send = (statusId: string) => {
    sendTasks(state.selection, statusId);
    update({ selection: [] });
  };
  const tab = drawer === 'closed' ? 'board' : 'backlog';

  return (
    <div
      data-drop-block=""
      className="pointer-events-none fixed inset-x-0 bottom-[var(--dock-bottom)] z-30 flex justify-center px-3"
    >
      <motion.div
        layout
        transition={springs.snappy}
        style={{ borderRadius: 22 }}
        className="glass pointer-events-auto w-full max-w-md overflow-hidden"
      >
        {pick && (
          <motion.div layout="position" className="flex h-12 items-center pr-1.5 pl-4">
            <span className="flex-1 font-medium text-sm tabular-nums">{selected} selected</span>
            <IconButton label="Clear selection" onClick={() => update({ selection: [] })}>
              <X />
            </IconButton>
          </motion.div>
        )}
        {dragging || pick ? (
          <motion.div layout="position" className={cn('space-y-2.5 p-3', pick && 'pt-0')}>
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
          <motion.nav
            layout="position"
            aria-label="Project views"
            className="grid h-[var(--dock-height)] grid-cols-3 p-1"
          >
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-label={label}
                aria-current={tab === id ? 'page' : undefined}
                onClick={id === 'backlog' ? onBacklog : id === 'board' ? onBoard : undefined}
                className={cn(
                  'relative z-0 flex items-center justify-center rounded-[calc(var(--dock-radius)-0.25rem)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/70',
                  tab === id ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {tab === id && (
                  <motion.span
                    layoutId="prototype-dock-indicator"
                    aria-hidden
                    className="-z-10 absolute inset-0 rounded-[calc(var(--dock-radius)-0.25rem)] bg-accent shadow-[inset_0_1px_0_var(--glass-highlight)]"
                    transition={springs.snappy}
                  />
                )}
                <Icon className="size-6" aria-hidden />
              </button>
            ))}
          </motion.nav>
        )}
      </motion.div>
    </div>
  );
}
