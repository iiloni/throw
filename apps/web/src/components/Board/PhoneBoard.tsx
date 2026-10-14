import { ChevronDown, Plus, Search, X } from 'lucide-react';
import { motion } from 'motion/react';
import { DropdownMenu } from 'radix-ui';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { IconButton } from '@/components/IconButton/IconButton';
import { ProjectIcon } from '@/components/ProjectIcon/ProjectIcon';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { BoardSettingsPanel } from './BoardSettingsPanel';
import { CardList } from './CardList';
import { drag, holding, pageStride } from './drag';
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
    element?.scrollTo({ left: index * pageStride(element), behavior });
  }

  // The board opens on its first active column, with the backlog one page to the left.
  useLayoutEffect(() => {
    const element = pager.current;
    if (element) element.scrollLeft = pageStride(element);
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

      <div
        ref={pager}
        data-pager=""
        onScroll={(event) =>
          setPage(Math.round(event.currentTarget.scrollLeft / pageStride(event.currentTarget)))
        }
        className="phone-pager flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
      >
        <PageSpacer />
        <Page index={0} current={page} origin="backlog">
          <StatusFilter zone="backlog" anyCard className="px-[var(--gutter)]" />
          <CardList
            listId="backlog"
            showStatus={state.backlogFilter === null}
            endSpace={DOCK_SPACE}
            tight
            className="flex-1"
          />
        </Page>
        {active.map((status, index) => (
          <Page key={status.id} index={index + 1} current={page} origin="active">
            <CardList
              listId={`status:${status.id}`}
              endSpace={DOCK_SPACE}
              tight
              className="flex-1"
            />
          </Page>
        ))}
        <Page index={active.length + 1} current={page} origin="closed">
          <StatusFilter zone="closed" anyCard className="px-[var(--gutter)]" />
          <div
            className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-y-contain px-[var(--gutter)] pt-1 [scrollbar-width:none]"
            style={{ paddingBottom: DOCK_SPACE }}
          >
            {listTasks(state, 'closed').map((task) => (
              <TaskCard key={task.id} task={task} showStatus={state.closedFilter === null} />
            ))}
          </div>
        </Page>
        <PageSpacer />
      </div>

      <PhoneDock onCreate={() => createTask(active[page - 1]?.id)} />
    </div>
  );
}

/** Lets the first and last pages come to the middle of the screen like the others. */
function PageSpacer() {
  return <div aria-hidden className="w-[var(--peek)] shrink-0" />;
}

/**
 * One page of the phone board. While a card is held, the pages beside the current one show
 * as bare surfaces at the screen's edges: targets that turn the board, not their cards. One
 * the card waits at leans further in and turns into view when the wait is over.
 */
function Page({
  index,
  current,
  origin,
  children,
}: {
  index: number;
  current: number;
  origin: 'backlog' | 'active' | 'closed';
  children: ReactNode;
}) {
  const held = drag.use();
  const dragging = held?.phase === 'dragging';
  const side = dragging ? held.page : 0;
  const waiting = side !== 0 && index === current + side;
  const bare = dragging && index !== current;
  return (
    // Leaning moves an inner box: scroll snapping measures the page with its transform.
    <div
      data-page=""
      data-origin={origin}
      className="flex w-[calc(100%-2*var(--peek))] shrink-0 snap-center"
    >
      <motion.div
        className="relative flex min-w-0 flex-1 flex-col"
        initial={false}
        animate={{ x: waiting ? -side * 16 : 0 }}
        transition={springs.snappy}
      >
        <motion.div
          className="flex min-h-0 flex-1 flex-col"
          initial={false}
          animate={{ opacity: bare ? 0 : 1 }}
          transition={{ duration: 0.15 }}
        >
          {children}
        </motion.div>
        <motion.div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-0 top-1 bottom-[calc(var(--safe-bottom)+4.5rem)] rounded-3xl transition-colors',
            waiting ? 'bg-brand/20' : 'bg-foreground/[0.06]',
          )}
          initial={false}
          animate={{ opacity: bare ? 1 : 0 }}
          transition={{ duration: 0.15 }}
        />
      </motion.div>
    </div>
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

const dockButton =
  'pointer-events-auto relative flex size-[var(--dock-height)] items-center justify-center rounded-[var(--dock-radius)] outline-none focus-visible:ring-2 focus-visible:ring-ring/70';

/**
 * The dock: search and the create button, as in Catch. While a card is held it gives way to
 * a drawer at the bottom edge, which opens into a grid of every status when the card is
 * brought onto it, so a card reaches any status without the board being scrolled. Selected
 * cards open it too.
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
    <div data-drop-block="" className="pointer-events-none fixed inset-x-0 bottom-0 z-30">
      {/* A drawer at the screen's edge, not a bar over the list: the list scrolls under a held
          card until the card is brought down onto it. */}
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
