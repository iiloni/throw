import { Check, CornerDownRight } from 'lucide-react';
import { animate, motion, useMotionValue } from 'motion/react';
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { CARD_HELP_ID } from './BoardAnnouncer';
import { carryAcross, carryVertically, pickUp, putBack, setDown } from './carry';
import { consumeDragClick, drag, isPrimed, pressCard } from './drag';
import { PriorityGlyph, StatusGlyph } from './glyphs';
import {
  identifier,
  type Project,
  priorityName,
  statusById,
  subtasksOf,
  type Task,
  taskColor,
} from './model';
import { SubtaskUnderlay } from './SubtaskUnderlay';
import { board, current, toggleSelected, update, useBoardSettings } from './state';
import { swipe, swipeX } from './swipe';
import { useTaskCardHidden, useTaskCardLanding } from './taskTransition';

type Props = {
  task: Task;
  /** Name the status on the card, where the column does not. */
  showStatus?: boolean;
  /** The copy that follows the pointer during a drag. */
  overlay?: boolean;
  className?: string;
  onOpen?: () => void;
  statusControl?: ReactNode;
};

function closedAgo(closedAt: number) {
  const days = Math.max(0, Math.round((Date.now() - closedAt) / 86_400_000));
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`;
}

/** What a card says: the title, then one quiet line of everything else. */
export function TaskCardFace({
  project,
  task,
  showStatus,
  statusControl,
}: {
  project: Project;
  task: Task;
  showStatus?: boolean;
  statusControl?: ReactNode;
}) {
  const [settings] = useBoardSettings();
  const state = board.use();
  const tag = project.tags.find((item) => item.id === task.primaryTagId);
  const status = statusById(project, task.statusId);
  const parent = task.parentId
    ? current(state).tasks.find((item) => item.id === task.parentId)
    : undefined;
  return (
    <div className="px-4 pt-3.5 pb-3">
      {parent && !state.actions && (
        <p className="mb-1.5 flex items-center gap-1 text-foreground/55 text-xs">
          <CornerDownRight className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{parent.title}</span>
        </p>
      )}
      <p className="line-clamp-4 font-medium text-[0.9375rem] leading-snug [overflow-wrap:anywhere] max-md:text-base">
        {task.title || 'Untitled task'}
      </p>
      <div className="mt-3 flex min-h-5 items-center gap-2.5 text-foreground/55 text-xs max-md:text-[0.8125rem]">
        <span className="shrink-0 font-medium tabular-nums">
          {identifier(project, task) ?? 'Pending'}
        </span>
        {tag && <span className="min-w-0 truncate text-tint-accent">{tag.name}</span>}
        {task.secondaryTagIds.length > 0 && !state.actions && (
          <span className="shrink-0 tabular-nums">+{task.secondaryTagIds.length}</span>
        )}
        {parent && state.actions && (
          <span
            role="img"
            aria-label={`Subtask of ${parent.title}`}
            title={`Subtask of ${parent.title}`}
          >
            <CornerDownRight aria-hidden className="size-3" />
          </span>
        )}
        <span className="flex-1" />
        {statusControl ??
          (showStatus && status && (
            <span className="flex min-w-0 items-center gap-1">
              <StatusGlyph category={status.category} className="size-3" />
              <span className="truncate">{status.name}</span>
            </span>
          ))}
        {task.closedAt !== null && !state.actions && (
          <span className="shrink-0">{closedAgo(task.closedAt)}</span>
        )}
        {settings.cardPriority && task.closedAt === null && (
          <PriorityGlyph priority={task.priority} name={priorityName(project, task.priority)} />
        )}
      </div>
    </div>
  );
}

export function TaskCard({
  task,
  showStatus,
  overlay = false,
  className,
  onOpen,
  statusControl,
}: Props) {
  const state = board.use();
  const dragState = drag.use();
  const { project, tasks } = current(state);
  const color = taskColor(project, task);
  const subtasks = state.subtasksAsCards ? [] : subtasksOf(tasks, task.id);
  const selected = !onOpen && state.selection.includes(task.id);
  const carried = state.carrying?.taskId === task.id;
  const swiped = swipe.use();
  const swiping = !overlay && swiped?.taskId === task.id;
  const open = state.openTaskId === task.id;
  const lifted = useTaskCardHidden(task.id);
  // As in Catch, a task shrinking back into its card lands without the underlay, which slides
  // out from behind the card as the task settles, as if the card were setting it down.
  const settling = useTaskCardLanding(task.id);
  const underlayHidden = lifted && !settling;
  const underlay = useRef<HTMLDivElement>(null);
  const underlayY = useMotionValue(0);
  const wasHidden = useRef(underlayHidden);
  useLayoutEffect(() => {
    if (wasHidden.current && !underlayHidden && underlay.current) {
      // The wrapper holds only the strip below the card; the underlay's top already tucks under.
      underlayY.set(-underlay.current.offsetHeight);
      void animate(underlayY, 0, springs.smooth);
    }
    wasHidden.current = underlayHidden;
  }, [underlayHidden, underlayY]);
  // The real card waits unseen while its copy flies home.
  const landing = !overlay && dragState?.phase === 'landing' && dragState.ids.includes(task.id);
  // Where a list cannot close up around a held card, its place stays, faded.
  const away = !overlay && dragState?.phase === 'dragging' && dragState.ids.includes(task.id);
  const ref = useRef<HTMLElement>(null);

  // A carried card is remounted when it changes column; focus has to follow it.
  useEffect(() => {
    if (carried && document.activeElement !== ref.current) ref.current?.focus();
  });

  function onClick(event: MouseEvent<HTMLElement>) {
    if (overlay || consumeDragClick()) return;
    // Portalled status choices bubble through React, but are not a click on this card.
    if (event.target instanceof Node && !event.currentTarget.contains(event.target)) return;
    if (event.target instanceof Element && event.target.closest('[data-no-drag]')) return;
    if (onOpen) {
      onOpen();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || state.selection.length > 0) {
      toggleSelected(task.id);
    } else {
      update({ openTaskId: open ? null : task.id });
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return;
    if (onOpen && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onOpen();
      return;
    }
    const arrows: Record<string, () => void> = {
      ArrowUp: () => carryVertically(-1),
      ArrowDown: () => carryVertically(1),
      ArrowLeft: () => carryAcross(-1),
      ArrowRight: () => carryAcross(1),
    };
    if (event.key === ' ') {
      event.preventDefault();
      if (carried) setDown();
      else pickUp(task.id);
    } else if (carried && event.key in arrows) {
      event.preventDefault();
      arrows[event.key]!();
    } else if (carried && event.key === 'Escape') {
      event.preventDefault();
      putBack();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (carried) setDown();
      else update({ openTaskId: task.id });
    }
  }

  const card = (
    <motion.article
      ref={ref}
      data-card-id={task.id}
      data-card-root={subtasks.length === 0 ? '' : undefined}
      data-show-status={showStatus ? '' : undefined}
      data-overlay={overlay ? '' : undefined}
      data-color={color ?? undefined}
      tabIndex={overlay ? -1 : 0}
      aria-label={`${identifier(project, task) ?? 'Pending'} ${task.title || 'Untitled task'}`}
      aria-roledescription="Task card"
      aria-describedby={overlay || onOpen ? undefined : CARD_HELP_ID}
      aria-current={open ? 'true' : undefined}
      onPointerDown={overlay || onOpen ? undefined : (event) => pressCard(event, task.id)}
      onClick={onClick}
      onKeyDown={overlay ? undefined : onKeyDown}
      onContextMenu={(event) => {
        if (dragState || isPrimed()) event.preventDefault();
      }}
      style={swiping ? { x: swipeX } : undefined}
      whileTap={overlay || carried ? undefined : { scale: 0.97 }}
      animate={{ scale: carried ? 1.03 : 1 }}
      transition={springs.snappy}
      className={cn(
        'group relative flex cursor-pointer select-none flex-col rounded-2xl border border-transparent text-card-foreground outline-none [-webkit-touch-callout:none]',
        'shadow-[0_1px_2px_oklch(0_0_0/0.06)] transition-shadow hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/60',
        color ? 'bg-tint' : 'border-border bg-card',
        open && 'ring-2 ring-brand ring-inset',
        (carried || overlay) && 'shadow-xl hover:shadow-xl',
        carried && 'ring-2 ring-brand',
        (landing || lifted) && 'invisible',
        away && 'opacity-30',
        className,
      )}
    >
      <TaskCardFace
        project={project}
        task={task}
        showStatus={showStatus}
        statusControl={statusControl}
      />
      <motion.span
        aria-hidden
        className="-inset-px pointer-events-none absolute rounded-2xl border-2 border-foreground"
        initial={false}
        animate={{ opacity: selected ? 1 : 0 }}
        transition={{ duration: 0.15 }}
      />
      {selected && (
        <motion.span
          aria-hidden
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={springs.snappy}
          className="-top-1.5 -right-1.5 absolute flex size-5 items-center justify-center rounded-full bg-foreground text-background"
        >
          <Check className="size-3" strokeWidth={3} />
        </motion.span>
      )}
    </motion.article>
  );

  if (subtasks.length === 0) return card;
  return (
    // Isolated so the underlay can sit behind the card without going behind the page.
    <div
      data-card-root=""
      data-color={color ?? undefined}
      className={cn('isolate flex flex-col', landing && 'invisible')}
    >
      {card}
      <motion.div
        ref={underlay}
        className={cn('-z-10 relative flex flex-col', underlayHidden && 'invisible')}
        style={{ y: underlayY }}
      >
        <SubtaskUnderlay
          parent={task}
          subtasks={subtasks}
          inert={overlay}
          folding={overlay && dragState?.unfolded}
        />
      </motion.div>
    </div>
  );
}
