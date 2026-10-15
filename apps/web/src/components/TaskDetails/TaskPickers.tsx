import { compareStatuses, PRIORITIES, type Status, type Task } from '@throw/shared';
import { useId } from 'react';
import { PriorityGlyph, StatusGlyph } from '@/components/Board/glyphs';
import { type Project, priorityName } from '@/components/Board/model';
import { sendTask, updateTask } from '@/lib/tasks';

/*
 * Picker content only. Whatever hosts a picker (the phone drawer, a desktop popover) owns its
 * surface, gestures, Escape and Back, and closes it from `onPicked` (ADR 0009).
 */

const CATEGORIES = [
  ['backlog', 'Backlog'],
  ['active', 'Active'],
  ['done', 'Done'],
  ['cancelled', 'Cancelled'],
] as const;

const option =
  'flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm hover:bg-foreground/[0.06] has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/60';

export function StatusPicker({
  task,
  statuses,
  onPicked,
}: {
  task: Task;
  statuses: Status[];
  onPicked(): void;
}) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label="Status" className="px-3 pb-3">
      {CATEGORIES.map(([category, label]) => (
        <div key={category}>
          <p className="px-3 pt-3 pb-1 text-muted-foreground text-xs">{label}</p>
          {statuses
            .filter((row) => row.category === category)
            .sort(compareStatuses)
            .map((row) => (
              <label key={row.id} className={option}>
                <input
                  className="order-last size-4 shrink-0 accent-brand"
                  type="radio"
                  name={name}
                  checked={task.statusId === row.id}
                  onChange={() => {
                    sendTask(task.id, row.id);
                    onPicked();
                  }}
                />
                <StatusGlyph category={row.category} />
                <span className="flex-1">{row.name}</span>
              </label>
            ))}
        </div>
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
            checked={task.priority === priority}
            onChange={() => {
              updateTask(task.id, { priority });
              onPicked();
            }}
          />
          <PriorityGlyph priority={priority} name={priorityName(project, priority)} />
          <span className="flex-1">{priorityName(project, priority)}</span>
        </label>
      ))}
    </div>
  );
}
