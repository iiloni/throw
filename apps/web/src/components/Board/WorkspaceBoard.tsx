import type { Project as ProjectRow } from '@throw/shared';
import { AnimatePresence } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ShellMenu } from '@/components/AppShell/ShellMenu';
import { SyncIndicator } from '@/components/SyncIndicator/SyncIndicator';
import { type TaskPanel, taskDrawerContent } from '@/components/TaskDetails/TaskControls';
import { TaskDetails } from '@/components/TaskDetails/TaskDetails';
import { useAllTags, useStatuses, useTasks } from '@/lib/collections';
import { flushTaskDescription } from '@/lib/descriptionEditing';
import { useMedia } from '@/lib/media';
import { useAwaitingSync } from '@/lib/syncStatus';
import { moveTask, sendTask, updateTask } from '@/lib/tasks';
import { BoardAnnouncer } from './BoardAnnouncer';
import { putBack } from './carry';
import { DragOverlay } from './DragOverlay';
import { configureDrag, drag } from './drag';
import type { Place } from './model';
import { workspaceBoardData } from './selection';
import { board, leaveTask, receiveBoard, update, useBoardSettings } from './state';
import { TaskScreen } from './TaskView';
import { TaskContentContext } from './taskContent';
import { WorkspaceDesktopBoard } from './WorkspaceDesktopBoard';
import { WorkspacePhoneBoard } from './WorkspacePhoneBoard';

/**
 * The same array while it holds the same rows. The shell filters its projects afresh on each
 * render, and the board re-adapting on each would render the shell again.
 */
function useSameRows<T>(rows: T[]): T[] {
  const last = useRef(rows);
  if (rows.length !== last.current.length || rows.some((row, index) => row !== last.current[index]))
    last.current = rows;
  return last.current;
}

function attempt(write: () => void) {
  try {
    write();
    return true;
  } catch {
    return false;
  }
}

/**
 * Every project of a workspace on one board, adapted at this boundary as the project board
 * is: one column per category, cards in their project's colour, and moves that go to each
 * card's own project's statuses (spec, "The cross-project board").
 */
export function WorkspaceBoard({
  workspaceId,
  projects: given,
  onCreate,
  onSearch,
}: {
  workspaceId: string;
  projects: ProjectRow[];
  onCreate: () => void;
  onSearch: () => void;
}) {
  const projects = useSameRows(given);
  const { statuses, isLoading: loadingStatuses } = useStatuses();
  const { tasks, isLoading: loadingTasks } = useTasks();
  const { tags } = useAllTags();
  const phone = useMedia('(max-width: 767px)');
  const state = board.use();
  const [settings] = useBoardSettings();
  configureDrag({ heldColumn: settings.heldColumn });
  const data = useMemo(
    () => workspaceBoardData(workspaceId, projects, statuses, tasks, tags),
    [workspaceId, projects, statuses, tasks, tags],
  );
  const awaiting = useAwaitingSync(loadingStatuses, data.project.statuses.length);
  const awaitingTasks = useAwaitingSync(loadingTasks, data.tasks.length);
  const [taskPage, setTaskPage] = useState<{ taskId: string; panel: TaskPanel } | null>(null);
  if (taskPage && taskPage.taskId !== state.openTaskId) setTaskPage(null);
  const actions = useMemo(
    () => ({
      beforeLeave: flushTaskDescription,
      // New work is captured into a project through the palette, which asks which one.
      create: () => {
        onCreate();
        return null;
      },
      rename: (id: string, title: string) => updateTask(id, { title }),
      place: (id: string, place: Place) => attempt(() => moveTask(id, place)),
      send: (ids: string[], statusId: string) =>
        [...ids]
          .reverse()
          .map((id) => attempt(() => sendTask(id, statusId)))
          .every(Boolean),
    }),
    [onCreate],
  );
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
  if (awaiting || state.projectId !== data.project.id || state.actions === null)
    return (
      <p role="status" className="p-6 text-muted-foreground">
        Loading board…
      </p>
    );
  if (data.project.statuses.length === 0)
    return (
      <p role="status" className="p-6 text-muted-foreground">
        Connect to load this board on this device.
      </p>
    );
  const findTask = (id: string | null) =>
    [...data.tasks, ...(data.hiddenTasks ?? [])].find((task) => task.id === id);
  const openTask = findTask(state.openTaskId);
  const screens = openTask
    ? [...state.taskTrail.map(findTask), openTask].filter((task) => task !== undefined)
    : [];
  const rowOf = (id: string | undefined) => tasks.find((row) => row.id === id);
  const projectRow = (projectId: string | undefined) =>
    projects.find((project) => project.id === projectId);
  const openRow = phone ? rowOf(openTask?.id) : undefined;
  const openProject = data.project.members?.find((member) => member.id === openRow?.projectId);
  const taskContent = {
    drawer:
      openRow &&
      openProject &&
      taskDrawerContent({
        task: openRow,
        statuses: statuses.filter((row) => row.projectId === openRow.projectId),
        project: openProject,
        page: taskPage?.panel ?? null,
        onPage: (panel) => setTaskPage(panel && { taskId: openRow.id, panel }),
      }),
    body: (id: string) => {
      const task = rowOf(id);
      const project = projectRow(task?.projectId);
      return (
        task &&
        project && (
          <TaskDetails
            key={id}
            task={task}
            project={project}
            statuses={statuses.filter((row) => row.projectId === project.id)}
            tasks={tasks.filter((row) => row.projectId === project.id)}
            phone={phone}
          />
        )
      );
    },
  };
  return (
    <TaskContentContext.Provider value={taskContent}>
      <div className="relative h-full" aria-busy={awaitingTasks}>
        {!phone && <h1 className="sr-only">All projects</h1>}
        {phone ? (
          <WorkspacePhoneBoard
            title={
              <h1 aria-label="All projects" className="min-w-0">
                <ShellMenu phone titleClassName="text-[1.75rem]" />
              </h1>
            }
            syncIndicator={<SyncIndicator />}
            onSearch={onSearch}
            onCreate={onCreate}
          />
        ) : (
          <WorkspaceDesktopBoard />
        )}
        <AnimatePresence>
          {phone &&
            screens.map((task) => (
              <TaskScreen key={task.id} task={task} covered={task !== openTask} />
            ))}
        </AnimatePresence>
        <DragOverlay />
        <BoardAnnouncer />
      </div>
    </TaskContentContext.Provider>
  );
}
