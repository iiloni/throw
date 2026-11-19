import type { Project } from '@throw/shared';
import { AnimatePresence } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { ShellMenu } from '@/components/AppShell/ShellMenu';
import { useShell } from '@/components/AppShell/shell';
import { SyncIndicator } from '@/components/SyncIndicator/SyncIndicator';
import { type TaskPanel, taskDrawerContent } from '@/components/TaskDetails/TaskControls';
import { TaskDetails } from '@/components/TaskDetails/TaskDetails';
import { useProjectTaskTags, useStatuses, useTags, useTasks } from '@/lib/collections';
import { useDesktop } from '@/lib/media';
import { useAwaitingSync } from '@/lib/syncStatus';
import { createTask } from '@/lib/tasks';
import { BoardAnnouncer } from './BoardAnnouncer';
import { taskScreens, taskWrites, useBoardBoundary } from './boundary';
import { DesktopBoard } from './DesktopBoard';
import { DragOverlay } from './DragOverlay';
import { PhoneBoard } from './PhoneBoard';
import { projectBoardData, secondaryTagsByTask } from './selection';
import { board, update } from './state';
import { TaskScreen } from './TaskView';
import { TaskContentContext } from './taskContent';

/** Only this boundary knows collections and writes; the prototype shares the whole board. */
export function ProjectBoard({
  project,
  initialTaskId,
}: {
  project: Project;
  initialTaskId?: string;
}) {
  const shell = useShell();
  const { statuses, isLoading: loadingStatuses } = useStatuses();
  const { tasks, isLoading: loadingTasks } = useTasks();
  const { tags } = useTags(project.id);
  const taskTags = useProjectTaskTags(project.id);
  const secondaryTags = useMemo(() => secondaryTagsByTask(taskTags), [taskTags]);
  const phone = !useDesktop();
  const state = board.use();
  const data = useMemo(
    () => projectBoardData(project, statuses, tasks, tags, secondaryTags),
    [project, statuses, tasks, tags, secondaryTags],
  );
  const awaiting = useAwaitingSync(loadingStatuses, data.project.statuses.length);
  const awaitingTasks = useAwaitingSync(loadingTasks, data.tasks.length);
  // The open task's page in the phone drawer belongs to that task alone.
  const [taskPage, setTaskPage] = useState<{ taskId: string; panel: TaskPanel } | null>(null);
  if (taskPage && taskPage.taskId !== state.openTaskId) setTaskPage(null);
  const actions = useMemo(
    () => ({
      ...taskWrites,
      create: (statusId?: string) => createTask(project.id, { statusId, title: 'New task' }),
    }),
    [project.id],
  );
  useBoardBoundary(data, actions, awaitingTasks);
  const linkedTaskExists = tasks.some(
    (task) => task.projectId === project.id && task.id === initialTaskId,
  );
  useEffect(() => {
    if (initialTaskId && linkedTaskExists) update({ openTaskId: initialTaskId });
  }, [initialTaskId, linkedTaskExists]);
  if (awaiting || state.projectId !== project.id || state.actions === null)
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
  const openRow = phone ? tasks.find((row) => row.id === openTask?.id) : undefined;
  const taskContent = {
    drawer:
      openRow &&
      taskDrawerContent({
        task: openRow,
        statuses: statuses.filter((row) => row.projectId === project.id),
        project: data.project,
        page: taskPage?.panel ?? null,
        onPage: (panel) => setTaskPage(panel && { taskId: openRow.id, panel }),
      }),
    body: (id: string) => {
      const task = tasks.find((row) => row.id === id);
      return (
        task && (
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
        {!phone && <h1 className="sr-only">{project.name}</h1>}
        {phone ? (
          <PhoneBoard
            projectMenu={
              <h1 aria-label={project.name} className="min-w-0">
                <ShellMenu phone titleClassName="text-[1.75rem]" />
              </h1>
            }
            syncIndicator={<SyncIndicator />}
            onBacklogChange={(open) =>
              shell.selectProject(project.workspaceId, project.id, open ? 'backlog' : 'board', true)
            }
            initialBacklog={shell.view === 'backlog'}
            palette
          />
        ) : (
          <DesktopBoard />
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
