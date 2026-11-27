import {
  DEFAULT_PRIORITY_NAMES,
  isClosedCategory,
  isTaskTrashed,
  type Project,
  type Status,
  type Tag,
  type Task,
  type TaskRelation,
  type TaskTag,
  taskIdentifier,
} from '@throw/shared';
import type { TaskBlocker } from '@/components/Board/blockers';
import { blockersByTask } from '@/components/TaskRelations/TaskRelations';
import { type IndexedTask, indexTasks, searchTasks } from '@/lib/taskSearch';

/** A task a `#KEY-N` names, as a reference draws and opens it. */
export type ReferencedTask = {
  task: Task;
  project: Project;
  status: Status | undefined;
  identifier: string;
  closed: boolean;
};

/** What a reference's preview card shows beyond the task's own fields. */
export type ReferenceDetails = {
  priorityName: string;
  /** The project's tags, for each badge's path and color. */
  tags: readonly Tag[];
  primaryTag: Tag | null;
  secondaryTags: readonly Tag[];
  blockers: readonly TaskBlocker[];
};

export type ReferenceSources = {
  tasks: readonly Task[];
  projects: readonly Project[];
  statuses: readonly Status[];
  tags: readonly Tag[];
  taskTags: readonly TaskTag[];
  relations: readonly TaskRelation[];
};

export type TaskReferenceIndex = {
  task(taskId: string): Task | undefined;
  /** The task a reference written in `workspaceId` names, if the device holds it. */
  resolve(workspaceId: string, identifier: string): ReferencedTask | undefined;
  details(reference: ReferencedTask): ReferenceDetails;
  /**
   * Tasks to offer after a `#`: the best matches for `query` across the workspace, the
   * current project's first; with no query, the latest open tasks, the current project's first.
   */
  suggest(
    workspaceId: string,
    query: string,
    options: { currentProjectId: string; excludeTaskId?: string; limit?: number },
  ): ReferencedTask[];
};

export const SUGGESTION_LIMIT = 8;

/**
 * One pass over the synced rows, read lazily: a workspace's identifiers are gathered the first
 * time one of its references is drawn, its search text only when a `#` asks for suggestions,
 * and a card's tags and blockers only when it opens. Trashed tasks are left out, so a
 * reference to one stays plain text.
 */
export function buildReferenceIndex(sources: ReferenceSources): TaskReferenceIndex {
  const taskById = new Map(sources.tasks.map((task) => [task.id, task]));
  const projectById = new Map(sources.projects.map((project) => [project.id, project]));
  const statusById = new Map(sources.statuses.map((status) => [status.id, status]));
  const identifiers = new Map<string, Map<string, ReferencedTask>>();
  const searchable = new Map<string, IndexedTask[]>();
  let blockers: ReadonlyMap<string, readonly TaskBlocker[]> | undefined;

  function referenceTo(task: Task): ReferencedTask | undefined {
    const project = projectById.get(task.projectId);
    if (!project || project.deletedAt) return undefined;
    const identifier = taskIdentifier(project, task);
    if (!identifier || isTaskTrashed(task, taskById.get(task.parentId ?? ''), project))
      return undefined;
    const status = statusById.get(task.statusId);
    return {
      task,
      project,
      status,
      identifier,
      closed: status ? isClosedCategory(status.category) : false,
    };
  }

  function byIdentifier(workspaceId: string) {
    let found = identifiers.get(workspaceId);
    if (!found) {
      found = new Map();
      for (const task of sources.tasks) {
        if (task.workspaceId !== workspaceId) continue;
        const reference = referenceTo(task);
        if (reference) found.set(reference.identifier, reference);
      }
      identifiers.set(workspaceId, found);
    }
    return found;
  }

  function indexed(workspaceId: string) {
    let found = searchable.get(workspaceId);
    if (!found) {
      found = indexTasks(sources.tasks, sources.projects, sources.statuses, workspaceId);
      searchable.set(workspaceId, found);
    }
    return found;
  }

  return {
    task: (taskId) => taskById.get(taskId),
    resolve: (workspaceId, identifier) => byIdentifier(workspaceId).get(identifier.toUpperCase()),
    details(ref) {
      blockers ??= blockersByTask(
        sources.relations,
        sources.tasks,
        sources.projects,
        sources.statuses,
      );
      const tags = sources.tags.filter((tag) => tag.projectId === ref.project.id);
      const tagById = new Map(tags.map((tag) => [tag.id, tag]));
      const secondaryTags = sources.taskTags.flatMap((row) => {
        const tag = row.taskId === ref.task.id ? tagById.get(row.tagId) : undefined;
        return tag && tag.id !== ref.task.primaryTagId ? [tag] : [];
      });
      return {
        priorityName:
          ref.project.priorityNames[ref.task.priority - 1] ||
          DEFAULT_PRIORITY_NAMES[ref.task.priority - 1]!,
        tags,
        primaryTag: (ref.task.primaryTagId && tagById.get(ref.task.primaryTagId)) || null,
        secondaryTags,
        blockers: ref.closed ? [] : (blockers.get(ref.task.id) ?? []),
      };
    },
    suggest(workspaceId, query, { currentProjectId, excludeTaskId, limit = SUGGESTION_LIMIT }) {
      const rows = indexed(workspaceId);
      const usable = (row: IndexedTask) => row.identifier !== null && row.task.id !== excludeTaskId;
      const matches = query.trim()
        ? searchTasks(rows, query, { currentProjectId }).filter(usable)
        : rows
            .filter((row) => usable(row) && !(row.status && isClosedCategory(row.status.category)))
            // The current project's latest first: the task just written about is usually a
            // recent one nearby.
            .sort(
              (a, b) =>
                Number(b.project.id === currentProjectId) -
                  Number(a.project.id === currentProjectId) ||
                (b.task.number ?? 0) - (a.task.number ?? 0),
            );
      return matches.slice(0, limit).flatMap((row) => referenceTo(row.task) ?? []);
    },
  };
}
