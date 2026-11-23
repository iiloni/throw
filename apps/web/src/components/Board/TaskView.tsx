import { ArrowLeft, X } from 'lucide-react';
import {
  AnimatePresence,
  motion,
  useDragControls,
  useIsPresent,
  useReducedMotion,
} from 'motion/react';
import { Dialog } from 'radix-ui';
import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { IconButton } from '@/components/IconButton/IconButton';
import { ScrollArea, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import { useBackHandler } from '@/lib/backButton';
import { curves, EASE_EMPHASIZED, springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { PriorityGlyph, StatusGlyph } from './glyphs';
import { identifier, priorityName, statusById, subtasksOf, type Task, taskColor } from './model';
import { StatusMenu } from './StatusMenu';
import { board, current, renameTask, sendTasks, update } from './state';
import { TaskScreenSurface } from './TaskScreenSurface';
import { TaskContentContext } from './taskContent';

const chip =
  'flex h-8 items-center gap-1.5 rounded-full bg-foreground/[0.07] px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60';

/** The title, written in place. A task just created starts here with its title selected. */
export function TaskTitle({ task }: { task: Task }) {
  const fresh = board.use().newTaskId === task.id;
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (document.activeElement !== element) element.value = task.title;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
    if (fresh) {
      element.focus();
      element.select();
      update({ newTaskId: null });
    }
  }, [fresh, task.title]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let width = 0;
    const observer = new ResizeObserver(([entry]) => {
      if (entry!.contentRect.width === width) return;
      width = entry!.contentRect.width;
      element.style.height = 'auto';
      element.style.height = `${element.scrollHeight}px`;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <textarea
      ref={ref}
      aria-label="Task title"
      rows={1}
      maxLength={500}
      onInput={(event) => {
        const element = event.currentTarget;
        element.style.height = 'auto';
        element.style.height = `${element.scrollHeight}px`;
      }}
      defaultValue={task.title}
      placeholder="Untitled task"
      onBlur={(event) => {
        const title = event.currentTarget.value.trim();
        if (title !== task.title) renameTask(task.id, title);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.currentTarget.blur();
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      className="w-full resize-none rounded-lg bg-transparent font-display font-semibold text-[1.75rem] leading-[1.15] tracking-[-0.02em] outline-none [field-sizing:content] focus-visible:ring-[3px] focus-visible:ring-ring/40"
    />
  );
}

/** A stand-in for the task view: enough of a task to judge how the board makes room for it. */
function TaskBody({ task, underDock = false }: { task: Task; underDock?: boolean }) {
  const state = board.use();
  const { project, tasks } = current(state);
  const status = statusById(project, task.statusId);
  const parent = tasks.find((item) => item.id === task.parentId);
  const subtasks = subtasksOf(tasks, task.id);
  const tags = [task.primaryTagId, ...task.secondaryTagIds]
    .map((id) => project.tags.find((tag) => tag.id === id))
    .filter((tag) => tag !== undefined);
  return (
    <ScrollArea className="flex-1 [--scrollbar-inset:1rem]">
      <ScrollAreaViewport>
        <div
          className={cn(
            'px-8',
            underDock ? 'pb-[calc(var(--dock-height)+var(--dock-bottom)+2.5rem)]' : 'pb-12',
          )}
        >
          {parent && (
            <button
              type="button"
              onClick={() => update({ openTaskId: parent.id })}
              className="mb-1 max-w-full truncate rounded text-foreground/60 text-sm underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/60"
            >
              {identifier(project, parent)} {parent.title}
            </button>
          )}
          <TaskTitle task={task} />
          {state.actions ? (
            <p className="mt-8 text-muted-foreground text-sm">Task details are coming next.</p>
          ) : (
            <>
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
                  <PriorityGlyph
                    priority={task.priority}
                    name={priorityName(project, task.priority)}
                  />
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
                            <span className="text-foreground/50 text-xs">
                              {subtaskStatus?.name}
                            </span>
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
            </>
          )}
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
        {identifier(project, task) ?? 'Pending'}
      </span>
      <div className="flex items-center gap-1">
        <IconButton label="Close task" onClick={() => update({ openTaskId: null })}>
          <X />
        </IconButton>
      </div>
    </div>
  );
}

export const PANE_MIN = 340;

/** The open task's card beside the board, between its toolbars and dock. */
export const cardSurface =
  'overflow-hidden rounded-3xl bg-[var(--tint,var(--card))] shadow-[0_1px_2px_oklch(0_0_0/0.06),0_12px_32px_-16px_oklch(0_0_0/0.18)]';

/**
 * Wide screens: the task beside the board, as a card on its own color between its toolbars
 * and its dock (Catch's split view).
 */
export function TaskPane({ task }: { task: Task }) {
  const present = useIsPresent();
  const content = useContext(TaskContentContext);
  useBackHandler(true, () => update({ openTaskId: null }));
  const { project } = current(board.use());
  const reduced = useReducedMotion();
  // Into a subtask the pane pushes it in over its parent; back out, it pops it off again.
  const shown = useRef(task);
  const [step, setStep] = useState<{ id: string; direction: PaneStep }>({
    id: task.id,
    direction: 0,
  });
  if (step.id !== task.id) {
    const from = shown.current;
    setStep({
      id: task.id,
      direction: task.parentId === from.id ? 1 : from.parentId === task.id ? -1 : 0,
    });
  }
  useEffect(() => {
    shown.current = task;
  });
  const direction = reduced ? 0 : step.direction;
  return (
    <motion.section
      aria-label="Task"
      inert={!present}
      data-color={taskColor(project, task) ?? undefined}
      className={cn(
        'h-full min-w-0',
        // The real task draws its own card between its toolbars and dock, and its pages stack
        // in one cell while one replaces another.
        content
          ? 'grid grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]'
          : cn('flex flex-col', cardSurface),
      )}
      style={{ minWidth: PANE_MIN }}
    >
      {content ? (
        <AnimatePresence initial={false} custom={direction}>
          <PaneStepLayer key={task.id} direction={direction} panePresent={present}>
            {content.body(task.id)}
          </PaneStepLayer>
        </AnimatePresence>
      ) : (
        <>
          <TaskHeader task={task} />
          <TaskBody key={task.id} task={task} />
        </>
      )}
    </motion.section>
  );
}

/** Into a subtask (1), back out to its parent (-1), or to another task (0). */
type PaneStep = 1 | -1 | 0;

/** How far a task travels as it is pushed or popped beside the board, and its parent. */
const PUSH = 56;
const RECEDE = 24;
const paneStep = {
  enter: (direction: PaneStep) =>
    direction === 0
      ? { opacity: 0, x: 0, y: 12, zIndex: 1 }
      : { opacity: 0, x: direction > 0 ? PUSH : -RECEDE, y: 0, zIndex: direction > 0 ? 1 : 0 },
  shown: {
    opacity: 1,
    x: 0,
    y: 0,
    transition: { duration: curves.enter.duration, ease: EASE_EMPHASIZED },
  },
  leave: (direction: PaneStep) =>
    direction === 0
      ? { opacity: 0, transition: { duration: 0 } }
      : {
          opacity: 0,
          x: direction > 0 ? -RECEDE : PUSH,
          zIndex: direction > 0 ? 0 : 1,
          transition: { duration: curves.collapse.duration * 0.7, ease: EASE_EMPHASIZED },
        },
};

/** One task's page in the pane; a leaving page is out of reach and keeps its last view while it goes. */
function PaneStepLayer({
  direction,
  panePresent,
  children,
}: {
  direction: PaneStep;
  panePresent: boolean;
  children: ReactNode;
}) {
  const present = useIsPresent();
  const last = useRef(children);
  if (present && panePresent && children) last.current = children;
  return (
    <motion.div
      className="col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col"
      custom={direction}
      variants={paneStep}
      initial="enter"
      animate="shown"
      exit="leave"
      inert={!present}
      aria-hidden={!present || undefined}
    >
      {last.current}
    </motion.div>
  );
}

/** Arrow keys move a split this far; with Shift, four times as far. */
const KEY_STEP = 32;

/**
 * The grip between the board and an open task, or on a rail's inner edge. Drag it, or use
 * the arrow keys (Home and End for the limits), to resize what it holds.
 */
export function SplitHandle({
  width,
  min = PANE_MIN,
  keyMin = min,
  max,
  grows = 'left',
  label = 'Resize task',
  subtle = false,
  className,
  style,
  onResize,
  onActive,
}: {
  width: number;
  /** The narrowest a pointer can take it. */
  min?: number;
  /** The narrowest the keys take it, where a pointer may go further to snap shut. */
  keyMin?: number;
  max: number;
  /** The way the pointer moves to widen it: a pane on the right grows to the left. */
  grows?: 'left' | 'right';
  label?: string;
  /** A fainter grip, for a rail's edge, which is there whether or not it is used. */
  subtle?: boolean;
  className?: string;
  style?: CSSProperties;
  /** `keyboard` is set for a step from the keys, which lands at once rather than following. */
  onResize: (width: number, keyboard: boolean) => void;
  /** Told while the grip is held, so the pane can follow the pointer without easing. */
  onActive: (active: boolean) => void;
}) {
  const [dragging, setDraggingState] = useState(false);
  const setDragging = (value: boolean) => {
    setDraggingState(value);
    onActive(value);
  };
  const start = useRef<{ x: number; width: number } | null>(null);
  const direction = grows === 'left' ? -1 : 1;

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, width };
    setDragging(true);
  }
  function end() {
    if (!start.current) return;
    start.current = null;
    setDragging(false);
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be focused or dragged.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={Math.round(keyMin)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={(event) => {
        if (!start.current) return;
        const next = start.current.width + (event.clientX - start.current.x) * direction;
        onResize(Math.min(max, Math.max(min, next)), false);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(event) => {
        const step = event.shiftKey ? KEY_STEP * 4 : KEY_STEP;
        const next =
          event.key === 'ArrowLeft'
            ? width - step * direction
            : event.key === 'ArrowRight'
              ? width + step * direction
              : event.key === 'Home'
                ? keyMin
                : event.key === 'End'
                  ? max
                  : null;
        if (next === null) return;
        event.preventDefault();
        onResize(Math.min(max, Math.max(keyMin, next)), true);
      }}
      style={style}
      className={cn(
        'group flex w-6 shrink-0 cursor-col-resize touch-none select-none items-center justify-center outline-none',
        className,
      )}
    >
      <motion.span
        aria-hidden
        className={cn(
          'w-1.5 rounded-full transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ring/70',
          dragging
            ? 'bg-brand'
            : subtle
              ? 'bg-foreground/10 group-hover:bg-foreground/35'
              : 'bg-foreground/25 group-hover:bg-foreground/40',
        )}
        initial={false}
        animate={{ height: dragging ? 72 : 48 }}
        transition={springs.snappy}
      />
    </div>
  );
}

/** The part of the screen a card covers, as a clip of a surface that fills the screen. */
function clipTo(taskId: string) {
  const rect = document
    .querySelector(`[data-card-id="${CSS.escape(taskId)}"]:not([data-overlay])`)
    ?.getBoundingClientRect();
  if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) return null;
  const right = window.innerWidth - rect.right;
  const bottom = window.innerHeight - rect.bottom;
  return `inset(${rect.top}px ${right}px ${bottom}px ${rect.left}px round 16px)`;
}

const UNCLIPPED = 'inset(0px 0px 0px 0px round 0px)';

/**
 * Small screens: the task takes the whole screen, as a note does in Catch. It opens out of
 * its card and closes back into it, on the card's own color, and its actions sit in the
 * dock's place. Pulling it down from the top closes it too.
 */
export function TaskScreen({ task, covered }: { task: Task; covered?: boolean }) {
  const content = useContext(TaskContentContext);
  return content ? (
    <TaskScreenSurface task={task} covered={covered} />
  ) : (
    <PrototypeTaskScreen task={task} />
  );
}

function PrototypeTaskScreen({ task }: { task: Task }) {
  const { project } = current(board.use());
  const status = statusById(project, task.statusId);
  const controls = useDragControls();
  const reduced = useReducedMotion();
  // Read on every render, so closing goes to where the card is now.
  const clip = reduced ? null : clipTo(task.id);
  const closed = clip ? { clipPath: clip, opacity: 1 } : { clipPath: UNCLIPPED, opacity: 0 };
  const close = () => update({ openTaskId: null });
  useBackHandler(true, close);
  const opener = useRef(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Content
        asChild
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (
            board.get().newTaskId !== task.id &&
            document.activeElement?.getAttribute('aria-label') !== 'Task title'
          )
            document.querySelector<HTMLElement>('[role="dialog"][aria-label="Task"]')?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target =
            opener.current?.isConnected && opener.current !== document.body
              ? opener.current
              : document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(task.id)}"]`);
          target?.focus();
        }}
      >
        <motion.section
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !event.defaultPrevented) {
              event.preventDefault();
              close();
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Task"
          tabIndex={-1}
          data-drop-block=""
          data-color={taskColor(project, task) ?? undefined}
          className="fixed inset-0 z-40 flex flex-col bg-[var(--tint,var(--card))]"
          initial={closed}
          animate={{ clipPath: UNCLIPPED, opacity: 1 }}
          exit={closed}
          transition={springs.smooth}
          drag="y"
          dragControls={controls}
          dragListener={false}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.6 }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 120 || info.velocity.y > 500) close();
          }}
        >
          <Dialog.Title className="sr-only">Task</Dialog.Title>
          <motion.div
            className="flex min-h-0 flex-1 flex-col"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { delay: 0.12, duration: 0.2 } }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
          >
            <div
              className="flex h-[calc(var(--safe-top)+3.5rem)] shrink-0 touch-none items-end px-8 pb-2"
              onPointerDown={(event) => controls.start(event)}
            >
              <span className="font-medium text-foreground/60 text-sm tabular-nums">
                {identifier(project, task) ?? 'Pending'}
              </span>
            </div>
            <TaskBody key={task.id} task={task} underDock />
          </motion.div>
          <div className="pointer-events-none absolute inset-x-0 bottom-[var(--dock-bottom)] flex items-center gap-2 px-3">
            <div className="glass pointer-events-auto flex rounded-[var(--dock-radius)] p-1">
              <IconButton
                label="Back to the board"
                onClick={close}
                className="size-[calc(var(--dock-height)-0.5rem)] rounded-[calc(var(--dock-radius)-0.25rem)] [&_svg]:size-6"
              >
                <ArrowLeft />
              </IconButton>
            </div>
            <span className="flex-1" />
            {status && (
              <div className="glass pointer-events-auto flex rounded-[var(--dock-radius)] p-1">
                <StatusMenu
                  project={project}
                  value={status.id}
                  onSelect={(statusId) => sendTasks([task.id], statusId)}
                >
                  <button
                    type="button"
                    className="flex h-[calc(var(--dock-height)-0.5rem)] items-center gap-2 rounded-[calc(var(--dock-radius)-0.25rem)] px-4 font-medium text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
                  >
                    <StatusGlyph category={status.category} className="size-4" />
                    {status.name}
                  </button>
                </StatusMenu>
              </div>
            )}
          </div>
        </motion.section>
      </Dialog.Content>
    </Dialog.Root>
  );
}
