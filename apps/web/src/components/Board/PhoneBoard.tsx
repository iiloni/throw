import {
  ArrowRightLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { DropdownMenu } from 'radix-ui';
import { useLayoutEffect, useRef, useState } from 'react';
import { IconButton } from '@/components/IconButton/IconButton';
import { ProjectIcon } from '@/components/ProjectIcon/ProjectIcon';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { BoardSettingsPanel } from './BoardSettingsPanel';
import { CardList } from './CardList';
import { drag, holding, PAGE_EDGE, PAGE_HOLD_MS } from './drag';
import type { Category, Status } from './model';
import { StatusFilter } from './SideZone';
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

const DOCK_SPACE = 'var(--dock-space)';

/**
 * The board on a phone: one page at a time, swiped or chosen from the tabs. The backlog is
 * the first page and the closed zone the last, so a card moves between them the way it moves
 * between columns. The dock holds search and the create button, and becomes the place cards
 * are sent when one is held or several are selected.
 */
export function PhoneBoard() {
  const state = board.use();
  const { project } = current(state);
  const active = project.statuses.filter((status) => status.category === 'active');
  const pager = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(1);
  const pages = ['Backlog', ...active.map((status) => status.name), 'Closed'];
  const counts = [
    listTasks({ ...state, backlogFilter: null }, 'backlog').length,
    ...active.map((status) => countIn(state, status.id)),
    null,
  ];

  function turnTo(index: number, behavior: ScrollBehavior = 'smooth') {
    const element = pager.current;
    element?.scrollTo({ left: index * element.clientWidth, behavior });
  }

  // The board opens on its first active column, with the backlog one page to the left.
  useLayoutEffect(() => {
    const element = pager.current;
    if (element) element.scrollLeft = element.clientWidth;
  }, []);

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
                      turnTo(1, 'instant');
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
              {counts[index] !== null && (
                <span className="text-xs tabular-nums opacity-60">{counts[index]}</span>
              )}
            </button>
          ))}
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div
          ref={pager}
          data-pager=""
          onScroll={(event) => {
            const element = event.currentTarget;
            setPage(Math.round(element.scrollLeft / element.clientWidth));
          }}
          className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
        >
          <div data-origin="backlog" className="flex w-full shrink-0 snap-center flex-col">
            <StatusFilter zone="backlog" />
            <CardList
              listId="backlog"
              showStatus={state.backlogFilter === null}
              endSpace={DOCK_SPACE}
              className="flex-1"
            />
          </div>
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
        <PageEdge side={-1} name={pages[page - 1]} />
        <PageEdge side={1} name={pages[page + 1]} />
      </div>

      <PhoneDock onCreate={() => createTask(active[page - 1]?.id)} />
    </div>
  );
}

/**
 * While a card is held, each side of the screen with a page beyond it shows that page's
 * name. Holding the card there fills the edge, and the page turns when it is full.
 */
function PageEdge({ side, name }: { side: -1 | 1; name: string | undefined }) {
  const held = drag.use();
  if (held?.phase !== 'dragging' || !name) return null;
  const waiting = held.page === side;
  const Icon = side < 0 ? ChevronLeft : ChevronRight;
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-y-4 z-10 flex items-center',
        side < 0 ? 'left-1' : 'right-1',
      )}
      style={{ width: PAGE_EDGE - 8 }}
    >
      {/* Only the edge being waited at fills, so the column under the card stays calm. */}
      <motion.span
        className="absolute inset-0 overflow-hidden rounded-2xl bg-accent"
        initial={false}
        animate={{ opacity: waiting ? 1 : 0 }}
        transition={{ duration: 0.15 }}
      >
        {waiting && (
          <span
            key={held.turns}
            className="absolute inset-0 origin-bottom bg-brand/25"
            // After a turn the next one waits for the page to settle first.
            style={{
              animation: `page-charge ${PAGE_HOLD_MS}ms linear ${held.turns ? 250 : 0}ms both`,
            }}
          />
        )}
      </motion.span>
      <motion.span
        className={cn(
          'relative mx-auto flex max-h-[45%] flex-col items-center gap-1.5 overflow-hidden rounded-full py-2.5 text-xs shadow-sm transition-colors',
          waiting ? 'text-foreground' : 'glass text-muted-foreground',
        )}
        style={{ width: PAGE_EDGE - 14 }}
        initial={{ opacity: 0, x: side * 12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={springs.snappy}
      >
        <Icon className="size-4 shrink-0" />
        <span className="min-h-0 truncate font-medium [writing-mode:vertical-rl]">{name}</span>
      </motion.span>
    </div>
  );
}

/**
 * The status groups, with the active statuses last: a held card comes down onto the dock,
 * so the row nearest it is the one it most often wants.
 */
function byCategory(statuses: Status[]) {
  const groups: { name: string; statuses: Status[] }[] = [
    { name: 'Backlog', statuses: [] },
    { name: 'Closed', statuses: [] },
    { name: 'Active', statuses: [] },
  ];
  const slot: Record<Category, number> = { backlog: 0, done: 1, cancelled: 1, active: 2 };
  for (const status of statuses) groups[slot[status.category]]!.statuses.push(status);
  return groups;
}

const dockButton =
  'pointer-events-auto relative flex size-[var(--dock-height)] items-center justify-center rounded-[var(--dock-radius)] outline-none focus-visible:ring-2 focus-visible:ring-ring/70';

/**
 * The dock: search and the create button, as in Catch. With cards selected, or a held card
 * brought to it, it opens into a grid of every status, so a card reaches any of them without
 * the board being scrolled. A held card elsewhere shows it as the place to move to.
 */
function PhoneDock({ onCreate }: { onCreate: () => void }) {
  const state = board.use();
  const held = drag.use();
  const fingerDown = holding.use();
  const { project } = current(state);
  const selected = state.selection.length;
  const dragging = held?.phase === 'dragging';
  // Selecting by holding a card must not open the grid under the finger that is still down.
  const pick = selected > 0 && !dragging && !fingerDown;
  // A held card opens the grid by being brought to the dock, and closes it by leaving.
  const open = pick || (dragging && held.over);
  const send = (statusId: string) => {
    sendTasks(state.selection, statusId);
    update({ selection: [] });
  };

  if (!open && !dragging) {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-[var(--dock-bottom)] z-30 flex justify-end gap-2 px-3">
        <motion.button
          type="button"
          aria-label="Search"
          whileTap={{ scale: 0.88 }}
          transition={springs.snappy}
          className={cn(dockButton, 'glass text-foreground')}
        >
          <Search className="size-6" aria-hidden />
        </motion.button>
        <motion.button
          type="button"
          aria-label="New task"
          onClick={onCreate}
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
    );
  }

  return (
    <div
      data-drop-block=""
      className="pointer-events-none fixed inset-x-0 bottom-[var(--dock-bottom)] z-30 flex justify-center px-3"
    >
      <motion.div
        layout
        transition={springs.snappy}
        data-drop-expand=""
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
        {open ? (
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
          <motion.p
            layout="position"
            className="flex h-[var(--dock-height)] items-center justify-center gap-2 font-medium text-muted-foreground text-sm"
          >
            <ArrowRightLeft aria-hidden className="size-4" />
            Move to a status
          </motion.p>
        )}
      </motion.div>
    </div>
  );
}
