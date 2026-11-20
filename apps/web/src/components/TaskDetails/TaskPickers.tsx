import { compareStatuses, PRIORITIES, type Priority, type Status, type Task } from '@throw/shared';
import { Check } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { PriorityGlyph, StatusGlyph } from '@/components/Board/glyphs';
import { byCategory, type Project, priorityName } from '@/components/Board/model';
import { type Branch, ColorTagPicker } from '@/components/ColorTagPicker/ColorTagPicker';
import { NewTagButton, openNewTag } from '@/components/NewTag/NewTag';
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
 * The color panel's open branch while a new tag's form covers it. On a phone the form takes the
 * drawer's page from the picker, so the picker this notes comes back to it once Back closes the
 * form; on desktop the picker stays open beneath, and the note is dropped when the form closes.
 */
let covered: { taskId: string; branch: Branch } | null = null;

/**
 * The primary tag, picked by color as in Catch. Picking leaves the picker open, since a
 * tag with children opens them to pick a more specific one. A new tag made from its corner
 * becomes the primary.
 */
export function ColorTagsPicker({ task }: { task: Task }) {
  const { tags, isLoading } = useTags(task.projectId);
  const mounted = useRef(false);
  const initialBranch = useRef(covered?.taskId === task.id ? covered.branch : null).current;
  useEffect(() => {
    mounted.current = true;
    covered = null;
    return () => {
      mounted.current = false;
    };
  }, []);
  // The color reads the project's tags only, not the task's secondary assignments.
  if (useAwaitingSync(isLoading, tags.length)) return <div className="px-3">{loadingTags}</div>;
  return (
    <ColorTagPicker
      tags={tags}
      primaryTagId={task.primaryTagId}
      onChange={(id) => setPrimaryTag(task.id, id)}
      initialBranch={initialBranch}
      onNewTag={({ parentId, color, branch }) => {
        covered = { taskId: task.id, branch };
        openNewTag({
          projectId: task.projectId,
          parentId,
          color,
          onCreated: (id) => setPrimaryTag(task.id, id),
          onClose: () => {
            if (mounted.current) covered = null;
          },
        });
      }}
      className="w-full pt-1 pb-1"
    />
  );
}

/**
 * Secondary tags take several choices, so picking one leaves the picker open. A new tag made
 * from the heading's corner is added to them.
 */
export function TagsPicker({ task }: { task: Task }) {
  const { tags, taskTags, ready } = useTaskTagsReady(task);
  return (
    <div className="px-3 pt-2 pb-1">
      <div className="mb-1 flex min-h-11 items-center justify-between gap-2">
        <p className="px-1 font-medium text-sm">Secondary tags</p>
        {ready && (
          <NewTagButton
            onClick={() =>
              openNewTag({
                projectId: task.projectId,
                parentId: null,
                onCreated: (id) => setSecondaryTag(task.id, id, true),
              })
            }
          />
        )}
      </div>
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
