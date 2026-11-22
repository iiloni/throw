import {
  compareStatuses,
  isTaskTrashed,
  type Project as ProjectRow,
  type Status as StatusRow,
  type Tag,
  type Task as TaskRow,
  type TaskTag,
  taskTagColor,
} from '@throw/shared';
import type { BoardData, Task as BoardTask } from './model';

/** Each task's secondary tag ids, from the synced assignments. */
export function secondaryTagsByTask(assignments: readonly TaskTag[]) {
  const byTask = new Map<string, string[]>();
  for (const { taskId, tagId } of assignments) {
    const ids = byTask.get(taskId);
    if (ids) ids.push(tagId);
    else byTask.set(taskId, [tagId]);
  }
  return byTask;
}

const noSecondaryTags: ReadonlyMap<string, string[]> = new Map();

/** Select before presenting: a trashed parent hides its children in every board view. */
export function projectBoardData(
  project: ProjectRow,
  statuses: StatusRow[],
  tasks: TaskRow[],
  tags: Tag[] = [],
  secondaryTags: ReadonlyMap<string, string[]> = noSecondaryTags,
): BoardData {
  const parents = new Map(tasks.map((task) => [task.id, task]));
  const projectTags = tags.filter((tag) => tag.projectId === project.id);
  const tagIds = new Set(projectTags.map((tag) => tag.id));
  const present = (task: TaskRow) => ({
    ...task,
    size: task.size ?? null,
    closedAt: task.closedAt === null ? null : Date.parse(task.closedAt),
    primaryTagColor: taskTagColor(task, projectTags),
    // An assignment whose tag has not synced, or was deleted, is not counted on the card.
    secondaryTagIds: (secondaryTags.get(task.id) ?? []).filter(
      (id) => id !== task.primaryTagId && tagIds.has(id),
    ),
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
 * project's color, since tag colors mean different things in each project. A rank's name
 * is shown where every project agrees on it; otherwise the default.
 */
export function workspaceBoardData(
  workspaceId: string,
  projects: ProjectRow[],
  statuses: StatusRow[],
  tasks: TaskRow[],
  tags: Tag[] = [],
  secondaryTags: ReadonlyMap<string, string[]> = noSecondaryTags,
): BoardData {
  // Each project adapts only its own rows, so a sync change costs one pass over the tasks.
  const byProject = <T extends { projectId: string }>(rows: T[]) => {
    const groups = new Map<string, T[]>();
    for (const row of rows) {
      const group = groups.get(row.projectId);
      if (group) group.push(row);
      else groups.set(row.projectId, [row]);
    }
    return groups;
  };
  const [statusesOf, tasksOf, tagsOf] = [byProject(statuses), byProject(tasks), byProject(tags)];
  const members = projects.map((project) => {
    const data = projectBoardData(
      project,
      statusesOf.get(project.id) ?? [],
      tasksOf.get(project.id) ?? [],
      tagsOf.get(project.id) ?? [],
      secondaryTags,
    );
    const own = (task: BoardTask) => ({
      ...task,
      projectId: project.id,
      primaryTagColor: project.color,
    });
    return { ...data, tasks: data.tasks.map(own), hiddenTasks: (data.hiddenTasks ?? []).map(own) };
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
