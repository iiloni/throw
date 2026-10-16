import { taskTagColor } from '@throw/shared';
import { useState } from 'react';
import { TagManager } from '@/components/TagManager/TagManager';
import { TagPicker } from '@/components/TagPicker/TagPicker';
import { TaskTags } from '@/components/TaskTags/TaskTags';
import { Button } from '@/components/ui/button';
import {
  useProjects,
  useStatuses,
  useTags,
  useTasks,
  useTaskTags,
  useWorkspaces,
} from '@/lib/collections';
import { createProject } from '@/lib/projects';
import { useAwaitingSync } from '@/lib/syncStatus';
import { createTag, setPrimaryTag, setSecondaryTag } from '@/lib/tags';
import { createTask } from '@/lib/tasks';
import { useThemePreference } from '@/lib/theme';

/** Development only: real collections and outbox, without wiring future product screens. */
export function TagsPrototype() {
  const { projects } = useProjects();
  const { workspaces } = useWorkspaces();
  const { tasks } = useTasks();
  const { statuses } = useStatuses();
  const [selected, setSelected] = useState('');
  const [taskId, setTaskId] = useState('');
  const project =
    projects.find((project) => project.id === selected) ??
    projects.find((project) => project.deletedAt === null);
  const task =
    tasks.find((task) => task.id === taskId && task.projectId === project?.id) ??
    tasks.find((task) => task.projectId === project?.id);
  const [theme, setTheme] = useThemePreference();
  function example() {
    const workspace = workspaces[0];
    if (!workspace) return;
    const id = createProject(workspace.id, 'Tag workshop');
    const work = createTag(id, { name: 'Product', color: 'teal', icon: 'rocket' });
    const feature = createTag(id, { name: 'Features', parentId: work });
    const mobile = createTag(id, { name: 'Mobile', parentId: feature });
    const research = createTag(id, { name: 'Research', color: 'amber', icon: 'lightbulb' });
    createTag(id, { name: 'Interviews', parentId: research });
    createTag(id, { name: 'Accessibility', icon: 'heart' });
    const task = createTask(id, {
      title: 'Make room for the next idea',
      primaryTagId: mobile,
      secondaryTagIds: [research],
    });
    setSelected(id);
    setTaskId(task);
  }
  return (
    <main className="mx-auto max-w-6xl px-4 pt-[calc(var(--safe-top)+2rem)] pb-[calc(var(--safe-bottom)+3rem)] md:px-8">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Throw · Development workshop</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            A place for every kind of work.
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Nested tags, a primary colour, and room for extra context. Changes here save to your
            project.
          </p>
        </div>
        <Button
          variant="ghost"
          className="h-11 rounded-xl"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          Switch theme
        </Button>
      </div>
      <div className="mb-8 flex flex-wrap items-end gap-4">
        <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
          Project
          <select
            aria-label="Project"
            value={project?.id ?? ''}
            onChange={(event) => {
              setSelected(event.target.value);
              setTaskId('');
            }}
            className="h-11 max-w-full rounded-xl border border-border bg-background px-3"
          >
            {projects
              .filter((project) => project.deletedAt === null)
              .map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
          </select>
        </label>
        {project && (
          <label className="flex min-w-0 max-w-full flex-col gap-1.5 text-sm font-medium">
            Task
            <select
              aria-label="Task"
              value={task?.id ?? ''}
              onChange={(event) => setTaskId(event.target.value)}
              className="h-11 max-w-full rounded-xl border border-border bg-background px-3"
            >
              <option value="" disabled>
                Choose a task
              </option>
              {tasks
                .filter((task) => task.projectId === project.id)
                .map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title || 'Untitled task'}
                  </option>
                ))}
            </select>
          </label>
        )}
        <Button
          variant="secondary"
          className="h-11 rounded-xl"
          disabled={!workspaces.length}
          onClick={example}
        >
          Create example project
        </Button>
        {project && (
          <Button
            variant="ghost"
            className="h-11 rounded-xl"
            disabled={
              !statuses.some(
                (status) =>
                  status.projectId === project.id &&
                  status.category === 'backlog' &&
                  status.isDefault,
              )
            }
            onClick={() => setTaskId(createTask(project.id, { title: 'Try a tag' }))}
          >
            New task
          </Button>
        )}
      </div>
      {project && (
        <div className="grid items-start gap-8 lg:grid-cols-2">
          <div className="min-w-0 rounded-3xl border border-border bg-card/40 p-4 md:p-6">
            <TagManager key={project.id} projectId={project.id} />
          </div>
          {task && <TaskTagDemo key={task.id} task={task} />}
        </div>
      )}
    </main>
  );
}
function TaskTagDemo({ task }: { task: import('@throw/shared').Task }) {
  const { tags, isLoading } = useTags(task.projectId);
  const { taskTags, isLoading: assignmentsLoading } = useTaskTags(task.id);
  const awaitingTags = useAwaitingSync(isLoading, tags.length);
  const awaitingAssignments = useAwaitingSync(assignmentsLoading, taskTags.length);
  const awaiting = awaitingTags || awaitingAssignments;
  const secondaryTagIds = taskTags.map((row) => row.tagId);
  const color = taskTagColor(task, tags);
  return (
    <section className="min-w-0 space-y-6">
      <div
        data-color={color ?? undefined}
        className="glass rounded-3xl border-l-4 border-l-tint-accent bg-tint/35 p-5"
        style={color ? undefined : { borderLeftColor: 'var(--border)', background: 'var(--card)' }}
      >
        <p className="mb-3 text-sm text-muted-foreground">Task preview</p>
        <h2 className="mb-4 font-display text-xl font-semibold">{task.title || 'Untitled task'}</h2>
        <TaskTags tags={tags} primaryTagId={task.primaryTagId} secondaryTagIds={secondaryTagIds} />
      </div>
      <div className="rounded-3xl border border-border bg-card/40 p-4 md:p-6">
        <h2 className="mb-3 font-display text-xl font-semibold">Choose tags</h2>
        {awaiting ? (
          <p role="status">Loading tags…</p>
        ) : (
          <TagPicker
            tags={tags}
            primaryTagId={task.primaryTagId}
            secondaryTagIds={secondaryTagIds}
            onPrimaryChange={(id) => setPrimaryTag(task.id, id)}
            onSecondaryChange={(id, present) => setSecondaryTag(task.id, id, present)}
          />
        )}
      </div>
    </section>
  );
}
