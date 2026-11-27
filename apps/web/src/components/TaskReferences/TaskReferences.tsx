import type { Task } from '@throw/shared';
import { createContext, type ReactNode, useCallback, useContext, useMemo } from 'react';
import { ShellContext } from '@/components/AppShell/shell';
import { canOpenTask, openSubtask } from '@/components/Board/state';
import {
  useAllTags,
  useAllTaskTags,
  useProjects,
  useStatuses,
  useTaskRelations,
  useTasks,
} from '@/lib/collections';
import { buildReferenceIndex, type TaskReferenceIndex } from './referenceIndex';

/** Provided by `TaskReferencesProvider`; tests hand it an index of their own. */
export const TaskReferenceIndexContext = createContext<TaskReferenceIndex | null>(null);
const ScopeContext = createContext<string | null>(null);

/**
 * The shell's one index of task identifiers, rebuilt when a synced row changes. Editors and
 * previews below it draw `#KEY-N` as links; without it (the prototype) references stay text.
 */
export function TaskReferencesProvider({ children }: { children: ReactNode }) {
  const { tasks } = useTasks();
  const { projects } = useProjects();
  const { statuses } = useStatuses();
  const { tags } = useAllTags();
  const { taskTags } = useAllTaskTags();
  const { relations } = useTaskRelations();
  const index = useMemo(
    () => buildReferenceIndex({ tasks, projects, statuses, tags, taskTags, relations }),
    [tasks, projects, statuses, tags, taskTags, relations],
  );
  return (
    <TaskReferenceIndexContext.Provider value={index}>
      {children}
    </TaskReferenceIndexContext.Provider>
  );
}

/** The task whose text this is: references resolve in its workspace and favour its project. */
export function TaskReferenceScope({ taskId, children }: { taskId: string; children: ReactNode }) {
  return <ScopeContext.Provider value={taskId}>{children}</ScopeContext.Provider>;
}

export type TaskReferences = {
  index: TaskReferenceIndex;
  taskId: string;
  workspaceId: string;
  projectId: string;
};

/** The index and the task the text belongs to, or null where references are not drawn. */
export function useTaskReferences(): TaskReferences | null {
  const index = useContext(TaskReferenceIndexContext);
  const taskId = useContext(ScopeContext);
  const task = taskId ? index?.task(taskId) : undefined;
  const workspaceId = task?.workspaceId;
  const projectId = task?.projectId;
  return useMemo(
    () =>
      index && taskId && workspaceId && projectId
        ? { index, taskId, workspaceId, projectId }
        : null,
    [index, taskId, workspaceId, projectId],
  );
}

/**
 * Opens a referenced task as the pane opens a related one: over this task when the board holds
 * it, so Back returns here, or on its own project's board.
 */
export function useOpenTaskReference() {
  const shell = useContext(ShellContext);
  return useCallback(
    (task: Task, origin?: HTMLElement | null) => {
      if (canOpenTask(task.id)) openSubtask(task.id, origin);
      else shell?.openTask(task.projectId, task.id);
    },
    [shell],
  );
}
