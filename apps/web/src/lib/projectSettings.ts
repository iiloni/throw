import { type Project, projectKeySchema, type Status, type Task } from '@throw/shared';
import { z } from 'zod';

export const settingsSectionSchema = z.enum(['general', 'statuses', 'priorities', 'tags']);
export type SettingsSection = z.infer<typeof settingsSectionSchema>;

export function projectKeyIssue(project: Project, key: string, projects: readonly Project[]) {
  if (project.key === null) return 'Connect to settle this project’s first key before changing it.';
  if (key === project.key) return null;
  if (!projectKeySchema.safeParse(key).success)
    return 'Use 1–6 letters A–Z or digits, starting with a letter.';
  const clash = projects.find(
    (other) =>
      other.workspaceId === project.workspaceId && other.id !== project.id && other.key === key,
  );
  return clash
    ? `“${clash.name}” already uses this key${clash.deletedAt ? ' in the trash' : ''}. Choose another.`
    : null;
}

/** How many tasks, trashed ones included, use each status. */
export function statusUsage(tasks: readonly Task[]) {
  const counts = new Map<string, number>();
  for (const task of tasks) counts.set(task.statusId, (counts.get(task.statusId) ?? 0) + 1);
  return counts;
}

/**
 * Why a status cannot be deleted, or null. `deleteStatus` and the settings screen share it,
 * so the button and the action agree. `siblings` are the project's statuses.
 */
export function statusDeletionIssue(status: Status, siblings: readonly Status[], count: number) {
  const reasons: string[] = [];
  if (siblings.filter((other) => other.category === status.category).length === 1)
    reasons.push('Every category keeps at least one status.');
  else if (status.isDefault) reasons.push('Choose another default before deleting this status.');
  if (count)
    reasons.push(
      `Move ${count === 1 ? 'its task' : `its ${count} tasks`} to another status first, including those in the trash.`,
    );
  return reasons.join(' ') || null;
}

/**
 * Only independent trash roots have their own restore/purge controls. Emptying the trash
 * removes exactly these, so a trashed task whose parent or project row has not reached the
 * device is listed rather than removed unseen.
 */
export function trashRoots(
  projects: readonly Project[],
  tasks: readonly Task[],
  workspaceId: string,
  projectId?: string,
) {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  return {
    projects: projectId
      ? []
      : projects.filter(
          (project) => project.workspaceId === workspaceId && project.deletedAt !== null,
        ),
    tasks: tasks.filter(
      (task) =>
        task.workspaceId === workspaceId &&
        (!projectId || task.projectId === projectId) &&
        task.deletedAt !== null &&
        !projectById.get(task.projectId)?.deletedAt &&
        (!task.parentId || !taskById.get(task.parentId)?.deletedAt),
    ),
  };
}
