import { compareStatuses, PRIORITIES, type Priority, type Status, type Task } from '@throw/shared';
import { Check } from 'lucide-react';
import { useId } from 'react';
import { PriorityGlyph, StatusGlyph } from '@/components/Board/glyphs';
import { byCategory, type Project, priorityName } from '@/components/Board/model';
import { ColorTagPicker } from '@/components/ColorTagPicker/ColorTagPicker';
import { TagPicker } from '@/components/TagPicker/TagPicker';
import { useTags, useTaskTags } from '@/lib/collections';
import { feelStatusChange, haptics } from '@/lib/haptics';
import { useAwaitingSync } from '@/lib/syncStatus';
import { setPrimaryTag, setSecondaryTag } from '@/lib/tags';
import { sendTask, updateTask } from '@/lib/tasks';
import { cn } from '@/lib/utils';

/*
 * Picker content only. Whatever hosts a picker (the phone drawer, a desktop popover) owns its
 * surface, gestures, Escape and Back, and closes it from `onPicked` (ADR 0009).
 */

/*
 * Catch's move picker: rows and tiles on a faint surface, the current one outlined and
 * checked. The whole row is the radio, so a tap anywhere on it picks.
 */
const target =
  'relative flex min-w-0 cursor-pointer select-none items-center gap-2.5 rounded-[calc(var(--dock-radius)-0.25rem)] border-2 font-medium text-sm outline-none transition-colors duration-200 has-[:checked]:border-brand has-[:checked]:bg-foreground/[0.08] has-[:checked]:text-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/70 border-transparent bg-foreground/[0.04] text-foreground/80 hover:bg-foreground/[0.07]';
const radio = 'absolute inset-0 cursor-pointer appearance-none rounded-[inherit] opacity-0';

function Picked({ checked }: { checked: boolean }) {
  return checked ? <Check className="size-4 shrink-0 text-foreground" aria-hidden /> : null;
}

/** The board's status grid, as the phone's move drawer shows it, with the current one picked. */
export function StatusPicker({
  task,
  statuses,
  onPicked,
}: {
  task: Task;
  statuses: Status[];
  onPicked(): void;
}) {
  return (
    <StatusOptions
      value={task.statusId}
      statuses={statuses}
      onChange={(statusId) => {
        const next = statuses.find((status) => status.id === statusId);
        if (next && statusId !== task.statusId) {
          sendTask(task.id, statusId);
          feelStatusChange(next.category);
        }
        onPicked();
      }}
    />
  );
}

/** The status grid on its own, for a task that does not exist yet. */
export function StatusOptions({
  value,
  statuses,
  onChange,
}: {
  value: string;
  statuses: Status[];
  onChange(statusId: string): void;
}) {
  const name = useId();
  const [backlog, active, closed] = byCategory([...statuses].sort(compareStatuses));
  // The board's columns are rows, as Catch lists the Deck's; the backlog and closed statuses
  // sit beside them as tiles, as Catch's Gallery does. In category order for the keyboard.
  const tile = (row: Status, rows: boolean) => (
    <label
      key={row.id}
      className={cn(
        target,
        rows ? 'h-12 shrink-0 px-4' : 'min-h-12 flex-1 flex-col justify-center gap-1 px-2 py-2.5',
      )}
    >
      <input
        className={radio}
        type="radio"
        name={name}
        checked={value === row.id}
        onChange={() => onChange(row.id)}
        // A checked radio fires no change; picking it again still closes the picker.
        onClick={() => value === row.id && onChange(row.id)}
      />
      <StatusGlyph category={row.category} className={rows ? 'size-4' : 'size-5'} />
      <span className={cn('min-w-0 truncate', rows ? 'flex-1' : 'max-w-full text-[0.8125rem]')}>
        {row.name}
      </span>
      {rows && <Picked checked={value === row.id} />}
    </label>
  );
  const side = (group: typeof backlog, row: string) =>
    group && group.statuses.length > 0 ? (
      <section aria-label={group.name} className={cn('col-start-2 flex flex-col gap-1.5', row)}>
        {group.statuses.map((status) => tile(status, false))}
      </section>
    ) : null;
  return (
    <div
      role="radiogroup"
      aria-label="Status"
      className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-1.5 px-2 pt-2 pb-1"
    >
      {side(backlog, 'row-start-1')}
      {active && active.statuses.length > 0 && (
        <section
          aria-label={active.name}
          className="col-start-1 row-span-2 row-start-1 flex max-h-[50dvh] flex-col gap-1.5 overflow-y-auto [scrollbar-width:none]"
        >
          {active.statuses.map((status) => tile(status, true))}
        </section>
      )}
      {side(closed, 'row-start-2')}
    </div>
  );
}

export function PriorityPicker({
  task,
  project,
  onPicked,
}: {
  task: Task;
  project: Project;
  onPicked(): void;
}) {
  return (
    <PriorityOptions
      value={task.priority}
      project={project}
      onChange={(priority) => {
        if (priority !== task.priority) {
          haptics.selection();
          updateTask(task.id, { priority });
        }
        onPicked();
      }}
    />
  );
}

export function PriorityOptions({
  value,
  project,
  onChange,
}: {
  value: Priority;
  project: Project;
  onChange(priority: Priority): void;
}) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label="Priority" className="flex flex-col gap-1.5 px-2 pt-2 pb-1">
      {PRIORITIES.map((priority) => (
        <label key={priority} className={cn(target, 'h-12 shrink-0 px-4')}>
          <input
            className={radio}
            aria-label={priorityName(project, priority)}
            type="radio"
            name={name}
            checked={value === priority}
            onChange={() => onChange(priority)}
            onClick={() => value === priority && onChange(priority)}
          />
          {/* A slot even for the default, which has no glyph, so the names line up. */}
          <span className="flex size-4 shrink-0 items-center justify-center">
            <PriorityGlyph priority={priority} name={priorityName(project, priority)} />
          </span>
          <span className="flex-1">{priorityName(project, priority)}</span>
          <Picked checked={value === priority} />
        </label>
      ))}
    </div>
  );
}

function useTaskTagsReady(task: Task) {
  const { tags, isLoading } = useTags(task.projectId);
  const { taskTags, isLoading: loadingAssignments } = useTaskTags(task.id);
  const awaitingTags = useAwaitingSync(isLoading, tags.length);
  const awaitingAssignments = useAwaitingSync(loadingAssignments, taskTags.length);
  return { tags, taskTags, ready: !awaitingTags && !awaitingAssignments };
}

const loadingTags = (
  <p role="status" className="px-1 py-3 text-muted-foreground text-sm">
    Loading tags…
  </p>
);

/**
 * The primary tag, picked by color as in Catch. Picking leaves the picker open, since a
 * tag with children opens them to pick a more specific one.
 */
export function ColorTagsPicker({ task }: { task: Task }) {
  const { tags, isLoading } = useTags(task.projectId);
  // The color reads the project's tags only, not the task's secondary assignments.
  if (useAwaitingSync(isLoading, tags.length)) return <div className="px-3">{loadingTags}</div>;
  return (
    <ColorTagPicker
      tags={tags}
      primaryTagId={task.primaryTagId}
      onChange={(id) => setPrimaryTag(task.id, id)}
      className="w-full pt-1 pb-1"
    />
  );
}

/** Secondary tags take several choices, so picking one leaves the picker open. */
export function TagsPicker({ task }: { task: Task }) {
  const { tags, taskTags, ready } = useTaskTagsReady(task);
  return (
    <div className="px-3 pt-3 pb-1">
      <p className="mb-1 px-1 font-medium text-sm">Secondary tags</p>
      {ready ? (
        <TagPicker
          tags={tags}
          primaryTagId={task.primaryTagId}
          secondaryTagIds={taskTags.map((row) => row.tagId)}
          onChange={(id, present) => setSecondaryTag(task.id, id, present)}
        />
      ) : (
        loadingTags
      )}
    </div>
  );
}
