import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { board, canOpenTask, update } from './state';

/** The task whose opening pushed a history entry in this session, as Catch does for notes. */
let pushedTaskId: string | null = null;

const NOTHING = Symbol('nothing written');

const taskInUrl = () => new URLSearchParams(window.location.search).get('task') ?? undefined;

/**
 * Keeps the open task in the `task` search parameter, so a reload reopens it, browser Back
 * closes it and a link opens it. Opening pushes one history entry; switching tasks (a
 * subtask, its parent) replaces it, so Back closes the task in one step, and closing goes
 * back over that entry rather than pushing a task-less one.
 *
 * Each direction acts only on its own changes: the URL's task opening, switching or going
 * away, and the board's open task doing the same. `ready` is the board holding this page's
 * data; `synced` is the tasks having caught up with the server, before which a linked task
 * that is not here yet may still arrive.
 */
export function useTaskUrl(task: string | undefined, ready: boolean, synced: boolean) {
  const navigate = useNavigate();
  const open = board.use().openTaskId;
  const linked = task !== undefined && ready && canOpenTask(task);
  const seenTask = useRef(task);
  const seenOpen = useRef<string | null>(null);
  /** What the board last wrote to the URL, until the router has taken it in. */
  const written = useRef<string | undefined | typeof NOTHING>(NOTHING);

  const setTaskParam = useCallback(
    (value: string | undefined, replace: boolean) =>
      void navigate({
        to: '.',
        search: (prev: Record<string, unknown>) => ({ ...prev, task: value }),
        replace,
        resetScroll: false,
        // The board routes declare `task`; `to: '.'` keeps whichever one this is.
      } as unknown as Parameters<typeof navigate>[0]),
    [navigate],
  );

  // The URL, from a link, a reload or history, opens or closes the task.
  useEffect(() => {
    if (!ready) return;
    const before = seenTask.current;
    seenTask.current = task;
    // A value the router is still committing while a newer one is already in the address
    // bar: the board chose again meanwhile, so this one is not a request.
    if (task !== taskInUrl()) return;
    // The board moved on and the router has yet to take it in: the URL still names the task it
    // left, which may already be gone (a new subtask discarded as it was left).
    if (written.current !== NOTHING) {
      if (task !== written.current) return;
      written.current = NOTHING;
    }
    const { openTaskId } = board.get();
    if (task === undefined) {
      // Only the task leaving the URL (Back) closes it; a page without one leaves alone a
      // task opened another way, such as from search.
      if (before === undefined || openTaskId === null) return;
      update({ openTaskId: null, taskTrail: [] });
      // A task that cannot be left yet (its description could not be saved) stays, and so
      // does its entry.
      if (board.get().openTaskId !== null) {
        pushedTaskId = board.get().openTaskId;
        setTaskParam(pushedTaskId ?? undefined, false);
      }
      return;
    }
    if (task === openTaskId) return;
    if (linked) {
      update({ openTaskId: task });
      return;
    }
    // Not here yet: wait for sync, which runs this again once the task arrives or the
    // tasks have caught up. Offline, the link simply waits.
    if (!synced) return;
    toast('That task is not available', { description: 'It may have been deleted.' });
    if (pushedTaskId === task) pushedTaskId = null;
    setTaskParam(undefined, true);
  }, [task, ready, linked, synced, setTaskParam]);

  // Opening, switching and closing on the board write the URL.
  useEffect(() => {
    if (!ready || open === seenOpen.current) return;
    seenOpen.current = open;
    const current = taskInUrl();
    if ((open ?? undefined) === current) return;
    if (open === null) {
      written.current = undefined;
      if (current && current === pushedTaskId) {
        pushedTaskId = null;
        window.history.back();
      } else setTaskParam(undefined, true);
      return;
    }
    if (!current) pushedTaskId = open;
    else if (current === pushedTaskId) pushedTaskId = open;
    written.current = open;
    setTaskParam(open, Boolean(current));
  }, [open, ready, setTaskParam]);
}
