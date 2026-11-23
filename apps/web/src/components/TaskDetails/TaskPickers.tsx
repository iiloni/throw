import {
  compareStatuses,
  PRIORITIES,
  type Priority,
  SIZES,
  type Size,
  type Status,
  sizeLabel,
  type Tag,
  type Task,
  taskTagColor,
} from '@throw/shared';
import { Check, Palette, Tag as TagIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { PriorityGlyph, StatusGlyph } from '@/components/Board/glyphs';
import { byCategory, type Project, priorityName } from '@/components/Board/model';
import {
  type Branch,
  ColorTagPicker,
  type NewTagPlace,
} from '@/components/ColorTagPicker/ColorTagPicker';
import { NewTagButton, openNewTag } from '@/components/NewTag/NewTag';
import { SegmentedTabs } from '@/components/SegmentedTabs/SegmentedTabs';
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

export function SizePicker({ task, onPicked }: { task: Task; onPicked(): void }) {
  const name = useId();
  const current = task.size ?? null;
  const pick = (size: Size | null) => {
    if (size !== current) {
      haptics.selection();
      updateTask(task.id, { size });
    }
    onPicked();
  };
  return (
    <div role="radiogroup" aria-label="Size" className="grid grid-cols-3 gap-2 p-2">
      {([...SIZES, null] as const).map((size) => (
        <label key={size ?? 'none'} className={cn(target, 'h-12 justify-center px-2')}>
          <input
            className={radio}
            type="radio"
            name={name}
            checked={current === size}
            onChange={() => pick(size)}
            onClick={() => current === size && pick(null)}
          />
          {size === null ? 'None' : sizeLabel(size)}
          <Picked checked={current === size} />
        </label>
      ))}
    </div>
  );
}

export type TagTab = 'primary' | 'secondary';

function useTaskTagsReady(task: Task) {
  const { tags, isLoading } = useTags(task.projectId);
  const { taskTags, isLoading: loadingAssignments } = useTaskTags(task.id);
  const awaitingTags = useAwaitingSync(isLoading, tags.length);
  const awaitingAssignments = useAwaitingSync(loadingAssignments, taskTags.length);
  return { tags, taskTags, awaitingTags, ready: !awaitingTags && !awaitingAssignments };
}

const loadingTags = (
  <p role="status" className="px-1 py-3 text-muted-foreground text-sm">
    Loading tags…
  </p>
);

/**
 * The tags panel's open tab and primary branch while a new tag's form covers it. On a phone the
 * form takes the drawer's page from the picker, so the picker this notes comes back to the same
 * tab and branch once Back closes the form; on desktop the picker stays open beneath, and the
 * note is dropped when the form closes.
 */
let covered: { taskId: string; tab: TagTab; branch: Branch } | null = null;

/**
 * Unified primary (color) and secondary tag picker behind a two-tab switch, shared by an open
 * task and quick capture. Picking leaves the picker open for further choices.
 */
export function TagOptions({
  tags,
  primaryTagId,
  secondaryTagIds,
  onPrimaryChange,
  onSecondaryChange,
  tab,
  onTabChange,
  initialBranch = null,
  onNewPrimaryTag,
  onNewSecondaryTag,
  loadingPrimary = false,
  loadingSecondary = false,
}: {
  tags: readonly Tag[];
  primaryTagId: string | null;
  secondaryTagIds: readonly string[];
  onPrimaryChange: (id: string | null) => void;
  onSecondaryChange: (id: string, present: boolean) => void;
  tab?: TagTab;
  onTabChange?: (tab: TagTab) => void;
  initialBranch?: Branch;
  onNewPrimaryTag?: (place: NewTagPlace) => void;
  onNewSecondaryTag?: () => void;
  loadingPrimary?: boolean;
  loadingSecondary?: boolean;
}) {
  const [internalTab, setInternalTab] = useState<TagTab>('primary');
  const activeTab = tab ?? internalTab;
  const setActiveTab = onTabChange ?? setInternalTab;
  const ids = useId();
  const primaryColor = taskTagColor({ primaryTagId, projectId: tags[0]?.projectId ?? '' }, tags);
  const secondaryCount = secondaryTagIds.filter((id) => tags.some((tag) => tag.id === id)).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pt-2">
        <SegmentedTabs
          label="Tag role"
          value={activeTab}
          onValueChange={(next) => {
            if (next) setActiveTab(next);
          }}
          options={[
            {
              value: 'primary',
              id: `${ids}-primary-tab`,
              controls: `${ids}-primary`,
              label: 'Primary',
              icon: (
                <Palette
                  data-color={primaryColor ?? undefined}
                  className={cn('relative size-4 shrink-0', primaryColor && 'text-tint-accent')}
                  aria-hidden
                />
              ),
            },
            {
              value: 'secondary',
              id: `${ids}-secondary-tab`,
              controls: `${ids}-secondary`,
              label: secondaryCount ? `Secondary · ${secondaryCount}` : 'Secondary',
              icon: <TagIcon className="relative size-4 shrink-0" aria-hidden />,
            },
          ]}
        />
      </div>
      {activeTab === 'primary' ? (
        <div
          role="tabpanel"
          id={`${ids}-primary`}
          aria-labelledby={`${ids}-primary-tab`}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]"
        >
          {loadingPrimary ? (
            <div className="px-3 pt-1 pb-1">{loadingTags}</div>
          ) : (
            <ColorTagPicker
              tags={tags}
              primaryTagId={primaryTagId}
              onChange={onPrimaryChange}
              initialBranch={initialBranch}
              onNewTag={onNewPrimaryTag}
              className="w-full pt-1 pb-1"
            />
          )}
        </div>
      ) : (
        <div
          role="tabpanel"
          id={`${ids}-secondary`}
          aria-labelledby={`${ids}-secondary-tab`}
          className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pt-2 pb-1"
        >
          {onNewSecondaryTag && (
            <div className="mb-1 flex min-h-11 shrink-0 items-center justify-between gap-2">
              <p className="px-1 font-medium text-sm">Secondary tags</p>
              {!loadingSecondary && <NewTagButton onClick={onNewSecondaryTag} />}
            </div>
          )}
          {loadingSecondary ? (
            loadingTags
          ) : (
            <TagPicker
              tags={tags}
              primaryTagId={primaryTagId}
              secondaryTagIds={secondaryTagIds}
              onChange={onSecondaryChange}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The unified Tags panel for an open task: switches between its primary tag (picked by color, as
 * in Catch) and its secondary tags, with a "+" in each view's corner that makes and assigns a
 * new tag at once.
 */
export function TaskTagsPicker({ task }: { task: Task }) {
  const { tags, taskTags, awaitingTags, ready } = useTaskTagsReady(task);
  const mounted = useRef(false);
  const restored = useRef(covered?.taskId === task.id ? covered : null).current;
  const [tab, setTab] = useState<TagTab>(restored?.tab ?? 'primary');
  const [initialBranch, setInitialBranch] = useState<Branch>(restored?.branch ?? null);
  useEffect(() => {
    mounted.current = true;
    covered = null;
    return () => {
      mounted.current = false;
    };
  }, []);

  return (
    <TagOptions
      tags={tags}
      primaryTagId={task.primaryTagId}
      secondaryTagIds={taskTags.map((row) => row.tagId)}
      onPrimaryChange={(id) => setPrimaryTag(task.id, id)}
      onSecondaryChange={(id, present) => setSecondaryTag(task.id, id, present)}
      tab={tab}
      onTabChange={(next) => {
        setTab(next);
        setInitialBranch(null);
      }}
      initialBranch={initialBranch}
      loadingPrimary={awaitingTags}
      loadingSecondary={!ready}
      onNewPrimaryTag={({ parentId, color, branch }) => {
        covered = { taskId: task.id, tab: 'primary', branch };
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
      onNewSecondaryTag={() => {
        covered = { taskId: task.id, tab: 'secondary', branch: null };
        openNewTag({
          projectId: task.projectId,
          parentId: null,
          onCreated: (id) => setSecondaryTag(task.id, id, true),
          onClose: () => {
            if (mounted.current) covered = null;
          },
        });
      }}
    />
  );
}
