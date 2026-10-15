import type { Project } from '@throw/shared';
import { Search } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { ShellMenu } from '@/components/AppShell/ShellMenu';
import { useShell } from '@/components/AppShell/shell';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { SyncIndicator } from '@/components/SyncIndicator/SyncIndicator';
import { TaskDetails } from '@/components/TaskDetails/TaskDetails';
import { Button } from '@/components/ui/button';
import { useStatuses, useTags, useTasks } from '@/lib/collections';
import { flushTaskDescription } from '@/lib/descriptionEditing';
import { useMedia } from '@/lib/media';
import { useAwaitingSync } from '@/lib/syncStatus';
import { createTask, sendTask, updateTask } from '@/lib/tasks';
import { DesktopBoard } from './DesktopBoard';
import { PhoneBoard } from './PhoneBoard';
import { projectBoardData } from './selection';
import { board, receiveBoard, update, useBoardSettings } from './state';
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
  const phone = useMedia('(max-width: 767px)');
  const state = board.use();
  const [settings] = useBoardSettings();
  const data = useMemo(
    () => projectBoardData(project, statuses, tasks, tags),
    [project, statuses, tasks, tags],
  );
  const awaiting = useAwaitingSync(loadingStatuses, data.project.statuses.length);
  const awaitingTasks = useAwaitingSync(loadingTasks, data.tasks.length);
  const actions = useMemo(
    () => ({
      beforeLeave: flushTaskDescription,
      create: (statusId?: string) => createTask(project.id, { statusId, title: 'New task' }),
      rename: (id: string, title: string) => updateTask(id, { title }),
      send: (ids: string[], statusId: string) => {
        for (const id of [...ids].reverse()) sendTask(id, statusId);
      },
    }),
    [project.id],
  );
  useLayoutEffect(() => {
    receiveBoard(data, actions, awaitingTasks);
  }, [data, actions, awaitingTasks]);
  const linkedTaskExists = tasks.some(
    (task) => task.projectId === project.id && task.id === initialTaskId,
  );
  useEffect(() => {
    if (initialTaskId && linkedTaskExists) update({ openTaskId: initialTaskId });
  }, [initialTaskId, linkedTaskExists]);
  useEffect(() => {
    document.documentElement.toggleAttribute('data-hide-scrollbars', !settings.scrollbars);
    return () => document.documentElement.removeAttribute('data-hide-scrollbars');
  }, [settings.scrollbars]);
  useEffect(() => {
    function close(event: KeyboardEvent) {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !document.querySelector('[role="menu"], [role="dialog"]')
      )
        update({ openTaskId: null });
    }
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);
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
  const openTask = [...data.tasks, ...(data.hiddenTasks ?? [])].find(
    (task) => task.id === state.openTaskId,
  );
  const taskContent = {
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
            searchContent={
              shell.view === 'search' ? (
                <EmptyState icon={Search} title="Search">
                  Search will help you find work across this workspace.
                  <Button
                    className="mt-4"
                    variant="ghost"
                    onClick={() =>
                      shell.selectProject(project.workspaceId, project.id, 'board', true)
                    }
                  >
                    Back to the board
                  </Button>
                </EmptyState>
              ) : undefined
            }
            onBacklogChange={(open) =>
              shell.selectProject(project.workspaceId, project.id, open ? 'backlog' : 'board', true)
            }
            onReturnBoard={() => {
              if (shell.view === 'search')
                shell.selectProject(project.workspaceId, project.id, 'board', true);
            }}
            initialBacklog={shell.view === 'backlog'}
            onSearch={() => shell.selectProject(project.workspaceId, project.id, 'search', true)}
          />
        ) : (
          <DesktopBoard />
        )}
        <AnimatePresence>
          {phone && openTask && <TaskScreen key={openTask.id} task={openTask} />}
        </AnimatePresence>
      </div>
    </TaskContentContext.Provider>
  );
}
