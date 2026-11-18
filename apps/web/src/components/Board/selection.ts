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

/**
 * Every project of a workspace as one board (spec, "The cross-project board"). Its statuses
 * and tags are its projects' together, each task names its project, and cards take their
 * project's colour, since tag colours mean different things in each project. A rank's name
 * is shown where every project agrees on it; otherwise the default.
 */
export function workspaceBoardData(
  workspaceId: string,
  projects: ProjectRow[],
  statuses: StatusRow[],
  tasks: TaskRow[],
  tags: Tag[] = [],
): BoardData {
  const members = projects.map((project) => {
    const data = projectBoardData(project, statuses, tasks, tags);
    return {
      ...data,
      tasks: data.tasks.map((task) => ({
        ...task,
        projectId: project.id,
        primaryTagColor: project.color,
      })),
      hiddenTasks: (data.hiddenTasks ?? []).map((task) => ({ ...task, projectId: project.id })),
    };
  });
  const names = [0, 1, 2, 3, 4].map((rank) => {
    const chosen = new Set(members.map(({ project }) => project.priorityNames[rank] || null));
    return chosen.size === 1 ? [...chosen][0]! : null;
  });
  return {
    project: {
      id: `workspace:${workspaceId}`,
      key: null,
      name: 'All projects',
      color: 'gray',
      icon: null,
      priorityNames: names,
      statuses: members.flatMap(({ project }) => project.statuses),
      tags: members.flatMap(({ project }) => project.tags),
      members: members.map(({ project }) => project),
    },
    tasks: members.flatMap((data) => data.tasks),
    hiddenTasks: members.flatMap((data) => data.hiddenTasks ?? []),
  };
}
