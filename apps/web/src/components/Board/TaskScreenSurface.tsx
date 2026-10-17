import { motion, useMotionValue, usePresence, useReducedMotion, useTransform } from 'motion/react';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useBackHandler } from '@/lib/backButton';
import { afterPaint, animateSteady, curves, stopSteady } from '@/lib/motion';
import { type Task, taskColor } from './model';
import { board, current, leaveTask } from './state';
import { TaskCardFace } from './TaskCard';
import { TaskContentContext } from './taskContent';
import { TaskEditorReadyContext, TaskScrollContext } from './taskMotionContext';
import { measureTaskCard, setTaskCardHidden, takeTaskOrigin } from './taskTransition';
import { MAX_DRAG, useSwipeToDismiss } from './useSwipeToDismiss';

const lerp = (from: number, to: number, progress: number) => from + (to - from) * progress;

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
  // The face matches the card it leaves or lands on: a board column's cards omit their status.
  const [faceStatus, setFaceStatus] = useState(origin?.showStatus ?? true);
  const viewport = useMotionValue({ width: innerWidth, height: innerHeight });
  const progress = useMotionValue(reduced ? 1 : 0);
  const fade = useMotionValue(origin || reduced ? 1 : 0);
  const dragY = useMotionValue(0);
  const [settled, setSettled] = useState(!!reduced);
  const opener = useRef(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const close = () => {
    if (board.get().openTaskId === task.id) leaveTask();
  };
  const top = !!isPresent && !covered;
  useBackHandler(top, close);
  const attachScroll = useSwipeToDismiss({ dragY, onDismiss: close, enabled: top });
  const x = useTransform(() => (1 - progress.get()) * (card.get()?.x ?? 0));
  const y = useTransform(
    () => (1 - progress.get()) * (card.get()?.y ?? 0) + dragY.get() + (1 - fade.get()) * 48,
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
      (1 - (Math.abs(dragY.get()) / MAX_DRAG) * 0.08) * (card.get() ? 1 : 0.94 + 0.06 * fade.get()),
  );
  const opacity = useTransform(() => (card.get() ? 1 : fade.get()));
  const faceOpacity = useTransform(() => (card.get() ? Math.max(0, 1 - progress.get() / 0.35) : 0));
  const textOpacity = useTransform(() =>
    card.get() ? Math.max(0, Math.min(1, (progress.get() - 0.25) / 0.45)) : fade.get(),
  );
  const backdrop = useTransform(() => progress.get() * 0.35);
  const pageWidth = useTransform(() => viewport.get().width);
  const pageHeight = useTransform(() => viewport.get().height);
  const faceWidth = useTransform(() => card.get()?.width ?? viewport.get().width);

  useEffect(() => {
    const resize = () => viewport.set({ width: innerWidth, height: innerHeight });
    addEventListener('resize', resize);
    return () => removeEventListener('resize', resize);
  }, [viewport]);

  useLayoutEffect(() => {
    let active = true;
    if (reduced) {
      progress.jump(isPresent ? 1 : 0);
      fade.jump(isPresent ? 1 : 0);
      if (isPresent) setSettled(true);
      else safeToRemove?.();
      return;
    }
    if (isPresent && origin) setTaskCardHidden(task.id, true);
    const cancel = afterPaint(() => {
      if (!isPresent) {
        // Trash and status changes have had a paint to remove or reposition the landing card.
        const landing = measureTaskCard(task.id);
        card.set(landing);
        if (landing) {
          setFaceStatus(landing.showStatus);
          setTaskCardHidden(task.id, true);
        }
      }
      const curve = isPresent ? curves.expand : curves.collapse;
      const animations = [
        animateSteady(progress, isPresent ? 1 : 0, curve),
        animateSteady(dragY, 0, curve),
      ];
      if (!card.get()) animations.push(animateSteady(fade, isPresent ? 1 : 0, curve));
      void Promise.all(animations).then(() => {
        if (!active) return;
        if (isPresent) setSettled(true);
        else {
          setTaskCardHidden(task.id, false);
          safeToRemove?.();
        }
      });
    });
    const follow = () => {
      if (!isPresent && card.get()) card.set(measureTaskCard(task.id));
    };
    document.addEventListener('scroll', follow, { capture: true, passive: true });
    return () => {
      active = false;
      cancel();
      stopSteady(progress);
      stopSteady(fade);
      stopSteady(dragY);
      document.removeEventListener('scroll', follow, true);
    };
  }, [isPresent, reduced, origin, task.id, card, progress, dragY, fade, safeToRemove]);

  useEffect(() => () => setTaskCardHidden(task.id, false), [task.id]);

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
        <motion.div
          data-task-surface=""
          data-color={taskColor(project, task) ?? undefined}
          className="pointer-events-auto absolute top-0 left-0 overflow-hidden bg-[var(--tint,var(--card))] shadow-xl"
          style={{ x, y, width, height, borderRadius, scale, opacity, transformOrigin: 'center' }}
        >
          <motion.div
            className="flex flex-col"
            style={{ width: pageWidth, height: pageHeight, opacity: textOpacity }}
          >
            <TaskScrollContext.Provider value={attachScroll}>
              <TaskEditorReadyContext.Provider value={settled}>
                {content.body(task.id)}
              </TaskEditorReadyContext.Provider>
            </TaskScrollContext.Provider>
          </motion.div>
          <motion.div
            aria-hidden
            className="pointer-events-none absolute top-0 left-0"
            style={{ width: faceWidth, opacity: faceOpacity }}
          >
            <TaskCardFace project={project} task={task} showStatus={faceStatus} />
          </motion.div>
        </motion.div>
      </section>
    </>
  );
}
