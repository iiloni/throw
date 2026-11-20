import { useEffect, useLayoutEffect } from 'react';
import { flushTaskDescription } from '@/lib/descriptionEditing';
import { discardUntouchedTask, moveTask, sendTask, updateTask } from '@/lib/tasks';
import { putBack } from './carry';
import { configureDrag, drag } from './drag';
import type { BoardData, Place } from './model';
import {
  type BoardActions,
  type BoardState,
  board,
  leaveTask,
  receiveBoard,
  update,
  useBoardSettings,
} from './state';

function attempt(write: () => void) {
  try {
    write();
    return true;
  } catch {
    return false;
  }
}

/** The writes a board makes the same way whichever tasks it shows. */
export const taskWrites = {
  beforeLeave: flushTaskDescription,
  discard: (id: string) => void attempt(() => discardUntouchedTask(id)),
  rename: (id: string, title: string) => updateTask(id, { title }),
  // A task purged or a status deleted on another device cannot be moved to; the board
  // falls back to what sync has.
  place: (id: string, place: Place) => attempt(() => moveTask(id, place)),
  send: (ids: string[], statusId: string) =>
    // Last first, so the first lands on top. Every card is tried, whichever fail.
    [...ids]
      .reverse()
      .map((id) => attempt(() => sendTask(id, statusId)))
      .every(Boolean),
} satisfies Omit<BoardActions, 'create'>;

/**
 * What a board's boundary does around the data it adapts: hands it to the board, applies the
 * device's board settings, and lets Escape put back, deselect or close, in that order.
 */
export function useBoardBoundary(data: BoardData, actions: BoardActions, awaitingTasks: boolean) {
  const [settings] = useBoardSettings();
  configureDrag({ heldColumn: settings.heldColumn });
  useLayoutEffect(() => {
    receiveBoard(data, actions, awaitingTasks);
  }, [data, actions, awaitingTasks]);
  useEffect(() => {
    document.documentElement.toggleAttribute('data-hide-scrollbars', !settings.scrollbars);
    return () => document.documentElement.removeAttribute('data-hide-scrollbars');
  }, [settings.scrollbars]);
  useEffect(() => {
    function close(event: KeyboardEvent) {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        drag.get() ||
        document.querySelector('[role="menu"], [role="dialog"]')
      )
        return;
      const { carrying, selection } = board.get();
      if (carrying) putBack();
      else if (selection.length > 0) update({ selection: [] });
      else leaveTask();
    }
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);
}

/**
 * The open task and the trail it was opened along. A subtask opened from its parent's pane
 * covers that pane, which stays to go back to.
 */
export function taskScreens(data: BoardData, state: BoardState) {
  const findTask = (id: string | null) =>
    [...data.tasks, ...(data.hiddenTasks ?? [])].find((task) => task.id === id);
  const openTask = findTask(state.openTaskId);
  const screens = openTask
    ? [...state.taskTrail.map(findTask), openTask].filter((task) => task !== undefined)
    : [];
  return { openTask, screens };
}
