import { compareStatuses, PRIORITIES, type Status, type Task } from '@throw/shared';
import { ChevronDown, Flag, MoreHorizontal } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { PriorityGlyph, StatusGlyph } from '@/components/Board/glyphs';
import { priorityName } from '@/components/Board/model';
import { board, current } from '@/components/Board/state';
import { TrayGrip, traySurface } from '@/components/Board/TraySurface';
import { IconButton } from '@/components/IconButton/IconButton';
import { ScrollArea, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import { useBackHandler } from '@/lib/backButton';
import { springs } from '@/lib/motion';
import { sendTask, updateTask } from '@/lib/tasks';
import { cn } from '@/lib/utils';
import { TaskActions } from './TaskActions';

type Panel = 'status' | 'priority' | 'more';

export function TaskDrawer({ task, statuses }: { task: Task; statuses: Status[] }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const more = useRef<HTMLButtonElement>(null);
  const id = useId();
  const reduced = useReducedMotion();
  const project = current(board.use()).project;
  const status = statuses.find((row) => row.id === task.statusId);
  const collapse = useCallback(() => {
    setPanel(null);
    trigger.current?.focus({ preventScroll: true });
  }, []);
  useBackHandler(panel !== null, collapse);
  useEffect(() => {
    if (!panel) return;
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || document.querySelector('[role="dialog"][aria-labelledby]'))
        return;
      event.preventDefault();
      event.stopPropagation();
      collapse();
    }
    function outside(event: PointerEvent) {
      if (
        !root.current?.contains(event.target as Node) &&
        !document.querySelector('[role="dialog"][aria-labelledby]')
      )
        setPanel(null);
    }
    document.addEventListener('keydown', dismissOnEscape, true);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      document.removeEventListener('keydown', dismissOnEscape, true);
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [panel, collapse]);
  function toggle(next: Panel, element: HTMLButtonElement) {
    trigger.current = element;
    setPanel(panel === next ? null : next);
  }
  const label = panel === 'status' ? 'Status' : panel === 'priority' ? 'Priority' : 'More';
  const control =
    'h-[var(--dock-height)] flex-1 rounded-[var(--dock-radius)] bg-foreground/[0.06] [&_svg]:size-6';
  return (
    <div
      ref={root}
      data-task-drawer=""
      className={cn(
        traySurface,
        'z-10 shrink-0 overflow-hidden pb-[max(var(--safe-bottom),0.5rem)]',
      )}
    >
      <motion.div
        onPanEnd={(_, info) => {
          if (info.offset.y > 35 || info.velocity.y > 300) collapse();
          else if (info.offset.y < -25) setPanel(panel ?? 'status');
        }}
        role="toolbar"
        aria-label="Task controls"
        className="flex touch-none flex-col px-3 pt-2 pb-2"
      >
        <TrayGrip className="mb-2" />
        <div className="flex h-[var(--dock-height)] w-full items-center justify-around gap-2">
          <IconButton
            label={`Status: ${status?.name ?? 'Pending'}. Change`}
            className={control}
            aria-expanded={panel === 'status'}
            aria-controls={`${id}-status`}
            onClick={(event) => toggle('status', event.currentTarget)}
          >
            <StatusGlyph category={status?.category ?? 'backlog'} />
          </IconButton>
          <IconButton
            label={`Priority: ${priorityName(project, task.priority)}. Change`}
            className={control}
            aria-expanded={panel === 'priority'}
            aria-controls={`${id}-priority`}
            onClick={(event) => toggle('priority', event.currentTarget)}
          >
            {task.priority === 3 ? (
              <Flag />
            ) : (
              <PriorityGlyph priority={task.priority} name={priorityName(project, task.priority)} />
            )}
          </IconButton>
          {/* Tags: mount the Tags control and its panel here when PR #8 lands on main. */}
          <IconButton
            ref={more}
            label="More task actions"
            className={control}
            aria-expanded={panel === 'more'}
            aria-controls={`${id}-more`}
            onClick={(event) => toggle('more', event.currentTarget)}
          >
            <MoreHorizontal />
          </IconButton>
        </div>
      </motion.div>
      <AnimatePresence initial={false}>
        {panel && (
          <motion.div
            key={panel}
            id={`${id}-${panel}`}
            role="region"
            aria-label={label}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: panel === 'more' ? 176 : 304, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduced ? { duration: 0 } : springs.smooth}
            className="flex max-h-[min(50dvh,24rem)] flex-col overflow-hidden border-border border-t"
          >
            <div className="flex h-11 shrink-0 items-center justify-between px-5">
              <h2 className="font-semibold text-sm">{label}</h2>
              <IconButton label="Collapse task drawer" onClick={collapse}>
                <ChevronDown />
              </IconButton>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <ScrollAreaViewport>
                {panel === 'status' && (
                  <div role="radiogroup" aria-label="Status" className="px-3 pb-3">
                    {(['backlog', 'active', 'done', 'cancelled'] as const).map((category) => (
                      <div key={category}>
                        <p className="px-3 pt-3 pb-1 text-muted-foreground text-xs">
                          {
                            {
                              backlog: 'Backlog',
                              active: 'Active',
                              done: 'Done',
                              cancelled: 'Cancelled',
                            }[category]
                          }
                        </p>
                        {statuses
                          .filter((row) => row.category === category)
                          .sort(compareStatuses)
                          .map((row) => (
                            <label
                              key={row.id}
                              className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm hover:bg-foreground/[0.06] has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/60"
                            >
                              <input
                                className="order-last size-4 shrink-0 accent-brand"
                                type="radio"
                                name={`${id}-status`}
                                checked={task.statusId === row.id}
                                onChange={() => {
                                  sendTask(task.id, row.id);
                                  collapse();
                                }}
                              />
                              <StatusGlyph category={row.category} />
                              <span className="flex-1">{row.name}</span>
                            </label>
                          ))}
                      </div>
                    ))}
                  </div>
                )}
                {panel === 'priority' && (
                  <div role="radiogroup" aria-label="Priority" className="px-3 pb-3">
                    {PRIORITIES.map((priority) => (
                      <label
                        key={priority}
                        className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm hover:bg-foreground/[0.06] has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/60"
                      >
                        <input
                          className="order-last size-4 shrink-0 accent-brand"
                          aria-label={priorityName(project, priority)}
                          type="radio"
                          name={`${id}-priority`}
                          checked={task.priority === priority}
                          onChange={() => {
                            updateTask(task.id, { priority });
                            collapse();
                          }}
                        />
                        <PriorityGlyph priority={priority} name={priorityName(project, priority)} />
                        <span className="flex-1">{priorityName(project, priority)}</span>
                      </label>
                    ))}
                  </div>
                )}
                {panel === 'more' && (
                  <TaskActions task={task} statuses={statuses} returnFocus={more} />
                )}
              </ScrollAreaViewport>
              <ScrollBar />
            </ScrollArea>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
