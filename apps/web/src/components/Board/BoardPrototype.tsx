import { AnimatePresence } from 'motion/react';
import { useEffect, useLayoutEffect, useState } from 'react';
import { useMedia } from '@/lib/media';
import { BoardAnnouncer } from './BoardAnnouncer';
import { putBack } from './carry';
import { DesktopBoard } from './DesktopBoard';
import { DragOverlay } from './DragOverlay';
import { configureDrag, drag } from './drag';
import { mockBoards } from './mockData';
import { PhoneBoard } from './PhoneBoard';
import { board, current, initialBoard, update, useBoardSettings } from './state';
import { TaskScreen } from './TaskView';

/**
 * The project board on mock data.
 * It brings its own frame and leaves the app shell alone.
 */
export function BoardPrototype() {
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    board.set(initialBoard(mockBoards()));
    setReady(true);
  }, []);
  const reset = () => board.set(initialBoard(mockBoards()));
  const phone = useMedia('(max-width: 767px)');
  const state = board.use();
  const [settings] = useBoardSettings();
  configureDrag({ heldColumn: settings.heldColumn });

  useEffect(() => {
    document.documentElement.toggleAttribute('data-hide-scrollbars', !settings.scrollbars);
    return () => document.documentElement.removeAttribute('data-hide-scrollbars');
  }, [settings.scrollbars]);
  const openTask = state.boards.length
    ? current(state).tasks.find((task) => task.id === state.openTaskId)
    : undefined;

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

  if (!ready) return null;
  return (
    <>
      <div className="h-dvh">
        {phone ? <PhoneBoard onReset={reset} /> : <DesktopBoard onReset={reset} />}
      </div>
      <AnimatePresence>
        {phone && openTask && <TaskScreen key="task" task={openTask} />}
      </AnimatePresence>
      <DragOverlay />
      <BoardAnnouncer />
    </>
  );
}
