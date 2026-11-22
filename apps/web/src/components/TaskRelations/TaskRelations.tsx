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
import { Search, X } from 'lucide-react';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { StatusGlyph } from '@/components/Board/glyphs';
import { Highlighted } from '@/components/CommandPalette/SearchContent';
import { IconButton } from '@/components/IconButton/IconButton';
import { ProjectIcon } from '@/components/ProjectIcon/ProjectIcon';
import { useProjects, useStatuses, useTaskRelations, useTasks } from '@/lib/collections';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { addTaskRelation, RelationError, removeTaskRelation } from '@/lib/taskRelations';
import { highlight, type IndexedTask, indexTasks, searchTasks } from '@/lib/taskSearch';
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
    // The row stands for the task on a phone: its screen opens out of it and closes back in.
    <li
      data-task-origin={item.task.id}
      className="flex min-h-11 items-center gap-1 rounded-xl bg-foreground/[0.04]"
    >
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

/**
 * The kinds a person adds, as this task sees them, each with the sentence that says which way
 * it reads. “Duplicated by” is made from the duplicate's side.
 */
const PICKABLE: { role: TaskRelationRole; explain(key: string): string }[] = [
  { role: 'blocked_by', explain: (key) => `${key} waits until the task you pick is done.` },
  { role: 'blocks', explain: (key) => `The task you pick waits until ${key} is done.` },
  { role: 'duplicates', explain: (key) => `${key} repeats the task you pick.` },
  { role: 'relates_to', explain: (key) => `${key} and the task you pick touch the same work.` },
];
const SUGGESTIONS = 5;
const RESULTS = 8;

/**
 * Tasks to link without typing: the open ones of the task's own project that are not linked
 * to it yet, work in progress first, then the newest.
 */
export function relationSuggestions(
  index: readonly IndexedTask[],
  task: Task,
  linked: ReadonlySet<string>,
  limit = SUGGESTIONS,
) {
  const started = (row: IndexedTask) => (row.status?.category === 'active' ? 0 : 1);
  return index
    .filter(
      (row) =>
        row.project.id === task.projectId &&
        !linked.has(row.task.id) &&
        row.status !== undefined &&
        !isClosedCategory(row.status.category),
    )
    .sort(
      (a, b) =>
        started(a) - started(b) ||
        b.task.createdAt.localeCompare(a.task.createdAt) ||
        a.task.id.localeCompare(b.task.id),
    )
    .slice(0, limit);
}

/**
 * Links the task to another one in its workspace, in any project. The kind comes first, with a
 * sentence saying which way it reads; then a task, from suggestions in its own project or a
 * search of every project by key or title. Picking one links it and closes the picker. As the
 * palette's search, the field keeps focus while the arrows move through the tasks.
 */
export function RelationPicker({ task, onPicked }: { task: Task; onPicked(): void }) {
  const [role, setRole] = useState<TaskRelationRole>('blocked_by');
  const [query, setQuery] = useState('');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { tasks } = useTasks();
  const { projects } = useProjects();
  const { statuses } = useStatuses();
  const { relations } = useTaskRelations();
  const ids = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // With a keyboard at hand the search is ready to type into; a touch screen keeps its
  // keyboard down until the field is tapped, so the suggestions stay in view.
  useEffect(() => {
    if (window.matchMedia?.('(pointer: fine)').matches)
      input.current?.focus({ preventScroll: true });
  }, []);
  const project = projects.find((row) => row.id === task.projectId);
  const key = (project && taskIdentifier(project, task)) ?? 'This task';
  const index = useMemo(
    () =>
      indexTasks(tasks, projects, statuses, task.workspaceId).filter(
        (row) => row.task.id !== task.id,
      ),
    [tasks, projects, statuses, task.workspaceId, task.id],
  );
  // How each task is already linked to this one, by the first link found.
  const linked = useMemo(() => {
    const roles = new Map<string, TaskRelationRole>();
    for (const relation of relations) {
      const seen = relationRole(relation, task.id);
      if (seen && !roles.has(seen.otherTaskId)) roles.set(seen.otherTaskId, seen.role);
    }
    return roles;
  }, [relations, task.id]);
  const searching = query.trim() !== '';
  const rows = useMemo(
    () =>
      searching
        ? searchTasks(index, query, { currentProjectId: task.projectId, limit: RESULTS })
        : relationSuggestions(index, task, new Set(linked.keys())),
    [searching, index, query, task, linked],
  );
  const options = rows.map((row) => ({
    row,
    taken: relationConflict(relations, relationFromRole(task.id, role, row.task.id)) !== null,
  }));
  const enabled = options.filter((option) => !option.taken);
  const active = enabled.some((option) => option.row.task.id === activeKey)
    ? activeKey
    : (enabled[0]?.row.task.id ?? null);
  const optionId = (taskId: string) => `${ids}-option-${taskId}`;

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
  function move(step: 1 | -1) {
    if (enabled.length === 0) return;
    const at = enabled.findIndex((option) => option.row.task.id === active);
    const next = enabled[(at + step + enabled.length) % enabled.length]!;
    setActiveKey(next.row.task.id);
    document.getElementById(optionId(next.row.task.id))?.scrollIntoView?.({ block: 'nearest' });
  }

  return (
    <div className="flex flex-col gap-3 px-3 pt-2 pb-3">
      <div className="flex flex-col gap-1.5">
        <RelationKinds
          value={role}
          describedBy={`${ids}-explain`}
          onChange={(next) => {
            setRole(next);
            setError(null);
            haptics.selection();
          }}
        />
        <p id={`${ids}-explain`} className="px-1 text-muted-foreground text-xs">
          {PICKABLE.find((option) => option.role === role)!.explain(key)}
        </p>
      </div>
      <div className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-foreground/[0.05] pr-1 pl-3 focus-within:ring-2 focus-within:ring-ring/60">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={input}
          type="text"
          inputMode="search"
          role="combobox"
          aria-label="Find a task"
          aria-expanded
          aria-autocomplete="list"
          aria-controls={`${ids}-tasks`}
          aria-activedescendant={active ? optionId(active) : undefined}
          placeholder="Search every project by title or key"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveKey(null);
            setError(null);
            if (list.current) list.current.scrollTop = 0;
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              move(event.key === 'ArrowDown' ? 1 : -1);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const chosen = options.find((option) => option.row.task.id === active);
              if (chosen) pick(chosen.row.task);
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
        {query && (
          <IconButton
            label="Clear search"
            tooltip={false}
            className="size-9 shrink-0 text-muted-foreground [&_svg]:size-4"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              setQuery('');
              setActiveKey(null);
              input.current?.focus({ preventScroll: true });
            }}
          >
            <X />
          </IconButton>
        )}
      </div>
      {error && (
        <p role="alert" className="px-1 text-destructive text-sm">
          {error}
        </p>
      )}
      <section className="flex flex-col gap-1">
        <h3
          id={`${ids}-heading`}
          className="px-1 font-semibold text-[0.6875rem] text-muted-foreground uppercase tracking-[0.06em]"
        >
          {searching ? 'Matching tasks' : project ? `Open in ${project.name}` : 'Open tasks'}
        </h3>
        {/* Room for the suggestions whatever is found, so typing never resizes the panel. */}
        <div
          ref={list}
          id={`${ids}-tasks`}
          role="listbox"
          aria-label="Tasks to link"
          className="flex min-h-[calc(5*3.25rem)] flex-col gap-0.5"
        >
          {options.map(({ row, taken }) => (
            <PickerOption
              key={row.task.id}
              id={optionId(row.task.id)}
              row={row}
              query={query}
              linked={linked.get(row.task.id)}
              otherProject={row.project.id !== task.projectId}
              active={row.task.id === active}
              taken={taken}
              onHover={() => setActiveKey(row.task.id)}
              onPick={() => pick(row.task)}
            />
          ))}
          {options.length === 0 && (
            <p role="status" className="px-1 py-3 text-muted-foreground text-sm">
              {searching
                ? `No tasks match “${query.trim()}”.`
                : 'Search by title or key, such as THR-12, to link a task from any project.'}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * The four kinds as one segmented track, as the task's tabs are drawn. The indicator moves by
 * its own share of the track rather than by layout, so the drawer rising under it cannot pull
 * it along.
 */
function RelationKinds({
  value,
  describedBy,
  onChange,
}: {
  value: TaskRelationRole;
  describedBy: string;
  onChange(role: TaskRelationRole): void;
}) {
  const name = useId();
  const reduced = useReducedMotion();
  const index = PICKABLE.findIndex((option) => option.role === value);
  const position = useMotionValue(index);
  useEffect(() => {
    const controls = animate(position, index, reduced ? { duration: 0 } : springs.snappy);
    return () => controls.stop();
  }, [index, position, reduced]);
  const x = useTransform(() => `calc(${position.get() * 100}% + ${position.get() * 0.25}rem)`);
  return (
    <div
      role="radiogroup"
      aria-label="Relation"
      aria-describedby={describedBy}
      className="relative grid grid-cols-4 gap-1 rounded-xl bg-foreground/5 p-1"
    >
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-y-1 left-1 w-[calc((100%-1.25rem)/4)] rounded-lg bg-foreground/8 shadow-[inset_0_1px_0_var(--glass-highlight)]"
        style={{ x }}
      />
      {PICKABLE.map(({ role }) => (
        <label
          key={role}
          className="relative flex min-h-11 cursor-pointer select-none items-center justify-center rounded-lg px-1 text-center font-medium text-[0.8125rem] text-foreground/65 leading-tight outline-none transition-colors duration-200 hover:text-foreground has-[:checked]:text-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/70"
        >
          <input
            className="absolute inset-0 cursor-pointer appearance-none rounded-[inherit] opacity-0"
            type="radio"
            name={name}
            checked={value === role}
            onChange={() => onChange(role)}
          />
          {relationRoleLabel[role]}
        </label>
      ))}
    </div>
  );
}

function PickerOption({
  id,
  row,
  query,
  linked,
  otherProject,
  active,
  taken,
  onHover,
  onPick,
}: {
  id: string;
  row: IndexedTask;
  query: string;
  /** How the task is already linked to the open one, if it is. */
  linked: TaskRelationRole | undefined;
  otherProject: boolean;
  active: boolean;
  taken: boolean;
  onHover(): void;
  onPick(): void;
}) {
  const closed = row.status ? isClosedCategory(row.status.category) : false;
  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={active}
      aria-disabled={taken || undefined}
      data-active={active || undefined}
      disabled={taken}
      tabIndex={-1}
      onPointerDown={(event) => event.preventDefault()}
      onPointerMove={taken ? undefined : onHover}
      onClick={onPick}
      className="flex min-h-[3.25rem] w-full min-w-0 shrink-0 items-center gap-3 rounded-xl px-3 py-1.5 text-left outline-none transition-colors duration-150 hover:bg-foreground/[0.05] disabled:cursor-default disabled:opacity-55 disabled:hover:bg-transparent data-active:bg-foreground/[0.07]"
    >
      <StatusGlyph
        category={row.status?.category ?? 'backlog'}
        className="size-4 shrink-0 text-muted-foreground"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('truncate text-sm', closed && 'text-muted-foreground')}>
          {row.task.title ? (
            <Highlighted segments={highlight(row.task.title, query)} />
          ) : (
            'Untitled task'
          )}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
          <span className="shrink-0 font-medium tabular-nums">
            {row.identifier ? (
              <Highlighted segments={highlight(row.identifier, query)} />
            ) : (
              'Pending'
            )}
          </span>
          {otherProject && (
            <span
              data-color={row.project.color}
              className="flex min-w-0 items-center gap-1 text-tint-accent"
            >
              <ProjectIcon name={row.project.icon} className="size-3 shrink-0" />
              <span className="truncate">{row.project.name}</span>
            </span>
          )}
          {row.status && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{row.status.name}</span>
            </>
          )}
        </span>
      </span>
      {linked && (
        <span className="shrink-0 rounded-full bg-foreground/[0.08] px-2 py-0.5 font-medium text-[0.6875rem] text-muted-foreground">
          {relationRoleLabel[linked]}
        </span>
      )}
    </button>
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
