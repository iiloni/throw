import { useMemo } from 'react';
import { toast } from 'sonner';
import { identifier, type Project, type Task } from '@/components/Board/model';
import { selectionProject, shared } from '@/components/Board/SelectionActions';
import { board, current } from '@/components/Board/state';
import type { SelectionContent, SelectionPanel } from '@/components/Board/taskContent';
import { PriorityOptions, SizeOptions, TagOptions } from '@/components/TaskDetails/TaskPickers';
import { useTags } from '@/lib/collections';
import { useTaskSizeSupport } from '@/lib/compatibility';
import { haptics } from '@/lib/haptics';
import { useAwaitingSync } from '@/lib/syncStatus';
import { setPrimaryTags, setSecondaryTags } from '@/lib/tags';
import { restoreTasks, trashTasks, updateTasks } from '@/lib/tasks';

/**
 * Stands for a primary tag the selected tasks do not share. No tag has it, so no color is
 * marked and "No color tag" stays a choice that clears them all.
 */
const MIXED = '';

/** The selection's pickers and trash for a synced board, supplied at its boundary. */
export function useSelectionContent(): SelectionContent {
  const sizes = useTaskSizeSupport();
  return useMemo(
    () => ({
      sizes,
      panel: (panel, taskIds, onDone) => (
        <BulkPanel panel={panel} taskIds={taskIds} onDone={onDone} />
      ),
      trash: trashSelected,
    }),
    [sizes],
  );
}

/** Trashes the tasks, each on its own, and offers to bring back exactly those. */
export function trashSelected(taskIds: string[]) {
  const { project, tasks } = current();
  const trashed = trashTasks(taskIds);
  if (trashed.length === 0) return;
  haptics.warning();
  const only = trashed.length === 1 ? tasks.find((task) => task.id === trashed[0]) : undefined;
  const label = only && identifier(project, only);
  toast(
    trashed.length > 1
      ? `${trashed.length} tasks moved to the trash`
      : label
        ? `${label} moved to the trash`
        : 'Task moved to the trash',
    {
      action: {
        label: 'Undo',
        onClick: () => {
          if (restoreTasks(trashed).length > 0) haptics.success();
        },
      },
    },
  );
}

function BulkPanel({
  panel,
  taskIds,
  onDone,
}: {
  panel: SelectionPanel;
  taskIds: string[];
  onDone: () => void;
}) {
  const state = board.use();
  const data = current(state);
  const tasks = [...data.tasks, ...(data.hiddenTasks ?? [])].filter((task) =>
    taskIds.includes(task.id),
  );
  const own = selectionProject(data.project, tasks);
  if (tasks.length === 0) return null;
  if (panel === 'priority') {
    const value = shared(tasks.map((task) => task.priority)) ?? null;
    return (
      <PriorityOptions
        value={value}
        // Rank names are a project's own; across projects the board's shared names stand.
        project={own ?? data.project}
        onChange={(priority) => {
          const changing = tasks.filter((task) => task.priority !== priority);
          if (changing.length > 0) {
            haptics.selection();
            updateTasks(
              changing.map((task) => task.id),
              { priority },
            );
          }
          onDone();
        }}
      />
    );
  }
  if (panel === 'size') {
    const value = shared(tasks.map((task) => task.size));
    return (
      <SizeOptions
        value={value}
        onChange={(size) => {
          const changing = tasks.filter((task) => task.size !== size);
          if (changing.length > 0) {
            haptics.selection();
            updateTasks(
              changing.map((task) => task.id),
              { size },
            );
          }
          onDone();
        }}
      />
    );
  }
  return own ? <BulkTags tasks={tasks} project={own} /> : null;
}

/**
 * The unified Tags panel for tasks of one project. A color picks every task's primary tag; a
 * secondary tag is checked when every task has it, and checking or unchecking it applies to all.
 */
function BulkTags({ tasks, project }: { tasks: Task[]; project: Project }) {
  const { tags, isLoading } = useTags(project.id);
  const awaiting = useAwaitingSync(isLoading, tags.length);
  const ids = tasks.map((task) => task.id);
  const primary = shared(tasks.map((task) => task.primaryTagId));
  const secondary = tags
    .filter((tag) => tasks.every((task) => task.secondaryTagIds.includes(tag.id)))
    .map((tag) => tag.id);
  return (
    <TagOptions
      tags={tags}
      primaryTagId={primary === undefined ? MIXED : primary}
      secondaryTagIds={secondary}
      onPrimaryChange={(id) => setPrimaryTags(ids, id)}
      onSecondaryChange={(id, present) => setSecondaryTags(ids, id, present)}
      loadingPrimary={awaiting}
      loadingSecondary={awaiting}
    />
  );
}
