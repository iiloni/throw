import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  BoardSearch,
  BoardSearchSidebar,
  SEARCH_SIDEBAR_MIN,
  SEARCH_SPACE,
} from '@/components/BoardSearch/BoardSearch';
import { ScrollArea, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import { BoardColumn, ColumnHeader } from './BoardColumn';
import { OpenTaskPane, SelectionBar, useWidth } from './DesktopBoard';
import { drag, makingWay } from './drag';
import { PriorityIcon } from './glyphs';
import {
  CATEGORIES,
  type Category,
  categoryTarget,
  priorityName,
  projectOf,
  statusById,
} from './model';
import { CATEGORY_NAMES } from './StatusMenu';
import { StatusTile } from './StatusTile';
import {
  bandsOf,
  board,
  countIn,
  current,
  type ListId,
  listTasks,
  useBoardSettings,
  useCollapsedColumns,
} from './state';
import { TaskCard } from './TaskCard';

/** The categories a phone folds away: closed work. Desktop folds any column. */
export function foldableCategory(category: string): 'done' | 'cancelled' | null {
  return category === 'done' || category === 'cancelled' ? category : null;
}

/**
 * The cross-project board on a wide screen: Backlog, Active, Done and Cancelled side by side,
 * each banded by priority. A wide column lays each band out as a masonry grid.
 */
export function WorkspaceDesktopBoard() {
  const state = board.use();
  const { project } = current(state);
  const [frame, frameWidth] = useWidth();
  const { isCollapsed, setCollapsed } = useCollapsedColumns(project);
  const docked = frameWidth >= SEARCH_SIDEBAR_MIN;
  return (
    <div className="flex h-full overflow-hidden">
      <div ref={frame} className="flex min-w-0 flex-1">
        {docked && <BoardSearchSidebar />}
        <div className="relative flex min-w-0 flex-1">
          <ScrollArea className="min-w-0 flex-1">
            <ScrollAreaViewport
              data-autoscroll-x=""
              className="[&>div]:!flex-row [&>div]:h-full [&>div]:gap-3 [&>div]:px-6"
            >
              {CATEGORIES.map((category, index) => {
                const target = categoryTarget(category);
                return (
                  <BoardColumn
                    key={category}
                    columnId={target}
                    name={CATEGORY_NAMES[category]}
                    category={category}
                    count={countIn(state, target)}
                    collapsed={isCollapsed(target)}
                    onToggle={(value) => setCollapsed(target, value)}
                    index={index}
                    className="min-w-[18rem] max-w-[200rem] grow basis-[18rem]"
                  >
                    {() => (
                      <CategoryColumn
                        category={category}
                        onCollapse={() => setCollapsed(target, true)}
                      />
                    )}
                  </BoardColumn>
                );
              })}
            </ScrollAreaViewport>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
          {!docked && <BoardSearch />}
          <SelectionBar />
        </div>
        <OpenTaskPane frameWidth={frameWidth} />
      </div>
    </div>
  );
}

/**
 * One category across every project. Under a single held card it turns, in place, into that
 * card's own project's statuses for the category; under several, the column takes them all,
 * each to its project's default status there. Folded, its strip takes either at the default.
 */
function CategoryColumn({ category, onCollapse }: { category: Category; onCollapse: () => void }) {
  const state = board.use();
  const [settings] = useBoardSettings();
  const held = drag.use();
  const reduced = useReducedMotion();
  const { project, tasks } = current(state);
  const target = categoryTarget(category);
  const listId: ListId = target;
  const dragging = makingWay(held);
  const aimed = dragging ? held.target : null;
  const over =
    aimed?.kind === 'status' &&
    (aimed.statusId === target || statusById(project, aimed.statusId)?.category === category);
  const lead = dragging && held.ids.length === 1 ? tasks.find((t) => t.id === held.ids[0]) : null;
  const choices = lead
    ? projectOf(project, lead).statuses.filter((status) => status.category === category)
    : [];
  const count = countIn(state, target);
  const name = CATEGORY_NAMES[category];
  const bands = bandsOf(state, listTasks(state, listId));

  return (
    <section
      aria-label={name}
      data-drop-status={target}
      data-status-home={target}
      data-over={over ? '' : undefined}
      className="board-column relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl"
    >
      <ColumnHeader name={name} count={count} category={category} onCollapse={onCollapse} />
      <ScrollArea edges className="card-scroller min-h-0 flex-1 [--scrollbar-inset:0.5rem]">
        <ScrollAreaViewport data-autoscroll="">
          <div className="flex flex-col px-3.5 pt-1" style={{ paddingBottom: SEARCH_SPACE }}>
            {bands.map((band) => (
              <section
                key={band.priority ?? 'size'}
                aria-label={band.priority ? priorityName(project, band.priority) : undefined}
              >
                {band.priority !== null && (
                  <div className="zone-header" data-mode={settings.zoneLabels ? 'label' : 'hidden'}>
                    <div className="zone-header-face">
                      <span className="truncate">{priorityName(project, band.priority)}</span>
                      <PriorityIcon priority={band.priority} className="zone-chevron" />
                    </div>
                  </div>
                )}
                {/* Masonry once the column is wide enough for two cards abreast. */}
                <div className="gap-3 [column-width:16rem]">
                  {band.tasks.map((task) => (
                    <div key={task.id} data-slot={task.id} className="break-inside-avoid pb-3">
                      <TaskCard task={task} showStatus />
                    </div>
                  ))}
                </div>
              </section>
            ))}
            {bands.length === 0 && (
              <p className="px-1 py-10 text-center text-muted-foreground text-sm">
                {state.awaitingTasks ? 'Loading tasks…' : 'Nothing here.'}
              </p>
            )}
          </div>
        </ScrollAreaViewport>
        <ScrollBar />
      </ScrollArea>
      <AnimatePresence>
        {over && (
          <motion.div
            key="targets"
            className="absolute inset-0 flex flex-col gap-2.5 bg-background/70 p-3 pt-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.14 }}
          >
            <p className="px-1 font-semibold text-[0.6875rem] text-muted-foreground uppercase tracking-[0.06em]">
              {lead ? `${projectOf(project, lead).name} · ${name}` : name}
            </p>
            {lead ? (
              choices.map((status) => <StatusTile key={status.id} status={status} />)
            ) : (
              <p className="flex flex-1 items-center justify-center rounded-2xl border border-brand bg-accent px-4 text-center font-medium text-sm">
                Move {held?.ids.length} to {name.toLowerCase()}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
