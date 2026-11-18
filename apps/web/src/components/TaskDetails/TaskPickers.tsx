import { compareStatuses, PRIORITIES, type Priority, type Status, type Task } from '@throw/shared';
import { useId } from 'react';
import { PriorityGlyph, StatusGlyph } from '@/components/Board/glyphs';
import { byCategory, type Project, priorityName } from '@/components/Board/model';
import { TagPicker } from '@/components/TagPicker/TagPicker';
import { useTags, useTaskTags } from '@/lib/collections';
import { useAwaitingSync } from '@/lib/syncStatus';
import { setPrimaryTag, setSecondaryTag } from '@/lib/tags';
import { sendTask, updateTask } from '@/lib/tasks';

/*
 * Picker content only. Whatever hosts a picker (the phone drawer, a desktop popover) owns its
 * surface, gestures, Escape and Back, and closes it from `onPicked` (ADR 0009).
 */

const option =
  'flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm hover:bg-foreground/[0.06] has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/60';

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
        if (statusId !== task.statusId) sendTask(task.id, statusId);
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
  return (
    <div role="radiogroup" aria-label="Status" className="space-y-2.5 px-3 pt-1 pb-3">
      {byCategory([...statuses].sort(compareStatuses))
        .filter((group) => group.statuses.length > 0)
        .map((group) => (
          <section key={group.name} aria-label={group.name}>
            <h3 className="px-1 pb-1.5 font-semibold text-[0.6875rem] text-muted-foreground uppercase tracking-[0.06em]">
              {group.name}
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {group.statuses.map((row) => (
                <label
                  key={row.id}
                  className="relative flex h-12 min-w-0 cursor-pointer select-none items-center gap-2 rounded-2xl border border-transparent bg-foreground/[0.06] px-2.5 text-foreground/75 outline-none transition-colors duration-150 has-[:checked]:border-brand has-[:checked]:bg-accent has-[:checked]:text-foreground has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/60"
                >
                  {/* The whole tile is the radio, so a tap anywhere on it picks. */}
                  <input
                    className="absolute inset-0 cursor-pointer appearance-none rounded-2xl opacity-0"
                    type="radio"
                    name={name}
                    checked={value === row.id}
                    onChange={() => onChange(row.id)}
                    // A checked radio fires no change; picking it again still closes the picker.
                    onClick={() => value === row.id && onChange(row.id)}
                  />
                  <StatusGlyph category={row.category} className="size-4 shrink-0" />
                  <span className="min-w-0 truncate font-medium text-[0.8125rem]">{row.name}</span>
                </label>
              ))}
            </div>
          </section>
        ))}
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
        if (priority !== task.priority) updateTask(task.id, { priority });
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
    <div role="radiogroup" aria-label="Priority" className="px-3 pb-3">
      {PRIORITIES.map((priority) => (
        <label key={priority} className={option}>
          <input
            className="order-last size-4 shrink-0 accent-brand"
            aria-label={priorityName(project, priority)}
            type="radio"
            name={name}
            checked={value === priority}
            onChange={() => onChange(priority)}
            onClick={() => value === priority && onChange(priority)}
          />
          <PriorityGlyph priority={priority} name={priorityName(project, priority)} />
          <span className="flex-1">{priorityName(project, priority)}</span>
        </label>
      ))}
    </div>
  );
}

/** Tags take several choices, so picking one leaves the picker open. */
export function TagsPicker({ task }: { task: Task }) {
  const { tags, isLoading } = useTags(task.projectId);
  const { taskTags, isLoading: loadingAssignments } = useTaskTags(task.id);
  const awaitingTags = useAwaitingSync(isLoading, tags.length);
  const awaitingAssignments = useAwaitingSync(loadingAssignments, taskTags.length);
  if (awaitingTags || awaitingAssignments)
    return (
      <p role="status" className="px-6 py-3 text-muted-foreground text-sm">
        Loading tags…
      </p>
    );
  return (
    <div className="px-5 pt-1 pb-3">
      <TagPicker
        tags={tags}
        primaryTagId={task.primaryTagId}
        secondaryTagIds={taskTags.map((row) => row.tagId)}
        onPrimaryChange={(id) => setPrimaryTag(task.id, id)}
        onSecondaryChange={(id, present) => setSecondaryTag(task.id, id, present)}
      />
    </div>
  );
}
