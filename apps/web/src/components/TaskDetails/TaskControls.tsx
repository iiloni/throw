import { type Priority, type Status, type Task, taskTagColor } from '@throw/shared';
import { Flag, MoreHorizontal, Tag } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import { PriorityGlyph, StatusGlyph } from '@/components/Board/glyphs';
import { type Project, priorityName } from '@/components/Board/model';
import { leaveTask } from '@/components/Board/state';
import type { TaskDrawerContent } from '@/components/Board/taskContent';
import { IconButton } from '@/components/IconButton/IconButton';
import { useTags, useTaskTags } from '@/lib/collections';
import { TaskActions } from './TaskActions';
import { PriorityPicker, StatusPicker, TagsPicker } from './TaskPickers';

export type TaskPanel = 'status' | 'priority' | 'tags' | 'more';

export const panelTitle: Record<TaskPanel, string> = {
  status: 'Status',
  priority: 'Priority',
  tags: 'Tags',
  more: 'More',
};

const control =
  'h-[var(--dock-height)] flex-1 rounded-[var(--dock-radius)] bg-foreground/[0.06] transition-colors duration-200 aria-expanded:bg-foreground/[0.14] aria-expanded:shadow-[inset_0_1px_0_var(--glass-highlight)] [&_svg]:size-6';

type ControlProps = Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-expanded' | 'aria-controls'
>;

/** The task's controls, as Catch's note toolbar: the pane drawer's header, or a phone's dock. */
export function TaskControls({
  task,
  statuses,
  project,
  onOpen,
  controlProps,
  tooltips = true,
}: {
  task: Task;
  statuses: Status[];
  project: Project;
  onOpen(panel: TaskPanel, element: HTMLButtonElement): void;
  controlProps(panel: TaskPanel): ControlProps;
  tooltips?: boolean;
}) {
  const { tags } = useTags(task.projectId);
  const { taskTags } = useTaskTags(task.id);
  const secondary = new Set(taskTags.map((row) => row.tagId));
  const tagNames = [
    ...tags.filter((tag) => tag.id === task.primaryTagId),
    ...tags
      .filter((tag) => secondary.has(tag.id) && tag.id !== task.primaryTagId)
      .sort((a, b) => a.name.localeCompare(b.name)),
  ].map((tag) => tag.name);
  return (
    <ControlButtons
      status={statuses.find((row) => row.id === task.statusId)}
      priority={task.priority}
      project={project}
      tags={tags.length > 0 ? { names: tagNames, color: taskTagColor(task, tags) } : null}
      onOpen={onOpen}
      controlProps={controlProps}
      tooltips={tooltips}
      more
    />
  );
}

/**
 * The control buttons themselves, for a task or one still being written: status, priority,
 * tags when the project has any, and optionally the rest of the task's actions.
 */
export function ControlButtons({
  status,
  priority,
  project,
  tags,
  onOpen,
  controlProps,
  tooltips = true,
  more = false,
}: {
  status: Status | undefined;
  priority: Priority;
  project: Project;
  /** Tags are made in the project's tag manager; with none, there is nothing to pick. */
  tags: { names: string[]; color: string | null } | null;
  onOpen(panel: TaskPanel, element: HTMLButtonElement): void;
  controlProps(panel: TaskPanel): ControlProps;
  tooltips?: boolean;
  more?: boolean;
}) {
  return (
    <div className="flex h-[var(--dock-height)] w-full items-center justify-around gap-2">
      <IconButton
        label={`Status: ${status?.name ?? 'Pending'}. Change`}
        className={control}
        tooltip={tooltips}
        {...controlProps('status')}
        onClick={(event) => onOpen('status', event.currentTarget)}
      >
        <StatusGlyph category={status?.category ?? 'backlog'} />
      </IconButton>
      <IconButton
        label={`Priority: ${priorityName(project, priority)}. Change`}
        className={control}
        tooltip={tooltips}
        {...controlProps('priority')}
        onClick={(event) => onOpen('priority', event.currentTarget)}
      >
        {priority === 3 ? (
          <Flag />
        ) : (
          <PriorityGlyph priority={priority} name={priorityName(project, priority)} />
        )}
      </IconButton>
      {tags && (
        <IconButton
          label={`Tags: ${tags.names.join(', ') || 'none'}. Change`}
          className={control}
          tooltip={tooltips}
          {...controlProps('tags')}
          onClick={(event) => onOpen('tags', event.currentTarget)}
        >
          <Tag
            data-color={tags.color ?? undefined}
            className={tags.color ? 'text-tint-accent' : ''}
          />
        </IconButton>
      )}
      {more && (
        <IconButton
          label="More task actions"
          className={control}
          tooltip={tooltips}
          {...controlProps('more')}
          onClick={(event) => onOpen('more', event.currentTarget)}
        >
          <MoreHorizontal />
        </IconButton>
      )}
    </div>
  );
}

export function TaskPanelContent({
  panel,
  task,
  statuses,
  project,
  onDone,
}: {
  panel: TaskPanel;
  task: Task;
  statuses: Status[];
  project: Project;
  onDone(): void;
}) {
  if (panel === 'status') return <StatusPicker task={task} statuses={statuses} onPicked={onDone} />;
  if (panel === 'priority')
    return <PriorityPicker task={task} project={project} onPicked={onDone} />;
  if (panel === 'tags') return <TagsPicker task={task} />;
  return <TaskActions task={task} statuses={statuses} onDone={onDone} />;
}

/**
 * An open task on a phone, as the board's drawer shows it (ADR 0009): its controls are the
 * dock, and act as tabs over a page holding the picker or actions, with the dock above it.
 */
export function taskDrawerContent({
  task,
  statuses,
  project,
  page,
  onPage,
}: {
  task: Task;
  statuses: Status[];
  project: Project;
  page: TaskPanel | null;
  onPage(page: TaskPanel | null): void;
}): TaskDrawerContent {
  const closePage = () => onPage(null);
  return {
    dock: (
      <div
        role="toolbar"
        aria-label="Task controls"
        data-task-drawer=""
        onKeyDown={(event) => {
          // The dock belongs to the open task, so Escape there leaves it as it does in it. With
          // a panel open, the drawer takes Escape to close the panel.
          if (event.key !== 'Escape' || event.defaultPrevented || page) return;
          event.preventDefault();
          leaveTask();
        }}
      >
        <TaskControls
          task={task}
          statuses={statuses}
          project={project}
          onOpen={(panel) => onPage(panel === page ? null : panel)}
          controlProps={(panel) => ({ 'aria-expanded': panel === page })}
          tooltips={false}
        />
      </div>
    ),
    page: page && {
      key: page,
      title: panelTitle[page],
      fit: true,
      dock: true,
      content: (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(var(--safe-bottom)+1rem)]">
          <TaskPanelContent
            panel={page}
            task={task}
            statuses={statuses}
            project={project}
            onDone={closePage}
          />
        </div>
      ),
    },
    closePage,
  };
}
