import {
  isClosedCategory,
  isTaskTrashed,
  openBlockers,
  type Project,
  relationConflict,
  relationFromRole,
  relationRole,
  relationRoleLabel,
  type Status,
  TASK_RELATION_ROLES,
  type Task,
  type TaskRelation,
  type TaskRelationRole,
  taskIdentifier,
} from '@throw/shared';
import { X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { StatusGlyph } from '@/components/Board/glyphs';
import { IconButton } from '@/components/IconButton/IconButton';
import { Input } from '@/components/ui/input';
import { useProjects, useStatuses, useTaskRelations, useTasks } from '@/lib/collections';
import { haptics } from '@/lib/haptics';
import { addTaskRelation, RelationError, removeTaskRelation } from '@/lib/taskRelations';
import { indexTasks, searchTasks } from '@/lib/taskSearch';
import { cn } from '@/lib/utils';

export type RelatedTask = {
  relationId: string;
  role: TaskRelationRole;
  task: Task;
  project: Project | undefined;
  status: Status | undefined;
  identifier: string | null;
  closed: boolean;
  trashed: boolean;
};
export type RelationGroup = { role: TaskRelationRole; label: string; items: RelatedTask[] };

/**
 * A task's relations grouped as it sees them, in the task view's order, with empty groups
 * left out. A task on the other end the device does not hold (purged meanwhile) is skipped.
 */
export function relationGroups(
  taskId: string,
  relations: readonly TaskRelation[],
  tasks: readonly Task[],
  projects: readonly Project[],
  statuses: readonly Status[],
): RelationGroup[] {
  const taskById = new Map(tasks.map((row) => [row.id, row]));
  const projectById = new Map(projects.map((row) => [row.id, row]));
  const statusById = new Map(statuses.map((row) => [row.id, row]));
  const groups = new Map<TaskRelationRole, RelatedTask[]>();
  for (const relation of relations) {
    const seen = relationRole(relation, taskId);
    const task = seen && taskById.get(seen.otherTaskId);
    if (!seen || !task) continue;
    const project = projectById.get(task.projectId);
    const status = statusById.get(task.statusId);
    const items = groups.get(seen.role) ?? [];
    items.push({
      relationId: relation.id,
      role: seen.role,
      task,
      project,
      status,
      identifier: project ? taskIdentifier(project, task) : null,
      closed: status ? isClosedCategory(status.category) : false,
      trashed: isTaskTrashed(task, taskById.get(task.parentId ?? ''), project),
    });
    groups.set(seen.role, items);
  }
  return TASK_RELATION_ROLES.flatMap((role) => {
    const items = groups.get(role);
    if (!items) return [];
    // Open work first, then by identifier, so a blocker that still holds reads first.
    items.sort(
      (a, b) =>
        Number(a.closed || a.trashed) - Number(b.closed || b.trashed) ||
        (a.identifier ?? '').localeCompare(b.identifier ?? '', undefined, { numeric: true }) ||
        a.task.id.localeCompare(b.task.id),
    );
    return [{ role, label: relationRoleLabel[role], items }];
  });
}

/** `relationGroups` for one task, kept up to date. */
export function useRelationGroups(task: Task) {
  const { relations, isLoading } = useTaskRelations();
  const { tasks } = useTasks();
  const { projects } = useProjects();
  const { statuses } = useStatuses();
  const groups = useMemo(
    () => relationGroups(task.id, relations, tasks, projects, statuses),
    [task.id, relations, tasks, projects, statuses],
  );
  return { groups, isLoading };
}

/**
 * The task's relations, as Catch lists a note's links: one quiet row per related task with
 * its status, identifier and title, and its project when that is another one. A row opens the
 * task; its remove button is always shown, since a touch screen has no hover.
 */
export function TaskRelations({
  task,
  groups,
  onOpen,
  className,
}: {
  task: Task;
  groups: RelationGroup[];
  onOpen(task: Task): void;
  className?: string;
}) {
  if (groups.length === 0) return null;
  return (
    <section aria-label="Relations" className={cn('flex flex-col gap-3', className)}>
      {groups.map((group) => (
        <div key={group.role} className="flex flex-col gap-1">
          <h2 className="px-1 font-medium text-muted-foreground text-xs">{group.label}</h2>
          <ul className="flex flex-col gap-1">
            {group.items.map((item) => (
              <RelationRow
                key={item.relationId}
                item={item}
                crossProject={item.task.projectId !== task.projectId}
                onOpen={() => onOpen(item.task)}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function RelationRow({
  item,
  crossProject,
  onOpen,
}: {
  item: RelatedTask;
  crossProject: boolean;
  onOpen(): void;
}) {
  const title = item.task.title || 'Untitled task';
  const identifier = item.identifier ?? 'Pending';
  const done = item.closed || item.trashed;
  return (
    <li className="flex min-h-11 items-center gap-1 rounded-xl bg-foreground/[0.04]">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${identifier} ${title}${item.trashed ? ', in the trash' : item.closed ? `, ${item.status?.name ?? 'closed'}` : ''}`}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl py-1.5 pl-3 text-left text-sm outline-none transition-colors hover:bg-foreground/[0.04] focus-visible:ring-[3px] focus-visible:ring-ring/60"
      >
        <StatusGlyph
          category={item.status?.category ?? 'backlog'}
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        {crossProject && item.project && (
          <span
            data-color={item.project.color}
            className="shrink-0 rounded-md bg-tint px-1.5 font-medium text-[0.6875rem] text-foreground/80"
          >
            {item.project.name}
          </span>
        )}
        <span className="shrink-0 font-medium text-muted-foreground text-xs tabular-nums">
          {identifier}
        </span>
        <span
          className={cn(
            'min-w-0 truncate',
            done && 'text-muted-foreground line-through decoration-foreground/30',
          )}
        >
          {title}
        </span>
      </button>
      <IconButton
        label={`Remove ${relationRoleLabel[item.role].toLowerCase()} ${identifier}`}
        className="size-11 shrink-0 text-muted-foreground [&_svg]:size-4"
        onClick={() => {
          removeTaskRelation(item.relationId);
          haptics.selection();
        }}
      >
        <X />
      </IconButton>
    </li>
  );
}

/** The kinds a person adds; “Duplicated by” is made from the duplicate's side. */
const PICKABLE: TaskRelationRole[] = ['blocks', 'blocked_by', 'duplicates', 'relates_to'];

/**
 * Links the task to another one in its workspace, in any project: a kind, then a search of
 * open and closed tasks out of the trash by identifier or title. Picking a task links it and
 * closes the picker.
 */
export function RelationPicker({ task, onPicked }: { task: Task; onPicked(): void }) {
  const [role, setRole] = useState<TaskRelationRole>('blocked_by');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { tasks } = useTasks();
  const { projects } = useProjects();
  const { statuses } = useStatuses();
  const { relations } = useTaskRelations();
  const name = useId();
  const resultsId = useId();
  const index = useMemo(
    () =>
      indexTasks(tasks, projects, statuses, task.workspaceId).filter(
        (row) => row.task.id !== task.id,
      ),
    [tasks, projects, statuses, task.workspaceId, task.id],
  );
  const results = useMemo(
    () => searchTasks(index, query, { currentProjectId: task.projectId, limit: 8 }),
    [index, query, task.projectId],
  );
  function pick(other: Task) {
    try {
      addTaskRelation(task.id, role, other.id);
      haptics.success();
      setError(null);
      onPicked();
    } catch (caught) {
      if (!(caught instanceof RelationError)) throw caught;
      setError(
        caught.message === 'Task not found' ? 'That task is no longer here.' : caught.message,
      );
    }
  }
  return (
    <div className="flex flex-col gap-2 px-3 pt-2 pb-3">
      <div role="radiogroup" aria-label="Relation" className="grid grid-cols-2 gap-1.5">
        {PICKABLE.map((option) => (
          <label
            key={option}
            className="relative flex h-10 cursor-pointer select-none items-center justify-center rounded-[calc(var(--dock-radius)-0.25rem)] border-2 border-transparent bg-foreground/[0.04] px-2 font-medium text-foreground/80 text-sm outline-none transition-colors duration-200 hover:bg-foreground/[0.07] has-[:checked]:border-brand has-[:checked]:bg-foreground/[0.08] has-[:checked]:text-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/70"
          >
            <input
              className="absolute inset-0 cursor-pointer appearance-none rounded-[inherit] opacity-0"
              type="radio"
              name={name}
              checked={role === option}
              onChange={() => {
                setRole(option);
                setError(null);
              }}
            />
            {relationRoleLabel[option]}
          </label>
        ))}
      </div>
      <Input
        type="search"
        aria-label="Find a task"
        aria-controls={resultsId}
        placeholder="Find a task by key or title"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && results[0]) {
            event.preventDefault();
            pick(results[0].task);
          }
        }}
        className="h-11"
      />
      {error && (
        <p role="alert" className="px-1 text-destructive text-sm">
          {error}
        </p>
      )}
      <ul id={resultsId} aria-label="Matching tasks" className="flex flex-col gap-1">
        {results.map((row) => {
          const pair = relationFromRole(task.id, role, row.task.id);
          const taken = relationConflict(relations, pair) !== null;
          const identifier = row.identifier ?? 'Pending';
          return (
            <li key={row.task.id}>
              <button
                type="button"
                disabled={taken}
                onClick={() => pick(row.task)}
                className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-xl px-3 py-1.5 text-left text-sm outline-none transition-colors hover:bg-foreground/[0.06] focus-visible:ring-[3px] focus-visible:ring-ring/60 disabled:cursor-default disabled:opacity-50"
              >
                <StatusGlyph
                  category={row.status?.category ?? 'backlog'}
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
                {row.project.id !== task.projectId && (
                  <span
                    data-color={row.project.color}
                    className="shrink-0 rounded-md bg-tint px-1.5 font-medium text-[0.6875rem] text-foreground/80"
                  >
                    {row.project.name}
                  </span>
                )}
                <span className="shrink-0 font-medium text-muted-foreground text-xs tabular-nums">
                  {identifier}
                </span>
                <span className="min-w-0 flex-1 truncate">{row.task.title || 'Untitled task'}</span>
                {taken && <span className="shrink-0 text-muted-foreground text-xs">Linked</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {query.trim() && results.length === 0 && (
        <p role="status" className="px-1 py-2 text-muted-foreground text-sm">
          No tasks match.
        </p>
      )}
    </div>
  );
}

/**
 * Each blocked task's open blockers by identifier, for the board's cards: a blocker counts
 * until it is closed or trashed (`openBlockers`).
 */
export function blockersByTask(
  relations: readonly TaskRelation[],
  tasks: readonly Task[],
  projects: readonly Project[],
  statuses: readonly Status[],
): ReadonlyMap<string, readonly string[]> {
  const taskById = new Map(tasks.map((row) => [row.id, row]));
  const projectById = new Map(projects.map((row) => [row.id, row]));
  const statusById = new Map(statuses.map((row) => [row.id, row]));
  const blocked = new Map<string, string[]>();
  for (const relation of relations) {
    if (relation.kind !== 'blocks') continue;
    const [label] = openBlockers(relation.targetTaskId, [relation], (id) => {
      const blocker = taskById.get(id);
      const status = blocker && statusById.get(blocker.statusId);
      if (!blocker || !status) return undefined;
      const project = projectById.get(blocker.projectId);
      return {
        task: (project && taskIdentifier(project, blocker)) ?? 'a pending task',
        category: status.category,
        trashed: isTaskTrashed(blocker, taskById.get(blocker.parentId ?? ''), project),
      };
    });
    if (label === undefined) continue;
    blocked.set(relation.targetTaskId, [...(blocked.get(relation.targetTaskId) ?? []), label]);
  }
  for (const labels of blocked.values())
    labels.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return blocked;
}

/** `blockersByTask` over everything synced, for a board boundary. */
export function useBlockersByTask() {
  const { relations } = useTaskRelations();
  const { tasks } = useTasks();
  const { projects } = useProjects();
  const { statuses } = useStatuses();
  return useMemo(
    () => blockersByTask(relations, tasks, projects, statuses),
    [relations, tasks, projects, statuses],
  );
}
