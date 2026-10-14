import { AnimatePresence } from 'motion/react';
import { useEffect } from 'react';
import { useMedia } from '@/lib/media';
import { putBack } from './carry';
import { DesktopBoard } from './DesktopBoard';
import { DragOverlay } from './DragOverlay';
import { configureDrag, drag } from './drag';
import { PhoneBoard } from './PhoneBoard';
import { board, current, update, useBoardSettings } from './state';
import { TaskSheet } from './TaskView';

/**
 * The project board on mock data.
 * It brings its own frame and leaves the app shell alone.
 */
export function BoardPrototype() {
  const phone = useMedia('(max-width: 767px)');
  const state = board.use();
  const [settings] = useBoardSettings();
  configureDrag({ heldColumn: settings.heldColumn });

  useEffect(() => {
    document.documentElement.toggleAttribute('data-hide-scrollbars', !settings.scrollbars);
    return () => document.documentElement.removeAttribute('data-hide-scrollbars');
  }, [settings.scrollbars]);
  const openTask = current(state).tasks.find((task) => task.id === state.openTaskId);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented || drag.get()) return;
      if (document.querySelector('[role="menu"], [role="dialog"]')) return;
      const { carrying, selection, openTaskId } = board.get();
      if (carrying) putBack();
      else if (selection.length > 0) update({ selection: [] });
      else if (openTaskId) update({ openTaskId: null });
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      {phone ? <PhoneBoard /> : <DesktopBoard />}
      <AnimatePresence>
        {phone && openTask && <TaskSheet key="task" task={openTask} />}
      </AnimatePresence>
      <DragOverlay />
      <p aria-live="assertive" className="sr-only">
        {state.announcement}
      </p>
    </>
  );
}
