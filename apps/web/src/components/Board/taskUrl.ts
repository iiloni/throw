import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { board, update } from './state';

/** The task whose opening pushed a history entry in this session, as Catch does for notes. */
let pushedTaskId: string | null = null;

const taskInUrl = () => new URLSearchParams(window.location.search).get('task');

/**
 * Keeps the open task in the `task` search parameter, so a reload reopens it, browser Back
 * closes it and a link opens it. Opening pushes one history entry; switching tasks (a
 * subtask, its parent) replaces it, so Back closes the task in one step. Closing goes back
 * over that entry rather than pushing a task-less one. Both directions compare live values,
 * since the board resets its open task when its data first arrives.
 */
export function useTaskUrl(
  task: string | undefined,
  ready: boolean,
  exists: (id: string) => boolean,
) {
  const navigate = useNavigate();
  const shown = board.use().openTaskId;
  const latestExists = useRef(exists);
  latestExists.current = exists;

  // The URL, from a link, a reload or history, opens or closes the task.
  useEffect(() => {
    if (!ready) return;
    const { openTaskId: open } = board.get();
    if (task === undefined) {
      if (open) update({ openTaskId: null, taskTrail: [] });
      return;
    }
    if (task === open) return;
    if (latestExists.current(task)) {
      update({ openTaskId: task });
      return;
    }
    toast('That task is not available', {
      description: 'It may have been deleted, or it belongs to another project.',
    });
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({ ...prev, task: undefined }),
      replace: true,
      resetScroll: false,
    } as never);
  }, [task, ready, navigate]);

  // Opening, switching and closing on the board write the URL.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the board's open task changes.
  useEffect(() => {
    if (!ready) return;
    // Live, not the render's value: the effect above may have just opened the URL's task.
    const { openTaskId } = board.get();
    const current = taskInUrl();
    if (openTaskId === current) return;
    if (openTaskId === null) {
      if (current && current === pushedTaskId) {
        pushedTaskId = null;
        window.history.back();
        return;
      }
      void navigate({
        to: '.',
        search: (prev: Record<string, unknown>) => ({ ...prev, task: undefined }),
        replace: true,
        resetScroll: false,
      } as never);
      return;
    }
    if (current) {
      if (current === pushedTaskId) pushedTaskId = openTaskId;
    } else pushedTaskId = openTaskId;
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({ ...prev, task: openTaskId }),
      replace: Boolean(current),
      resetScroll: false,
    } as never);
  }, [shown, ready, navigate]);
}
