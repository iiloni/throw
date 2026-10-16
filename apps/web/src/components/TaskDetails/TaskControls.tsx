import type { Status, Task } from '@throw/shared';
import { Flag, MoreHorizontal } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import { PriorityGlyph, StatusGlyph } from '@/components/Board/glyphs';
import { type Project, priorityName } from '@/components/Board/model';
import { update } from '@/components/Board/state';
import type { TaskDrawerContent } from '@/components/Board/taskContent';
import { IconButton } from '@/components/IconButton/IconButton';
import { TaskActions } from './TaskActions';
import { PriorityPicker, StatusPicker } from './TaskPickers';

export type TaskPanel = 'status' | 'priority' | 'more';

export const panelTitle: Record<TaskPanel, string> = {
  status: 'Status',
  priority: 'Priority',
  more: 'More',
};

const control =
  'h-[var(--dock-height)] flex-1 rounded-[var(--dock-radius)] bg-foreground/[0.06] [&_svg]:size-6';

type ControlProps = Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-expanded' | 'aria-controls' | 'aria-haspopup'
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
  const status = statuses.find((row) => row.id === task.statusId);
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
        label={`Priority: ${priorityName(project, task.priority)}. Change`}
        className={control}
        tooltip={tooltips}
        {...controlProps('priority')}
        onClick={(event) => onOpen('priority', event.currentTarget)}
      >
        {task.priority === 3 ? (
          <Flag />
        ) : (
          <PriorityGlyph priority={task.priority} name={priorityName(project, task.priority)} />
        )}
      </IconButton>
      {/* Tags: mount the Tags control and its panel here when PR #8 lands on main. */}
      <IconButton
        label="More task actions"
        className={control}
        tooltip={tooltips}
        {...controlProps('more')}
        onClick={(event) => onOpen('more', event.currentTarget)}
      >
        <MoreHorizontal />
      </IconButton>
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
  return <TaskActions task={task} statuses={statuses} onDone={onDone} />;
}

/**
 * An open task on a phone, as the board's drawer shows it (ADR 0009): its controls are the
 * dock, and each opens its picker or actions as a page.
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
          // The dock belongs to the open task, so Escape there closes the task as it does in it.
          if (event.key !== 'Escape' || event.defaultPrevented) return;
          event.preventDefault();
          update({ openTaskId: null });
        }}
      >
        <TaskControls
          task={task}
          statuses={statuses}
          project={project}
          onOpen={(panel) => onPage(panel)}
          controlProps={() => ({ 'aria-haspopup': 'dialog' })}
          tooltips={false}
        />
      </div>
    ),
    page: page && {
      key: page,
      title: panelTitle[page],
      fit: true,
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
