import { X } from 'lucide-react';
import { motion, useDragControls, useReducedMotion } from 'motion/react';
import { type PointerEvent, useRef, useState } from 'react';
import { IconButton } from '@/components/IconButton/IconButton';
import { ScrollArea, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { PriorityGlyph, StatusGlyph } from './glyphs';
import { identifier, priorityName, statusById, subtasksOf, type Task, taskColor } from './model';
import { StatusMenu } from './StatusMenu';
import { board, current, sendTasks, update } from './state';

const chip =
  'flex h-8 items-center gap-1.5 rounded-full bg-foreground/[0.07] px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60';

/** A stand-in for the task view: enough of a task to judge how the board makes room for it. */
function TaskBody({ task }: { task: Task }) {
  const { project, tasks } = current(board.use());
  const status = statusById(project, task.statusId);
  const parent = tasks.find((item) => item.id === task.parentId);
  const subtasks = subtasksOf(tasks, task.id);
  const tags = [task.primaryTagId, ...task.secondaryTagIds]
    .map((id) => project.tags.find((tag) => tag.id === id))
    .filter((tag) => tag !== undefined);
  return (
    <ScrollArea className="flex-1 [--scrollbar-inset:1rem]">
      <ScrollAreaViewport>
        <div className="px-8 pb-12">
          {parent && (
            <button
              type="button"
              onClick={() => update({ openTaskId: parent.id })}
              className="mb-1 max-w-full truncate rounded text-foreground/60 text-sm underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/60"
            >
              {identifier(project, parent)} {parent.title}
            </button>
          )}
          <h2 className="font-display font-semibold text-[1.75rem] leading-[1.15] tracking-[-0.02em] [overflow-wrap:anywhere]">
            {task.title}
          </h2>
          <div className="mt-5 flex flex-wrap gap-2">
            {status && (
              <StatusMenu
                project={project}
                value={status.id}
                onSelect={(statusId) => sendTasks([task.id], statusId)}
              >
                <button type="button" className={cn(chip, 'hover:bg-foreground/[0.12]')}>
                  <StatusGlyph category={status.category} />
                  {status.name}
                </button>
              </StatusMenu>
            )}
            <span className={chip}>
              <PriorityGlyph priority={task.priority} name={priorityName(project, task.priority)} />
              {priorityName(project, task.priority)}
            </span>
            {tags.map((tag) => (
              <span key={tag.id} className={chip}>
                {tag.name}
              </span>
            ))}
          </div>
          <p className="mt-8 max-w-prose text-[0.9375rem] text-foreground/85 leading-relaxed">
            {task.description ??
              'The description is written here, in the same editor as a Catch note. This pane is a placeholder: the prototype is about how the board gives it room.'}
          </p>
          {subtasks.length > 0 && (
            <>
              <h3 className="mt-8 mb-2 font-semibold text-foreground/60 text-xs uppercase tracking-[0.06em]">
                Subtasks
              </h3>
              <ul>
                {subtasks.map((subtask) => {
                  const subtaskStatus = statusById(project, subtask.statusId);
                  return (
                    <li key={subtask.id}>
                      <button
                        type="button"
                        onClick={() => update({ openTaskId: subtask.id })}
                        className="flex min-h-10 w-full items-center gap-2.5 rounded-xl px-2 text-left text-sm outline-none hover:bg-foreground/[0.06] focus-visible:ring-[3px] focus-visible:ring-ring/60"
                      >
                        {subtaskStatus && <StatusGlyph category={subtaskStatus.category} />}
                        <span className="min-w-0 flex-1 truncate">{subtask.title}</span>
                        <span className="text-foreground/50 text-xs">{subtaskStatus?.name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <h3 className="mt-8 mb-2 font-semibold text-foreground/60 text-xs uppercase tracking-[0.06em]">
            Activity
          </h3>
          <ol className="space-y-2 text-foreground/70 text-sm">
            <li>Moved to {status?.name} · 2 days ago</li>
            <li>Priority set to {priorityName(project, task.priority)} · 4 days ago</li>
            <li>Created · last week</li>
          </ol>
        </div>
      </ScrollAreaViewport>
      <ScrollBar />
    </ScrollArea>
  );
}

function TaskHeader({ task }: { task: Task }) {
  const { project } = current(board.use());
  return (
    <div className="flex h-14 shrink-0 items-center justify-between pr-4 pl-8">
      <span className="font-medium text-foreground/60 text-sm tabular-nums">
        {identifier(project, task)}
      </span>
      <IconButton label="Close task" onClick={() => update({ openTaskId: null })}>
        <X />
      </IconButton>
    </div>
  );
}

export const PANE_MIN = 340;

/** Wide screens: the task beside the board, on the card's own color. */
export function TaskPane({ task }: { task: Task }) {
  const { project } = current(board.use());
  return (
    <motion.section
      aria-label="Task"
      data-color={taskColor(project, task) ?? undefined}
      className="flex h-full min-w-0 flex-col rounded-3xl bg-[var(--tint,var(--card))] shadow-[0_1px_2px_oklch(0_0_0/0.06)]"
      style={{ minWidth: PANE_MIN }}
    >
      <TaskHeader task={task} />
      <TaskBody key={task.id} task={task} />
    </motion.section>
  );
}

/** The grip between the board and an open task. Drag it, or use the arrow keys, to resize both. */
export function SplitHandle({
  width,
  max,
  onResize,
  onActive,
}: {
  width: number;
  max: number;
  onResize: (width: number) => void;
  /** Told while the grip is held, so the pane can follow the pointer without easing. */
  onActive: (active: boolean) => void;
}) {
  const [dragging, setDraggingState] = useState(false);
  const setDragging = (value: boolean) => {
    setDraggingState(value);
    onActive(value);
  };
  const start = useRef<{ x: number; width: number } | null>(null);
  const resize = (next: number) => onResize(Math.min(max, Math.max(PANE_MIN, next)));

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, width };
    setDragging(true);
  }
  function end() {
    start.current = null;
    setDragging(false);
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be focused or dragged.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize task"
      aria-valuemin={PANE_MIN}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={(event) => {
        if (start.current) resize(start.current.width + start.current.x - event.clientX);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 128 : 32;
        if (event.key === 'ArrowLeft') resize(width + step);
        else if (event.key === 'ArrowRight') resize(width - step);
        else return;
        event.preventDefault();
      }}
      className="group flex w-6 shrink-0 cursor-col-resize touch-none select-none items-center justify-center outline-none"
    >
      <motion.span
        aria-hidden
        className={cn(
          'w-1.5 rounded-full transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ring/70',
          dragging ? 'bg-brand' : 'bg-foreground/25 group-hover:bg-foreground/40',
        )}
        initial={false}
        animate={{ height: dragging ? 72 : 48 }}
        transition={springs.snappy}
      />
    </div>
  );
}

/** Small screens: the task rises over the board and is pulled down to dismiss. */
export function TaskSheet({ task }: { task: Task }) {
  const { project } = current(board.use());
  const controls = useDragControls();
  const reduced = useReducedMotion();
  return (
    <>
      <motion.div
        aria-hidden
        className="fixed inset-0 z-40 bg-black/30"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => update({ openTaskId: null })}
      />
      <motion.section
        aria-label="Task"
        data-drop-block=""
        data-color={taskColor(project, task) ?? undefined}
        className="fixed inset-x-0 top-[calc(var(--safe-top)+0.75rem)] bottom-0 z-40 flex flex-col rounded-t-[28px] bg-[var(--tint,var(--card))] shadow-2xl"
        initial={{ y: reduced ? 0 : '100%', opacity: reduced ? 0 : 1 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: reduced ? 0 : '100%', opacity: reduced ? 0 : 1 }}
        transition={springs.smooth}
        drag="y"
        dragControls={controls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.7 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 120 || info.velocity.y > 500) update({ openTaskId: null });
        }}
      >
        <div
          aria-hidden
          className="flex touch-none justify-center pt-2.5"
          onPointerDown={(event) => controls.start(event)}
        >
          <span className="h-1 w-9 rounded-full bg-foreground/25" />
        </div>
        <TaskHeader task={task} />
        <TaskBody key={task.id} task={task} />
      </motion.section>
    </>
  );
}
