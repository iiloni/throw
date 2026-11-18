import {
  compareStatuses,
  isTaskTrashed,
  type Project as ProjectRow,
  type Status as StatusRow,
  type Tag,
  type Task as TaskRow,
  taskTagColor,
} from '@throw/shared';
import type { BoardData } from './model';

/** Select before presenting: a trashed parent hides its children in every board view. */
export function projectBoardData(
  project: ProjectRow,
  statuses: StatusRow[],
  tasks: TaskRow[],
  tags: Tag[] = [],
): BoardData {
  const parents = new Map(tasks.map((task) => [task.id, task]));
  const projectTags = tags.filter((tag) => tag.projectId === project.id);
  const present = (task: TaskRow) => ({
    ...task,
    closedAt: task.closedAt === null ? null : Date.parse(task.closedAt),
    primaryTagColor: taskTagColor(task, projectTags),
    secondaryTagIds: [],
    description: undefined,
  });
  return {
    project: {
      id: project.id,
      key: project.key,
      name: project.name,
      color: project.color,
      icon: project.icon,
      priorityNames: project.priorityNames,
      statuses: statuses.filter((status) => status.projectId === project.id).sort(compareStatuses),
      tags: projectTags.map((tag) => ({ ...tag, color: tag.color ?? undefined })),
    },
    tasks: tasks
      .filter(
        (task) =>
          task.projectId === project.id &&
          !isTaskTrashed(task, parents.get(task.parentId ?? ''), project),
      )
      .map(present),
    // A trashed task stays open for restoring, but never enters a board list or count.
    hiddenTasks: tasks
      .filter(
        (task) =>
          task.projectId === project.id &&
          isTaskTrashed(task, parents.get(task.parentId ?? ''), project),
      )
      .map(present),
  };
}
