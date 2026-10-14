import {
  compareStatuses,
  isTaskTrashed,
  type Project as ProjectRow,
  type Status as StatusRow,
  type Task as TaskRow,
} from '@throw/shared';
import type { BoardData } from './model';

/** Select before presenting: a trashed parent hides its children in every board view. */
export function projectBoardData(
  project: ProjectRow,
  statuses: StatusRow[],
  tasks: TaskRow[],
): BoardData {
  const parents = new Map(tasks.map((task) => [task.id, task]));
  return {
    project: {
      id: project.id,
      key: project.key,
      name: project.name,
      color: project.color,
      icon: project.icon,
      priorityNames: project.priorityNames,
      statuses: statuses.filter((status) => status.projectId === project.id).sort(compareStatuses),
      // The tag step supplies the root-colour resolver here; cards already consume taskColor().
      tags: [],
    },
    tasks: tasks
      .filter(
        (task) =>
          task.projectId === project.id &&
          !isTaskTrashed(task, parents.get(task.parentId ?? ''), project),
      )
      .map((task) => ({
        ...task,
        closedAt: task.closedAt === null ? null : Date.parse(task.closedAt),
        primaryTagId: null,
        secondaryTagIds: [],
        description: undefined,
      })),
  };
}
