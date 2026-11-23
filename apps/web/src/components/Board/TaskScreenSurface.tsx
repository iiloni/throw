import {
  cancelFrame,
  frame,
  motion,
  useMotionValue,
  usePresence,
  useReducedMotion,
  useTransform,
} from 'motion/react';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useBackHandler } from '@/lib/backButton';
import { afterPaint, animateSteady, curves, stopSteady } from '@/lib/motion';
import { type Task, taskColor } from './model';
import { board, current, leaveTask } from './state';
import { TaskCardFace } from './TaskCard';
import { TaskContentContext } from './taskContent';
import { TaskEditorReadyContext, TaskScrollContext } from './taskMotionContext';
import {
  findTaskCard,
  isVisibleOrigin,
  landTaskCard,
  setTaskCardHidden,
  showTaskSurface,
  takeTaskOrigin,
  taskCardRect,
} from './taskTransition';
import { MAX_DRAG, useSwipeToDismiss } from './useSwipeToDismiss';

const lerp = (from: number, to: number, progress: number) => from + (to - from) * progress;
/** Catch's lead: the card's underlay starts moving this long before the task lands. */
const LAND_EARLY = 0.25;
/** A card's border width: its face sits inside it. */
const CARD_BORDER = 1;
/**
 * When a screen closing into a relation row begins dissolving into it (seconds): held until the
 * surface has nearly reached the ribbon's height so it settles onto the row rather than fading
 * out in mid-air.
 */
const ROW_DISSOLVE_DELAY = 0.35;

/**
 * Catch's card ⇄ note container transform: resize the clipping box, never its text. A subtask
 * opened from its parent's pane grows over that pane, which stays beneath it, `covered`.
 */
export function TaskScreenSurface({ task, covered = false }: { task: Task; covered?: boolean }) {
  const content = useContext(TaskContentContext)!;
  const { project } = current(board.use());
  const [isPresent, safeToRemove] = usePresence();
  const reduced = useReducedMotion();
  const [origin] = useState(() => (reduced ? null : takeTaskOrigin(task.id)));
  const card = useMotionValue(origin);
  // The face matches the card it leaves or lands on: a board column's cards omit their status,
  // and a subtask's card in its parent makes it a control.
  const [face, setFace] = useState({
    showStatus: origin?.showStatus ?? true,
    statusControl: origin?.statusControl ?? false,
  });
  const color = taskColor(project, task);
  const viewport = useMotionValue({ width: innerWidth, height: innerHeight });
  const progress = useMotionValue(reduced ? 1 : 0);
  // With reduced motion the screen fades in and out in place, without moving.
  const fade = useMotionValue(origin ? 1 : 0);
  // A screen growing out of or settling into a relation row fades on its own timer rather than
  // with `progress`, because `EASE_EMPHASIZED` spends most of a collapse near zero progress.
  const rowFade = useMotionValue(origin?.row ? 0 : 1);
  const dragY = useMotionValue(0);
  const [settled, setSettled] = useState(!!reduced);
  const screen = useRef<HTMLElement>(null);
  const opener = useRef(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  // A task discarded or trashed as it closes keeps its last page while it goes.
  const page = content.body(task.id);
  const lastPage = useRef(page);
  if (isPresent && page) lastPage.current = page;
  const close = () => {
    if (board.get().openTaskId === task.id) leaveTask();
  };
  const top = !!isPresent && !covered;
  useBackHandler(top, close);
  const attachScroll = useSwipeToDismiss({ dragY, onDismiss: close, enabled: top });
  const x = useTransform(() => (1 - progress.get()) * (card.get()?.x ?? 0));
  const y = useTransform(
    () =>
      (1 - progress.get()) * (card.get()?.y ?? 0) +
      dragY.get() +
      (reduced ? 0 : (1 - fade.get()) * 48),
  );
  const width = useTransform(() =>
    lerp(card.get()?.width ?? viewport.get().width, viewport.get().width, progress.get()),
  );
  const height = useTransform(() =>
    lerp(card.get()?.height ?? viewport.get().height, viewport.get().height, progress.get()),
  );
  const borderRadius = useTransform(() =>
    lerp(card.get()?.radius ?? 0, 28 * Math.min(1, Math.abs(dragY.get()) / 80), progress.get()),
  );
  const scale = useTransform(
    () =>
      (1 - (Math.abs(dragY.get()) / MAX_DRAG) * 0.08) *
      (card.get() || reduced ? 1 : 0.94 + 0.06 * fade.get()),
  );
  // Out of a row that is not a card, the screen fades in as it leaves it and dissolves once it
  // settles onto it, since it has no card face to become.
  const opacity = useTransform(() => {
    const rect = card.get();
    if (!rect) return fade.get();
    return rect.row ? rowFade.get() : 1;
  });
  const edgeOpacity = useTransform(() => (card.get() ? Math.max(0, 1 - progress.get() / 0.35) : 0));
  const faceOpacity = useTransform(() => (card.get()?.row ? 0 : edgeOpacity.get()));
  const textOpacity = useTransform(() => {
    const rect = card.get();
    if (!rect) return reduced ? 1 : fade.get();
    // A relation row has no card face to trade into, so the page stays visible further into
    // the shrink before the pill settles on the ribbon.
    return rect.row
      ? Math.max(0, Math.min(1, (progress.get() - 0.08) / 0.37))
      : Math.max(0, Math.min(1, (progress.get() - 0.25) / 0.45));
  });
  const backdrop = useTransform(() => progress.get() * 0.35 * (reduced ? fade.get() : 1));
  const pageWidth = useTransform(() => viewport.get().width);
  const pageHeight = useTransform(() => viewport.get().height);
  const faceWidth = useTransform(
    () => (card.get()?.width ?? viewport.get().width) - 2 * CARD_BORDER,
  );
  // The card's own edge, which it is hidden with while the task is out of it. Without it, a
  // card landing in the backlog's glass drawer would read as part of the drawer until shown,
  // and an untinted task closing into a relation row would blend into the card beneath.
  const boxShadow = useTransform(
    () => `0 1px 2px oklch(0 0 0 / ${(0.06 * edgeOpacity.get()).toFixed(3)})`,
  );

  useEffect(() => {
    const resize = () => viewport.set({ width: innerWidth, height: innerHeight });
    addEventListener('resize', resize);
    return () => removeEventListener('resize', resize);
  }, [viewport]);

  useLayoutEffect(() => {
    let active = true;
    // A task closing into a card in the drawer settles over it while the drawer rises to meet
    // it; beneath, the drawer would cover its own card. Decided before the drawer moves.
    if (screen.current)
      screen.current.style.zIndex = !isPresent && cardInDrawer(task.id) ? '46' : '';
    if (reduced) {
      progress.jump(1);
      void animateSteady(fade, isPresent ? 1 : 0, curves.fade).then(() => {
        if (active && !isPresent) safeToRemove?.();
      });
      return () => {
        active = false;
        stopSteady(fade);
      };
    }
    if (isPresent && origin && !origin.row) setTaskCardHidden(task.id, true);
    let landing = 0;
    const originElement = origin?.element ?? null;
    const openedFromRow = origin?.row ?? false;
    // Land back on the exact opener element when it is still in view, so a task that appears
    // as both a subtask card and a blocker row never crosses between the two.
    const findLanding = () => {
      if (originElement && isVisibleOrigin(originElement)) return originElement;
      if (openedFromRow) return null;
      return findTaskCard(task.id, 'card');
    };
    // The card is followed every frame: the backlog's drawer is still rising to it, and the
    // list it is in may scroll.
    let target: HTMLElement | null = null;
    const follow = () => {
      if (!target || !isVisibleOrigin(target)) target = findLanding();
      if (target) card.set(taskCardRect(target));
    };
    const cancel = afterPaint(() => {
      if (!isPresent) {
        // Trash and status changes have had a paint to remove or reposition the landing card.
        target = findLanding();
        const rect = target && taskCardRect(target);
        card.set(rect);
        if (rect) {
          if (!rect.row) {
            setFace({ showStatus: rect.showStatus, statusControl: rect.statusControl });
            setTaskCardHidden(task.id, true);
            landing = window.setTimeout(
              () => landTaskCard(task.id),
              (curves.collapse.duration - LAND_EARLY) * 1000,
            );
          }
          frame.read(follow, true);
        } else {
          setTaskCardHidden(task.id, false);
        }
      }
      const curve = isPresent ? curves.expand : curves.collapse;
      const animations = [
        animateSteady(progress, isPresent ? 1 : 0, curve),
        animateSteady(dragY, 0, curve),
      ];
      const rect = card.get();
      if (!rect) animations.push(animateSteady(fade, isPresent ? 1 : 0, curve));
      else if (rect.row) {
        animations.push(
          animateSteady(
            rowFade,
            isPresent ? 1 : 0,
            curves.fade,
            isPresent ? 0 : ROW_DISSOLVE_DELAY * 1000,
          ),
        );
      } else rowFade.jump(1);
      void Promise.all(animations).then(() => {
        if (!active) return;
        if (isPresent) setSettled(true);
        else {
          cancelFrame(follow);
          setTaskCardHidden(task.id, false);
          safeToRemove?.();
        }
      });
    });
    return () => {
      active = false;
      cancel();
      cancelFrame(follow);
      window.clearTimeout(landing);
      stopSteady(progress);
      stopSteady(fade);
      stopSteady(rowFade);
      stopSteady(dragY);
    };
  }, [isPresent, reduced, origin, task.id, card, progress, dragY, fade, rowFade, safeToRemove]);

  useEffect(() => () => setTaskCardHidden(task.id, false), [task.id]);
  useEffect(showTaskSurface, []);

  // Not a Radix modal: the board's drawer sits above the screen as the task's dock, and the
  // board behind it is inert instead. Focus moves in on opening and back out after closing.
  useEffect(() => {
    const screen = document.querySelector<HTMLElement>(`[data-task-screen="${task.id}"]`);
    // A new task's title has already taken focus to be named.
    if (!screen?.contains(document.activeElement)) screen?.focus({ preventScroll: true });
    return () => {
      // After the inert layer beneath lifts and the landing card is shown again, unless the
      // next task has taken focus.
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active && active !== document.body) return;
        const target =
          opener.current?.isConnected && opener.current !== document.body
            ? opener.current
            : document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(task.id)}"]`);
        target?.focus({ preventScroll: true });
      });
    };
  }, [task.id]);

  return (
    <>
      <motion.div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-40 bg-black"
        style={{ opacity: backdrop }}
      />
      <section
        ref={screen}
        role="dialog"
        aria-label={isPresent ? (covered ? 'Task beneath' : 'Task') : 'Closing task'}
        data-task-screen={task.id}
        data-drop-block=""
        tabIndex={-1}
        inert={!top || !!content.drawer?.page}
        className="pointer-events-none fixed inset-0 z-40 outline-none"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !event.defaultPrevented) {
            event.preventDefault();
            close();
          }
        }}
      >
        {/* Near the card it wears the card's edge, border and shadow, so landing changes nothing. */}
        <motion.div
          data-task-surface=""
          data-color={color ?? undefined}
          className="pointer-events-auto absolute top-0 left-0 overflow-hidden bg-[var(--tint,var(--card))]"
          style={{
            x,
            y,
            width,
            height,
            borderRadius,
            scale,
            opacity,
            boxShadow,
            transformOrigin: 'center',
          }}
        >
          <motion.div
            className="flex flex-col"
            style={{ width: pageWidth, height: pageHeight, opacity: textOpacity }}
          >
            <TaskScrollContext.Provider value={attachScroll}>
              <TaskEditorReadyContext.Provider value={settled}>
                {lastPage.current}
              </TaskEditorReadyContext.Provider>
            </TaskScrollContext.Provider>
          </motion.div>
          <motion.div
            aria-hidden
            data-task-face=""
            className="pointer-events-none absolute top-px left-px"
            style={{ width: faceWidth, opacity: faceOpacity }}
          >
            <TaskCardFace
              project={project}
              task={task}
              showStatus={face.showStatus}
              statusAsControl={face.statusControl}
            />
          </motion.div>
          {/* A tinted card's border is transparent. */}
          {!color && (
            <motion.div
              aria-hidden
              data-task-edge=""
              className="pointer-events-none absolute inset-0 rounded-[inherit] border border-border"
              style={{ opacity: edgeOpacity }}
            />
          )}
        </motion.div>
      </section>
    </>
  );
}

function cardInDrawer(taskId: string) {
  return !!document.querySelector(
    `[data-drawer] [data-card-id="${CSS.escape(taskId)}"]:not([data-overlay])`,
  );
}
