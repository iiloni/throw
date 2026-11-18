import { ChevronDown, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { type ReactNode, useContext, useLayoutEffect, useRef, useState } from 'react';
import { Drawer, type DrawerPage } from '@/components/Drawer/Drawer';
import { IconButton } from '@/components/IconButton/IconButton';
import { useBackHandler } from '@/lib/backButton';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { BoardSettingsContent } from './BoardSettingsPanel';
import { drag, holding, pageStride } from './drag';
import { CATEGORIES, type Category, categoryTarget, groupByPriority, priorityName } from './model';
import {
  DOCK_SPACE,
  DockFace,
  dockButton,
  FlowTrack,
  MovePanel,
  PeekEdge,
  pageClass,
} from './PhoneBoard';
import { CATEGORY_NAMES } from './StatusMenu';
import { board, countIn, current, listTasks, update } from './state';
import { TaskCard } from './TaskCard';
import { TaskContentContext } from './taskContent';
import { useTaskSurfaceShown } from './taskTransition';
import { useFoldedColumns } from './WorkspaceDesktopBoard';

const COLUMNS = CATEGORIES.map((category) => ({
  id: categoryTarget(category),
  name: CATEGORY_NAMES[category],
  category,
  isDefault: true,
}));
/** The board opens on the work in progress. */
const FIRST_PAGE = 1;

/**
 * The cross-project board on a phone: one category a page, in the order work moves, with the
 * flow track under the title. A card is moved as on a project board: held and carried to the
 * edge to turn the page, or onto the move drawer for its project's statuses. Search and
 * capture cover every project, from the dock.
 */
export function WorkspacePhoneBoard({
  title,
  syncIndicator,
  onSearch,
  onCreate,
}: {
  title: ReactNode;
  syncIndicator?: ReactNode;
  onSearch: () => void;
  onCreate: () => void;
}) {
  const state = board.use();
  const held = drag.use();
  const fingerDown = holding.use();
  const reduced = useReducedMotion();
  const pager = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(FIRST_PAGE);
  const [settings, setSettings] = useState(false);
  const task = useContext(TaskContentContext)?.drawer;
  const raised = useTaskSurfaceShown();
  const dragging = held?.phase === 'dragging';
  const pick = state.selection.length > 0 && !dragging && !fingerDown;
  const covered = settings || state.openTaskId !== null;
  useBackHandler(state.selection.length > 0, () => update({ selection: [] }));

  useLayoutEffect(() => {
    const element = pager.current;
    if (element) element.scrollLeft = FIRST_PAGE * pageStride(element);
  }, []);

  function turnTo(index: number) {
    const element = pager.current;
    element?.scrollTo({
      left: index * pageStride(element),
      behavior: reduced ? 'instant' : 'smooth',
    });
  }

  const settingsPage: DrawerPage = {
    key: 'settings',
    title: 'Board settings',
    content: (
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(var(--safe-bottom)+1.5rem)]">
        <BoardSettingsContent />
      </div>
    ),
  };

  const dock = (
    <div className="flex items-center gap-2">
      <motion.button
        type="button"
        onClick={onSearch}
        whileTap={{ scale: 0.97 }}
        transition={springs.snappy}
        className="flex h-[var(--dock-height)] min-w-0 flex-1 items-center gap-3 rounded-[var(--dock-radius)] bg-foreground/[0.06] px-4 text-left text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
      >
        <Search aria-hidden className="size-5 shrink-0" />
        <span className="truncate">Search all projects</span>
      </motion.button>
      <motion.button
        type="button"
        aria-label="New task"
        onClick={onCreate}
        whileTap={{ scale: 0.88 }}
        transition={springs.snappy}
        className={cn(
          dockButton,
          'bg-brand text-brand-foreground shadow-[0_2px_6px_-2px_color-mix(in_oklab,var(--brand)_45%,transparent),inset_0_1px_0_rgb(255_255_255/0.35)]',
        )}
      >
        <Plus className="size-7" strokeWidth={2.25} aria-hidden />
      </motion.button>
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 pt-[var(--safe-top)]" inert={covered}>
        <div className="flex h-16 items-center gap-2 pr-3 pl-5">
          {title}
          <span className="flex-1" />
          <IconButton label="Board settings" className="size-10" onClick={() => setSettings(true)}>
            <SlidersHorizontal />
          </IconButton>
        </div>
        {syncIndicator && (
          <div className="px-5 text-muted-foreground empty:hidden">{syncIndicator}</div>
        )}
        <FlowTrack statuses={COLUMNS} page={page} onTurn={turnTo} />
      </header>

      <div className="relative flex min-h-0 flex-1" inert={covered}>
        <div
          ref={pager}
          data-pager=""
          data-selecting={state.selection.length > 0 ? '' : undefined}
          onScroll={(event) =>
            setPage(Math.round(event.currentTarget.scrollLeft / pageStride(event.currentTarget)))
          }
          className="phone-pager flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
        >
          {CATEGORIES.map((category) => (
            <div key={category} data-page="" data-origin={category} className={pageClass}>
              <CategoryPage category={category} />
            </div>
          ))}
        </div>
        <PeekEdge side={-1} shown={page > 0} />
        <PeekEdge side={1} shown={page < CATEGORIES.length - 1} />
      </div>

      <Drawer
        label={task ? 'Task drawer' : 'Board drawer'}
        origin="board"
        dock={
          <AnimatePresence initial={false}>
            <DockFace key={task ? 'task' : 'board'}>{task ? task.dock : dock}</DockFace>
          </AnimatePresence>
        }
        detent="closed"
        detents={['closed']}
        onDetent={() => {}}
        move={!task && (dragging || pick) ? <MovePanel pick={pick} /> : null}
        gesturesDisabled={held !== null || fingerDown || (!!task && !task.page)}
        page={task ? task.page : settings ? settingsPage : null}
        onClosePage={task ? task.closePage : () => setSettings(false)}
        raised={!!task || raised}
      >
        {null}
      </Drawer>
    </div>
  );
}

/**
 * A category's cards from every project, banded by priority. The page itself takes a card
 * carried onto it, sending it to its project's default status for the category.
 */
function CategoryPage({ category }: { category: Category }) {
  const state = board.use();
  const held = drag.use();
  const { project } = current(state);
  const [folded, setFolded] = useFoldedColumns();
  const target = categoryTarget(category);
  const name = CATEGORY_NAMES[category];
  const bands = groupByPriority(listTasks(state, target)).filter((band) => band.tasks.length > 0);
  const over = held?.phase === 'dragging' && held.target?.kind === 'status';
  const aimed = over && held.target?.kind === 'status' && held.target.statusId === target;
  // Cancelled work is folded until asked for, as it is on desktop.
  const hidden = category === 'cancelled' && folded.cancelled;
  const open = category === 'backlog' || category === 'active';
  return (
    <section
      aria-label={name}
      data-drop-status={target}
      data-status-home={target}
      data-swipe-close={open ? '' : undefined}
      className={cn(
        'board-column flex min-h-0 flex-1 flex-col rounded-3xl',
        aimed && held?.origin !== category && 'bg-accent/60',
      )}
    >
      <div
        data-autoscroll=""
        className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-[var(--gutter)] pt-1 [scrollbar-width:none]"
        style={{ paddingBottom: DOCK_SPACE }}
      >
        {hidden ? (
          <button
            type="button"
            onClick={() => setFolded({ ...folded, cancelled: false })}
            className="mt-6 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-foreground/[0.06] px-4 text-muted-foreground text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
          >
            Show {countIn(state, target)} cancelled
            <ChevronDown aria-hidden className="size-4" />
          </button>
        ) : (
          bands.map((band) => (
            <section key={band.priority} aria-label={priorityName(project, band.priority)}>
              <div className="zone-header" data-mode="label">
                <div className="zone-header-face">
                  <span className="truncate">{priorityName(project, band.priority)}</span>
                </div>
              </div>
              {band.tasks.map((task) => (
                <div key={task.id} data-slot={task.id} className="pb-3">
                  <TaskCard task={task} showStatus />
                </div>
              ))}
            </section>
          ))
        )}
        {!hidden && bands.length === 0 && (
          <p className="px-1 py-10 text-center text-muted-foreground text-sm">
            {state.awaitingTasks ? 'Loading tasks…' : 'Nothing here.'}
          </p>
        )}
      </div>
    </section>
  );
}
