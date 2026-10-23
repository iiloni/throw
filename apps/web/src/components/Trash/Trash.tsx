import { Link } from '@tanstack/react-router';
import { taskIdentifier } from '@throw/shared';
import { useState } from 'react';
import { useShell } from '@/components/AppShell/shell';
import { ManagementSurface } from '@/components/ManagementSurface/ManagementSurface';
import { Button } from '@/components/ui/button';
import { useProjects, useTasks } from '@/lib/collections';
import { trashRoots } from '@/lib/projectSettings';
import { purgeProject, restoreProject } from '@/lib/projects';
import { useAwaitingSync } from '@/lib/syncStatus';
import { emptyProjectTrash, emptyTrash, purgeTask, restoreTask } from '@/lib/tasks';

export function Trash({ projectId }: { projectId?: string }) {
  const shell = useShell();
  const { projects, isLoading: loadingProjects } = useProjects();
  const { tasks, isLoading: loadingTasks } = useTasks();
  const workspaceId = shell.workspace?.id ?? '';
  const roots = trashRoots(projects, tasks, workspaceId, projectId);
  const count = roots.projects.length + roots.tasks.length;
  const awaiting = useAwaitingSync(loadingProjects || loadingTasks, count);
  const [confirmation, setConfirmation] = useState<{
    kind: 'project' | 'task' | 'all';
    id?: string;
    name: string;
  } | null>(null);
  const project = projects.find((item) => item.id === projectId);
  const canRemove =
    confirmation?.kind === 'all'
      ? count > 0
      : confirmation?.kind === 'project'
        ? roots.projects.some((item) => item.id === confirmation.id)
        : roots.tasks.some((item) => item.id === confirmation?.id);
  return (
    <div className="mx-auto max-w-3xl px-5 pb-10 md:px-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-semibold">
          {projectId ? 'Project trash' : 'Workspace trash'}
        </h2>
        <Button
          variant="outline"
          disabled={awaiting || !count}
          onClick={() => setConfirmation({ kind: 'all', name: 'Empty the trash?' })}
        >
          Empty trash
        </Button>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Nothing is removed automatically. Restoring a project or parent brings its tasks back; a
        subtask trashed separately stays in the trash.
      </p>
      <div className="mb-6 flex flex-wrap gap-4 text-sm text-primary">
        {projectId && project && (
          <Link to="/w/$workspaceId/p/$projectId/settings" params={{ workspaceId, projectId }}>
            Project settings
          </Link>
        )}
        {projectId && (
          <Link to="/w/$workspaceId/trash" params={{ workspaceId }}>
            Workspace trash
          </Link>
        )}
      </div>
      {project?.deletedAt && (
        <p className="mb-4 text-sm">
          This project is in the workspace trash. Restore it there to manage its tasks.
        </p>
      )}
      {awaiting ? (
        <p role="status">Loading trash…</p>
      ) : !count ? (
        <p className="py-10 text-center text-sm text-muted-foreground">The trash is empty.</p>
      ) : (
        <div className="space-y-8">
          {roots.projects.length > 0 && (
            <section aria-label="Trashed projects">
              <h3 className="mb-3 font-semibold">Projects</h3>
              <ul className="divide-y border-y">
                {roots.projects.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-col items-start gap-3 py-4 sm:flex-row sm:items-center"
                    aria-label={item.name}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="break-words font-medium">{item.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Includes {tasks.filter((task) => task.projectId === item.id).length}{' '}
                        {tasks.filter((task) => task.projectId === item.id).length === 1
                          ? 'task'
                          : 'tasks'}
                        , statuses and tags.
                      </p>
                    </div>
                    <TrashActions
                      onRestore={() => restoreProject(item.id)}
                      onRemove={() =>
                        setConfirmation({ kind: 'project', id: item.id, name: item.name })
                      }
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {roots.tasks.length > 0 && (
            <section aria-label="Trashed tasks">
              <h3 className="mb-3 font-semibold">Tasks</h3>
              <ul className="divide-y border-y">
                {roots.tasks.map((item) => {
                  const ownProject = projects.find((row) => row.id === item.projectId);
                  const children = tasks.filter((row) => row.parentId === item.id);
                  return (
                    <li key={item.id} className="py-4" aria-label={item.title || 'Untitled task'}>
                      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <p className="break-words font-medium">{item.title || 'Untitled task'}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {ownProject && (taskIdentifier(ownProject, item) ?? 'Pending')} ·{' '}
                            {ownProject?.name}
                            {item.parentId ? ' · Subtask' : ''}
                          </p>
                        </div>
                        <TrashActions
                          onRestore={() => restoreTask(item.id)}
                          onRemove={() =>
                            setConfirmation({
                              kind: 'task',
                              id: item.id,
                              name: item.title || 'Untitled task',
                            })
                          }
                        />
                      </div>
                      {children.length > 0 && (
                        <ul
                          className="mt-3 space-y-1 border-l pl-4 text-sm text-muted-foreground"
                          aria-label="Included subtasks"
                        >
                          {children.map((child) => (
                            <li key={child.id}>
                              {child.title || 'Untitled subtask'}
                              {child.deletedAt
                                ? ' — stays trashed on restore'
                                : ' — restores with parent'}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      )}
      <ManagementSurface
        open={!!confirmation}
        title={
          confirmation?.kind === 'all'
            ? 'Empty the trash?'
            : confirmation?.kind === 'project'
              ? 'Remove project for good?'
              : 'Remove task for good?'
        }
        onClose={() => setConfirmation(null)}
      >
        {confirmation && confirmation.kind !== 'all' && (
          <p className="mb-3 break-words font-medium">{confirmation.name}</p>
        )}
        <p className="mb-5 text-sm text-muted-foreground">
          {confirmation?.kind === 'all'
            ? `Remove all ${count} listed items and everything under them for good?`
            : confirmation?.kind === 'project'
              ? 'This removes the project, all its tasks, statuses, tags, comments and history for good.'
              : 'This removes the task, its subtasks, comments and history for good.'}{' '}
          This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmation(null)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!canRemove}
            onClick={() => {
              if (confirmation?.kind === 'all') {
                if (projectId) emptyProjectTrash(projectId);
                else emptyTrash(workspaceId);
              } else if (confirmation?.kind === 'project' && confirmation.id)
                purgeProject(confirmation.id);
              else if (confirmation?.id) purgeTask(confirmation.id);
              setConfirmation(null);
            }}
          >
            {confirmation?.kind === 'all' ? 'Empty trash for good' : 'Remove for good'}
          </Button>
        </div>
      </ManagementSurface>
    </div>
  );
}
function TrashActions({ onRestore, onRemove }: { onRestore: () => void; onRemove: () => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      <Button className="h-11" variant="secondary" onClick={onRestore}>
        Restore
      </Button>
      <Button variant="ghost" className="h-11 text-destructive" onClick={onRemove}>
        Remove for good
      </Button>
    </div>
  );
}
