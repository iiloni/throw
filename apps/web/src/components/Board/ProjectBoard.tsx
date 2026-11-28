import type { Project } from '@throw/shared';
import { AnimatePresence } from 'motion/react';
import { useMemo, useState } from 'react';
import { ShellMenu } from '@/components/AppShell/ShellMenu';
import { useShell } from '@/components/AppShell/shell';
import { useSelectionContent } from '@/components/BulkActions/BulkActions';
import { DependencyGraph } from '@/components/DependencyGraph/DependencyGraph';
import { SyncIndicator } from '@/components/SyncIndicator/SyncIndicator';
import { type TaskPanel, taskDrawerContent } from '@/components/TaskDetails/TaskControls';
import { TaskDetails } from '@/components/TaskDetails/TaskDetails';
import { useBlockersByTask } from '@/components/TaskRelations/TaskRelations';
import {
  useActivity,
  useGithubReleases,
  useLocalRowsReady,
  useProjects,
  useProjectTaskTags,
  useStatuses,
  useTags,
  useTaskGithubLinks,
  useTaskGithubReleases,
  useTaskRelations,
  useTasks,
} from '@/lib/collections';
import { pullRequestsByTask, useShownGithubLinks } from '@/lib/githubLinks';
import { boardReleases } from '@/lib/githubReleases';
import { useLaunchScreenReady } from '@/lib/launchScreen';
import { useDesktop } from '@/lib/media';
import { useAwaitingSync } from '@/lib/syncStatus';
import { createTask } from '@/lib/tasks';
import { BoardAnnouncer } from './BoardAnnouncer';
import { boardRelations, TaskBlockersContext } from './blockers';
import { taskScreens, taskWrites, useBoardBoundary } from './boundary';
import { DesktopBoard } from './DesktopBoard';
import { DragOverlay } from './DragOverlay';
import { TaskPullRequestsContext } from './githubLinks';
import { PhoneBoard } from './PhoneBoard';
import { projectBoardData, secondaryTagsByTask, updatedAtByTask } from './selection';
import { board, canOpenTask } from './state';
import { TaskScreen } from './TaskView';
import { SelectionContentContext, TaskContentContext } from './taskContent';
import { useTaskUrl } from './taskUrl';

/** Only this boundary knows collections and writes; the prototype shares the whole board. */
export function ProjectBoard({
  project,
  task,
}: {
  project: Project;
  /** The task in the URL's `task` parameter. */
  task?: string;
}) {
  const shell = useShell();
  const { statuses, isLoading: loadingStatuses } = useStatuses();
  const { tasks, isLoading: loadingTasks } = useTasks();
  const { tags } = useTags(project.id);
  const taskTags = useProjectTaskTags(project.id);
  const secondaryTags = useMemo(() => secondaryTagsByTask(taskTags), [taskTags]);
  const activity = useActivity();
  const updates = useMemo(() => updatedAtByTask(activity), [activity]);
  const phone = !useDesktop();
  const blockers = useBlockersByTask();
  const { relations } = useTaskRelations();
  const { links: githubLinks } = useTaskGithubLinks();
  const shownGithub = useShownGithubLinks(githubLinks);
  const pulls = useMemo(() => pullRequestsByTask(shownGithub), [shownGithub]);
  const { releases } = useGithubReleases();
  const { bindings } = useTaskGithubReleases();
  const { projects: allProjects } = useProjects();
  const linked = useMemo(
    () => boardRelations(blockers, relations, tasks, allProjects),
    [blockers, relations, tasks, allProjects],
  );
  const selectionContent = useSelectionContent();
  const state = board.use();
  const data = useMemo(() => {
    const own = projectBoardData(project, statuses, tasks, tags, secondaryTags, updates);
    return {
      ...own,
      relations: linked,
      releases: boardReleases(
        own.tasks.map((row) => row.id),
        releases,
        bindings,
        shownGithub,
      ),
    };
  }, [
    project,
    statuses,
    tasks,
    tags,
    secondaryTags,
    updates,
    linked,
    releases,
    bindings,
    shownGithub,
  ]);
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
  // Whether the board holds this page's data, and whether its tasks have caught up.
  const ready = state.projectId === project.id && state.actions !== null && !awaitingTasks;
  useTaskUrl(task, ready, !loadingTasks);
  const localReady = useLocalRowsReady(
    'workspaces',
    'projects',
    'statuses',
    'tasks',
    'tags',
    'task-tags',
    'task-relations',
  );
  const linkedTask = task && canOpenTask(task, data);
  useLaunchScreenReady(
    localReady &&
      !awaiting &&
      state.projectId === data.project.id &&
      state.actions !== null &&
      (!linkedTask || state.openTaskId === task),
  );
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
            drawerPage={taskPage?.taskId === id}
          />
        )
      );
    },
  };
  return (
    <TaskContentContext.Provider value={taskContent}>
      <TaskBlockersContext.Provider value={blockers}>
        <TaskPullRequestsContext.Provider value={pulls}>
          <SelectionContentContext.Provider value={selectionContent}>
            <div className="relative h-full" aria-busy={awaitingTasks}>
              {!phone && <h1 className="sr-only">{project.name}</h1>}
              {shell.view === 'graph' ? (
                <DependencyGraph
                  phone={phone}
                  title={
                    <h1 aria-label={project.name} className="min-w-0">
                      <ShellMenu phone titleClassName="text-[1.75rem]" />
                    </h1>
                  }
                  syncIndicator={<SyncIndicator />}
                />
              ) : phone ? (
                <PhoneBoard
                  projectMenu={
                    <h1 aria-label={project.name} className="min-w-0">
                      <ShellMenu phone titleClassName="text-[1.75rem]" />
                    </h1>
                  }
                  syncIndicator={<SyncIndicator />}
                  onBacklogChange={(open) =>
                    shell.selectProject(
                      project.workspaceId,
                      project.id,
                      open ? 'backlog' : 'board',
                      true,
                    )
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
          </SelectionContentContext.Provider>
        </TaskPullRequestsContext.Provider>
      </TaskBlockersContext.Provider>
    </TaskContentContext.Provider>
  );
}
