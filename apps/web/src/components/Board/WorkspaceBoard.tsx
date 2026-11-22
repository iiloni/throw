import type { Project as ProjectRow } from '@throw/shared';
import { AnimatePresence } from 'motion/react';
import { useMemo, useRef, useState } from 'react';
import { ShellMenu } from '@/components/AppShell/ShellMenu';
import { SyncIndicator } from '@/components/SyncIndicator/SyncIndicator';
import { type TaskPanel, taskDrawerContent } from '@/components/TaskDetails/TaskControls';
import { TaskDetails } from '@/components/TaskDetails/TaskDetails';
import { useBlockersByTask } from '@/components/TaskRelations/TaskRelations';
import { useAllTags, useAllTaskTags, useStatuses, useTasks } from '@/lib/collections';
import { useDesktop } from '@/lib/media';
import { useAwaitingSync } from '@/lib/syncStatus';
import { BoardAnnouncer } from './BoardAnnouncer';
import { TaskBlockersContext } from './blockers';
import { taskScreens, taskWrites, useBoardBoundary } from './boundary';
import { DragOverlay } from './DragOverlay';
import { secondaryTagsByTask, workspaceBoardData } from './selection';
import { board } from './state';
import { TaskScreen } from './TaskView';
import { TaskContentContext } from './taskContent';
import { useTaskUrl } from './taskUrl';
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

/**
 * Every project of a workspace on one board, adapted at this boundary as the project board
 * is: one column per category, cards in their project's color, and moves that go to each
 * card's own project's statuses (spec, "The cross-project board").
 */
export function WorkspaceBoard({
  workspaceId,
  projects: given,
  task,
  onCreate,
  onSearch,
}: {
  workspaceId: string;
  projects: ProjectRow[];
  /** The task in the URL's `task` parameter. */
  task?: string;
  onCreate: () => void;
  onSearch: () => void;
}) {
  const projects = useSameRows(given);
  const { statuses, isLoading: loadingStatuses } = useStatuses();
  const { tasks, isLoading: loadingTasks } = useTasks();
  const { tags } = useAllTags();
  const { taskTags } = useAllTaskTags();
  const secondaryTags = useMemo(() => secondaryTagsByTask(taskTags), [taskTags]);
  const phone = !useDesktop();
  const blockers = useBlockersByTask();
  const state = board.use();
  const data = useMemo(
    () => workspaceBoardData(workspaceId, projects, statuses, tasks, tags, secondaryTags),
    [workspaceId, projects, statuses, tasks, tags, secondaryTags],
  );
  const awaiting = useAwaitingSync(loadingStatuses, data.project.statuses.length);
  const awaitingTasks = useAwaitingSync(loadingTasks, data.tasks.length);
  const [taskPage, setTaskPage] = useState<{ taskId: string; panel: TaskPanel } | null>(null);
  if (taskPage && taskPage.taskId !== state.openTaskId) setTaskPage(null);
  // New work is captured through the palette, which asks which project it belongs to.
  useBoardBoundary(data, taskWrites, awaitingTasks);
  // Whether the board holds this page's data, and whether its tasks have caught up.
  const ready = state.projectId === data.project.id && state.actions !== null && !awaitingTasks;
  useTaskUrl(task, ready, !loadingTasks);
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
  const { openTask, screens } = taskScreens(data, state);
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
      <TaskBlockersContext.Provider value={blockers}>
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
      </TaskBlockersContext.Provider>
    </TaskContentContext.Provider>
  );
}
