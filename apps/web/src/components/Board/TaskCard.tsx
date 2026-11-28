import { sizeLabel } from '@throw/shared';
import { Ban, Check, CornerDownRight } from 'lucide-react';
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react';
import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Hint } from '@/components/Hint/Hint';
import { GithubPullMark } from '@/components/TaskGithubLinks/GithubPullMark';
import { TaskTags } from '@/components/TaskTags/TaskTags';
import { haptics } from '@/lib/haptics';
import { isDesktop } from '@/lib/media';
import { afterPaint, animateSteadySpring, springs, stopSteady } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { CARD_HELP_ID } from './BoardAnnouncer';
import {
  armBlockerSpotlight,
  blockedHint,
  blockedLabel,
  cancelBlockerSpotlight,
  consumeBlockerHoldClick,
  releaseBlockerHold,
  SPOTLIGHT_HOLD_MS,
  syncBlockerSpotlight,
  type TaskBlocker,
  useCardSpotlightRole,
  useSpotlightActiveFor,
  useTaskBlockers,
} from './blockers';
import { ARROW_DIRECTIONS, focusNextCard } from './cardFocus';
import { carryAcross, carryVertically, pickUp, putBack, setDown } from './carry';
import { consumeDragClick, drag, isPrimed, pressCard, TOUCH_SLOP } from './drag';
import { useTaskPullRequests } from './githubLinks';
import { PriorityGlyph, StatusGlyph } from './glyphs';
import {
  identifier,
  type Project,
  priorityName,
  projectOf,
  statusById,
  subtasksOf,
  type Task,
  taskColor,
} from './model';
import { SubtaskUnderlay } from './SubtaskUnderlay';
import { board, current, toggleSelected, update, useBoardSettings } from './state';
import { useTaskCardHidden, useTaskCardLanding } from './taskTransition';

type Props = {
  task: Task;
  /** Name the status on the card, where the column does not. */
  showStatus?: boolean;
  /** The copy that follows the pointer during a drag. */
  overlay?: boolean;
  className?: string;
  onOpen?: (origin?: HTMLElement | null) => void;
  statusControl?: ReactNode;
};

/** Room a revealing underlay's clip leaves beside and below it, for its shadow and rings. */
const CLIP_SPARE = '48px';

/**
 * Slides a card's subtask underlay out from behind it, or back in, as its task screen leaves or
 * lands: it is hidden only once tucked away. An open list is taller than its card, so it moves
 * behind the card and is clipped at the card's bottom edge (less the tuck under its corners)
 * rather than rising above its top: it is drawn out of, and gathered into, the card's foot.
 */
function useUnderlayTuck(hidden: boolean, reduced: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const y = useMotionValue(0);
  const [stowed, setStowed] = useState(hidden);
  const stowedNow = useRef(hidden);
  const was = useRef(hidden);
  const release = useRef(() => {});
  useLayoutEffect(
    () => () => {
      release.current();
      stopSteady(y);
      y.stop();
    },
    [y],
  );
  useLayoutEffect(() => {
    const wrapper = ref.current;
    if (was.current === hidden) return;
    was.current = hidden;
    release.current();
    const stow = (value: boolean) => {
      stowedNow.current = value;
      setStowed(value);
    };
    if (!wrapper || reduced) {
      y.jump(0);
      wrapper?.style.removeProperty('clip-path');
      stow(hidden);
      return;
    }
    // The wrapper holds only the strip below the card; the underlay's top already tucks under.
    const tuck = Math.max(0, -((wrapper.firstElementChild as HTMLElement | null)?.offsetTop ?? 0));
    const clip = (value: number) => {
      const top = -value - tuck;
      wrapper.style.clipPath = `polygon(-${CLIP_SPARE} ${top}px, calc(100% + ${CLIP_SPARE}) ${top}px, calc(100% + ${CLIP_SPARE}) calc(100% + ${CLIP_SPARE}), -${CLIP_SPARE} calc(100% + ${CLIP_SPARE}))`;
    };
    // From behind the card when it was put away; one still being gathered up turns back.
    if (!hidden && stowedNow.current) y.jump(-wrapper.offsetHeight);
    if (!hidden) stow(false);
    clip(y.get());
    const unsubscribe = y.on('change', clip);
    let current = true;
    let cancel = () => {};
    release.current = () => {
      current = false;
      cancel();
      unsubscribe();
    };
    const settle = () => {
      if (!current) return;
      release.current();
      release.current = () => {};
      wrapper.style.removeProperty('clip-path');
      if (hidden) stow(true);
    };
    if (hidden) {
      // The task's screen mounts in this same long frame, which a spring timed by the clock
      // would skip to its end: it starts after paint with the screen's own growth, by frames.
      cancel = afterPaint(() => {
        cancel = () => stopSteady(y);
        void animateSteadySpring(y, -wrapper.offsetHeight, springs.smooth).then(settle);
      });
    } else {
      stopSteady(y);
      void animate(y, 0, springs.smooth).then(settle);
    }
  }, [hidden, reduced, y]);
  return { ref, y, stowed };
}

function closedAgo(closedAt: number) {
  const days = Math.max(0, Math.round((Date.now() - closedAt) / 86_400_000));
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`;
}

/**
 * Whether a finger on a card's blocked badge can hold its blockers' spotlight: only on a board
 * that lays its columns out side by side (a tablet, an unfolded foldable), where the blockers
 * can be on screen beside it. A phone's board, or the compact one beside a task, pages one
 * column at a time, and there the badge is part of the card like any other.
 */
export function holdsBlockerSpotlight(badge: Element) {
  return isDesktop() && badge.closest('[data-board-layout]:not([data-compact-board])') !== null;
}

/**
 * How far beyond the blocked badge a finger still lands on it, each way. The badge is a 20 px
 * square on a 12 px icon, smaller than a fingertip, and a finger that just misses it would hold
 * the card instead and select it; this makes the target a finger's 44 px. The badge's box stays
 * as it is, so a mouse still lingers on the icon itself.
 */
export const BLOCKED_BADGE_REACH = 12;

function withinReach(badge: Element, x: number, y: number) {
  const box = badge.getBoundingClientRect();
  return (
    x >= box.left - BLOCKED_BADGE_REACH &&
    x <= box.right + BLOCKED_BADGE_REACH &&
    y >= box.top - BLOCKED_BADGE_REACH &&
    y <= box.bottom + BLOCKED_BADGE_REACH
  );
}

/**
 * A finger held on a card's blocked badge, or close enough to it: it lights up the task's
 * blockers after the board's long press, for as long as it stays down, in place of the card's
 * own press. The card is not picked up, selected or opened by it, and a finger that sets off
 * scrolling lets it go. Its handlers go on the card's face, which holds the badge and the room
 * around it, so a press just beside the badge reaches them.
 */
function useBlockerHold(taskId: string, blockers: readonly TaskBlocker[]) {
  const badge = useRef<HTMLSpanElement>(null);
  const hold = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const latest = useRef(blockers);
  latest.current = blockers;

  function end(event: PointerEvent<HTMLElement>) {
    if (hold.current?.pointerId !== event.pointerId) return;
    hold.current = null;
    releaseBlockerHold(taskId);
  }

  return {
    badge,
    onPointerDown(event: PointerEvent<HTMLElement>) {
      const target = badge.current;
      if (!target || event.pointerType !== 'touch' || event.button !== 0 || hold.current) return;
      // Another control in reach keeps its own press.
      if (
        event.target instanceof Element &&
        !target.contains(event.target) &&
        event.target.closest('a, button, input, [data-no-drag]')
      )
        return;
      if (!withinReach(target, event.clientX, event.clientY)) return;
      if (!holdsBlockerSpotlight(target)) return;
      // The card's press would pick it up or select it after the same wait.
      event.stopPropagation();
      hold.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // A pointer already gone has nothing to capture.
      }
      armBlockerSpotlight(taskId, latest.current, SPOTLIGHT_HOLD_MS, haptics.selection);
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const press = hold.current;
      if (press?.pointerId !== event.pointerId) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > TOUCH_SLOP) end(event);
    },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
    onContextMenu(event: MouseEvent<HTMLElement>) {
      // A held finger asks for the browser's menu; the spotlight has answered it.
      if (!hold.current) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

/** A card's status control: its tap target reaches beyond the line without growing it much. */
export const CARD_STATUS_CONTROL = '-my-2 flex min-h-10 min-w-0 items-center gap-1 rounded-lg px-1';

/** What a card says: the title, then one quiet line of everything else. */
export function TaskCardFace({
  project,
  task,
  showStatus,
  statusControl,
  statusAsControl = false,
  spotlight = false,
  links = false,
}: {
  project: Project;
  task: Task;
  showStatus?: boolean;
  statusControl?: ReactNode;
  /** Lays the status out as `statusControl` would, for a copy of a card that has one. */
  statusAsControl?: boolean;
  /** True for interactive board cards that can trigger the blocker spotlight on linger. */
  spotlight?: boolean;
  /** True where the pull request mark can link and preview: not on a copy of a card. */
  links?: boolean;
}) {
  const [settings] = useBoardSettings();
  const state = board.use();
  const status = statusById(project, task.statusId);
  const blockers = useTaskBlockers(task.id);
  const blocked = blockers.length > 0 && task.closedAt === null;
  const pulls = useTaskPullRequests(task.id);
  const spotlightActive = useSpotlightActiveFor(task.id, spotlight);
  const hold = useBlockerHold(task.id, blockers);
  const parent = task.parentId
    ? current(state).tasks.find((item) => item.id === task.parentId)
    : undefined;

  // Keep a pending or active spotlight accurate if synced blockers change or the card unmounts.
  useEffect(() => {
    if (!spotlight) return;
    if (!blocked) {
      cancelBlockerSpotlight(task.id);
      return;
    }
    syncBlockerSpotlight(task.id, blockers);
  }, [spotlight, blocked, task.id, blockers]);

  useEffect(() => {
    if (!spotlight) return;
    return () => cancelBlockerSpotlight(task.id);
  }, [spotlight, task.id]);

  const hintLabel = blocked ? blockedHint(blockers, project) : '';

  return (
    <div
      className="px-4 pt-3.5 pb-3"
      {...(spotlight && blocked
        ? {
            onPointerDown: hold.onPointerDown,
            onPointerMove: hold.onPointerMove,
            onPointerUp: hold.onPointerUp,
            onPointerCancel: hold.onPointerCancel,
            onLostPointerCapture: hold.onLostPointerCapture,
            onContextMenu: hold.onContextMenu,
          }
        : {})}
    >
      {parent && !state.actions && (
        <p className="mb-1.5 flex items-center gap-1 text-foreground/55 text-xs">
          <CornerDownRight className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{parent.title}</span>
        </p>
      )}
      <p className="line-clamp-4 font-medium text-[0.9375rem] leading-snug [overflow-wrap:anywhere] max-md:text-base">
        {task.title || 'Untitled task'}
      </p>
      {/*
        As on Catch's cards: the primary tag first and bolder, each in its root's color. The
        workspace board colors cards by project, and so leaves tag colors out (spec).
      */}
      <TaskTags
        tags={projectOf(project, task).tags}
        primaryTagId={task.primaryTagId}
        secondaryTagIds={task.secondaryTagIds}
        card
        colored={!project.members}
        className="mt-2.5"
      />
      <div className="mt-3 flex min-h-5 items-center gap-2.5 text-foreground/55 text-xs max-md:text-[0.8125rem]">
        <span className="shrink-0 font-medium tabular-nums">
          {identifier(project, task) ?? 'Pending'}
        </span>
        {blocked && (
          <Hint label={hintLabel}>
            <span
              ref={hold.badge}
              role="img"
              data-blocked=""
              data-spotlight-trigger={spotlightActive ? 'active' : undefined}
              aria-label={blockedLabel(blockers)}
              onPointerEnter={
                spotlight
                  ? (event) => {
                      if (event.pointerType === 'touch' || event.buttons !== 0) return;
                      armBlockerSpotlight(task.id, blockers);
                    }
                  : undefined
              }
              onPointerLeave={spotlight ? () => cancelBlockerSpotlight(task.id) : undefined}
              onPointerCancel={spotlight ? () => cancelBlockerSpotlight(task.id) : undefined}
              className={cn(
                '-m-1 flex shrink-0 items-center rounded-md p-1 text-destructive/80 transition-colors',
                spotlightActive && 'bg-destructive/15 text-destructive',
              )}
            >
              <Ban aria-hidden className="size-3" />
            </span>
          </Hint>
        )}
        {pulls.length > 0 && <GithubPullMark pulls={pulls} interactive={links} />}
        {parent && state.actions && (
          <Hint label={`Subtask of ${parent.title}`}>
            <span role="img" aria-label={`Subtask of ${parent.title}`}>
              <CornerDownRight aria-hidden className="size-3" />
            </span>
          </Hint>
        )}
        <span className="flex-1" />
        {statusControl ??
          (showStatus && status && (
            <span
              className={statusAsControl ? CARD_STATUS_CONTROL : 'flex min-w-0 items-center gap-1'}
            >
              <StatusGlyph category={status.category} color={status.color} className="size-3" />
              <span className="truncate">{status.name}</span>
            </span>
          ))}
        {task.closedAt !== null && !state.actions && (
          <span className="shrink-0">{closedAgo(task.closedAt)}</span>
        )}
        {settings.cardSize && task.size !== null && (
          <span className="shrink-0 rounded-md bg-foreground/[0.06] px-1.5 font-medium">
            <span className="sr-only">Size </span>
            {sizeLabel(task.size)}
          </span>
        )}
        {settings.cardPriority && task.closedAt === null && (
          <PriorityGlyph
            priority={task.priority}
            name={priorityName(projectOf(project, task), task.priority)}
          />
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
  const reduced = useReducedMotion();
  const { project, tasks } = current(state);
  const color = taskColor(project, task);
  const subtasks = state.subtasksAsCards ? [] : subtasksOf(tasks, task.id);
  const selected = !onOpen && state.selection.includes(task.id);
  const carried = state.carrying?.taskId === task.id;
  const open = state.openTaskId === task.id;
  const spotlightEnabled = !overlay && !onOpen;
  const spotlightRole = useCardSpotlightRole(task.id, state.subtasksAsCards, spotlightEnabled);
  const lifted = useTaskCardHidden(task.id);
  // As in Catch, a task shrinking back into its card lands without the underlay, which slides
  // out from behind the card as the task settles, as if the card were setting it down. Opening,
  // the card gathers it up the same way before it is hidden, rather than dropping it at once.
  const settling = useTaskCardLanding(task.id);
  const underlayHidden = lifted && !settling;
  const underlay = useUnderlayTuck(underlayHidden, !!reduced);
  // The real card waits unseen while its copy flies home.
  const landing = !overlay && dragState?.phase === 'landing' && dragState.ids.includes(task.id);
  // Where a list cannot close up around a held card, its place stays, faded.
  const away = !overlay && dragState?.phase === 'dragging' && dragState.ids.includes(task.id);
  const ref = useRef<HTMLElement>(null);
  /** The pointer that last pressed the card, which tells a right click from a held finger. */
  const pressedBy = useRef<string | null>(null);

  // A carried card is remounted when it changes column; focus has to follow it.
  useEffect(() => {
    if (carried && document.activeElement !== ref.current) ref.current?.focus();
  });

  function onClick(event: MouseEvent<HTMLElement>) {
    if (overlay || consumeDragClick() || consumeBlockerHoldClick()) return;
    // Portalled status choices bubble through React, but are not a click on this card.
    if (event.target instanceof Node && !event.currentTarget.contains(event.target)) return;
    if (event.target instanceof Element && event.target.closest('[data-no-drag]')) return;
    cancelBlockerSpotlight();
    if (onOpen) {
      onOpen(ref.current);
      return;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || state.selection.length > 0) {
      haptics.selection();
      toggleSelected(task.id);
    } else {
      update({ openTaskId: open ? null : task.id }, ref.current);
    }
  }

  /**
   * As in Catch, a right click is the mouse's long press: it selects the card, or lets it go,
   * in place of the browser's menu. A held finger also asks for a menu, which its long press
   * has already answered; a field inside the card keeps its own menu.
   */
  function onContextMenu(event: MouseEvent<HTMLElement>) {
    if (dragState || isPrimed()) {
      event.preventDefault();
      return;
    }
    if (pressedBy.current === 'touch' || pressedBy.current === 'pen') return;
    if (event.target instanceof Node && !event.currentTarget.contains(event.target)) return;
    if (
      event.target instanceof Element &&
      event.target.closest('input, textarea, select, [contenteditable="true"], [data-no-drag]')
    )
      return;
    event.preventDefault();
    haptics.selection();
    toggleSelected(task.id);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return;
    if (onOpen && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onOpen(ref.current);
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
    } else if (
      !carried &&
      event.key in ARROW_DIRECTIONS &&
      !(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) &&
      // A phone pages its columns, so its arrows stay in the column on screen.
      (isDesktop() || event.key === 'ArrowUp' || event.key === 'ArrowDown')
    ) {
      // Unheld, the arrows walk the board to the card they point at.
      if (focusNextCard(event.currentTarget, ARROW_DIRECTIONS[event.key]!)) event.preventDefault();
    } else if (carried && event.key === 'Escape') {
      event.preventDefault();
      putBack();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (carried) setDown();
      else update({ openTaskId: task.id }, ref.current);
    }
  }

  const card = (
    <motion.article
      ref={ref}
      data-card-id={task.id}
      data-card-root={subtasks.length === 0 ? '' : undefined}
      data-show-status={showStatus ? '' : undefined}
      data-status-control={statusControl ? '' : undefined}
      data-overlay={overlay ? '' : undefined}
      data-color={color ?? undefined}
      data-spotlight={spotlightRole !== 'none' ? spotlightRole : undefined}
      data-spotlight-instant={reduced ? '' : undefined}
      tabIndex={overlay ? -1 : 0}
      aria-label={`${identifier(project, task) ?? 'Pending'} ${task.title || 'Untitled task'}`}
      aria-roledescription="Task card"
      aria-describedby={overlay || onOpen ? undefined : CARD_HELP_ID}
      aria-current={open ? 'true' : undefined}
      onPointerDown={
        overlay || onOpen
          ? undefined
          : (event) => {
              pressedBy.current = event.pointerType;
              pressCard(event, task.id);
            }
      }
      onClick={onClick}
      onKeyDown={overlay ? undefined : onKeyDown}
      onContextMenu={overlay || onOpen ? undefined : onContextMenu}
      whileTap={overlay || carried ? undefined : { scale: 0.97 }}
      animate={{ scale: carried ? 1.03 : 1 }}
      transition={springs.snappy}
      className={cn(
        'board-card group relative flex cursor-pointer select-none flex-col rounded-2xl border border-transparent text-card-foreground outline-none [-webkit-touch-callout:none]',
        'shadow-[0_1px_2px_oklch(0_0_0/0.06)] hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/60',
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
        spotlight={spotlightEnabled}
        links={!overlay}
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
      data-spotlight-group={
        spotlightRole === 'dimmed' ? 'dimmed' : spotlightRole !== 'none' ? 'active' : undefined
      }
      data-spotlight-instant={reduced ? '' : undefined}
      className={cn('board-card-group isolate flex min-w-0 flex-col', landing && 'invisible')}
    >
      {card}
      <motion.div
        ref={underlay.ref}
        className={cn('-z-10 relative flex flex-col', underlay.stowed && 'invisible')}
        style={{ y: underlay.y }}
      >
        <SubtaskUnderlay parent={task} subtasks={subtasks} inert={overlay} />
      </motion.div>
    </div>
  );
}
