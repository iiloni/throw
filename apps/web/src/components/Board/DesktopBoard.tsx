import { ListTree, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { IconButton } from '@/components/IconButton/IconButton';
import { ProjectIcon } from '@/components/ProjectIcon/ProjectIcon';
import { Button } from '@/components/ui/button';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { CardList } from './CardList';
import { drag } from './drag';
import { PrototypePanel } from './PrototypePanel';
import { SideZone, STRIP_WIDTH } from './SideZone';
import { StatusMenu } from './StatusMenu';
import { StatusTile } from './StatusTile';
import { board, countIn, current, selectProject, sendTasks, update } from './state';
import { PANE_MIN, SplitHandle, TaskPane } from './TaskView';

const TILES_WIDTH = 176;
const HANDLE_WIDTH = 24;
/** Between the three zones. Columns sit a little closer to each other than zones do. */
const ZONE_GAP = 16;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * The board on a wide screen: backlog, active columns and the closed zone in a row, with an
 * open task taking width from all three.
 */
export function DesktopBoard() {
  const state = board.use();
  const held = drag.use();
  const { project, tasks } = current(state);
  const [frame, frameWidth] = useWidth();
  const [row, rowWidth] = useWidth();
  const [paneWidth, setPaneWidth] = useState(440);
  const [resizing, setResizing] = useState(false);
  const active = project.statuses.filter((status) => status.category === 'active');
  const openTask = tasks.find((task) => task.id === state.openTaskId);
  const dragging = held?.phase === 'dragging';
  // A gallery covers the columns. A held card still needs somewhere to go, so they come
  // back as dropzones for as long as it is held.
  const covered = state.backlog === 'full' || state.closed === 'full';
  const fullWidth = Math.max(
    0,
    rowWidth - STRIP_WIDTH - ZONE_GAP * 2 - (dragging ? TILES_WIDTH : 0),
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Stands where the navigation rail will be. */}
      <nav
        aria-label="Projects"
        className="flex w-[4.5rem] shrink-0 flex-col items-center gap-2 pt-[calc(var(--safe-top)+1.5rem)] pb-5"
      >
        {state.boards.map(({ project: item }) => (
          <button
            key={item.id}
            type="button"
            data-color={item.color}
            aria-label={item.name}
            aria-current={item.id === project.id ? 'page' : undefined}
            title={item.name}
            onClick={() => selectProject(item.id)}
            className={cn(
              'flex size-11 items-center justify-center rounded-2xl outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/60',
              item.id === project.id
                ? 'bg-tint text-foreground'
                : 'text-muted-foreground hover:bg-foreground/[0.06]',
            )}
          >
            <ProjectIcon name={item.icon} className="size-5" />
          </button>
        ))}
        <span className="flex-1" />
        <PrototypePanel />
      </nav>

      <div ref={frame} className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[5.5rem] shrink-0 items-center gap-3 pr-6 pl-2">
          <h1 className="font-display font-extrabold text-[2.25rem] leading-none tracking-[-0.03em]">
            {project.name}
          </h1>
          <span className="flex-1" />
          <IconButton
            label={
              state.subtasksAsCards ? 'Keep subtasks with their parent' : 'Show subtasks as cards'
            }
            aria-pressed={state.subtasksAsCards}
            onClick={() => update({ subtasksAsCards: !state.subtasksAsCards })}
            className={cn('size-10', state.subtasksAsCards && 'bg-accent')}
          >
            <ListTree />
          </IconButton>
        </header>

        <div className="flex min-h-0 flex-1 pr-6 pb-6">
          <div ref={row} className="flex min-w-0 flex-1" style={{ gap: ZONE_GAP }}>
            <SideZone zone="backlog" fullWidth={fullWidth} />
            <div
              data-origin="active"
              data-autoscroll-x=""
              className={cn(
                'flex min-w-0 flex-1 gap-3',
                covered ? 'overflow-hidden' : 'overflow-x-auto overflow-y-hidden',
              )}
            >
              {covered
                ? dragging && (
                    <motion.div
                      className="flex shrink-0 flex-col gap-2.5 p-1"
                      style={{ width: TILES_WIDTH }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      <p className="px-1 pt-1 font-semibold text-[0.6875rem] text-muted-foreground uppercase tracking-[0.06em]">
                        Active
                      </p>
                      {active.map((status) => (
                        <StatusTile key={status.id} status={status} />
                      ))}
                    </motion.div>
                  )
                : active.map((status) => (
                    <CardList
                      key={status.id}
                      listId={`status:${status.id}`}
                      surface
                      className="min-w-[17.5rem] max-w-[27rem] flex-1 pb-2"
                      header={
                        <div className="flex h-14 shrink-0 items-center gap-2.5 px-5">
                          <h2 className="truncate font-display font-semibold text-lg tracking-[-0.01em]">
                            {status.name}
                          </h2>
                          <span className="rounded-full bg-foreground/[0.07] px-2 py-0.5 text-muted-foreground text-xs tabular-nums">
                            {countIn(state, status.id)}
                          </span>
                        </div>
                      }
                    />
                  ))}
            </div>
            <SideZone zone="closed" fullWidth={fullWidth} />
          </div>

          <AnimatePresence initial={false}>
            {openTask && (
              <motion.div
                key="pane"
                className="flex shrink-0 overflow-hidden"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: paneWidth + HANDLE_WIDTH, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={resizing ? { duration: 0 } : springs.smooth}
              >
                <SplitHandle
                  width={paneWidth}
                  max={Math.max(PANE_MIN, frameWidth * 0.62)}
                  onResize={setPaneWidth}
                  onActive={setResizing}
                />
                <div className="min-w-0 flex-1" style={{ width: paneWidth }}>
                  <TaskPane task={openTask} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {state.selection.length > 0 && !dragging && (
          <motion.div
            className="glass-thick -translate-x-1/2 fixed bottom-5 left-1/2 z-30 flex h-12 items-center gap-1 rounded-2xl pr-1.5 pl-4"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={springs.snappy}
          >
            <span className="pr-2 font-medium text-sm tabular-nums">
              {state.selection.length} selected
            </span>
            <StatusMenu
              project={project}
              onSelect={(statusId) => {
                sendTasks(state.selection, statusId);
                update({ selection: [] });
              }}
            >
              <Button size="sm" className="rounded-xl">
                Move to
              </Button>
            </StatusMenu>
            <IconButton label="Clear selection" onClick={() => update({ selection: [] })}>
              <X />
            </IconButton>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
