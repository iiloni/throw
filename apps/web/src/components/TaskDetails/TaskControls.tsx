import { type Priority, type Status, type Task, taskTagColor } from '@throw/shared';
import { Flag, MoreHorizontal, Palette, Tag } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ButtonHTMLAttributes, KeyboardEventHandler, ReactNode } from 'react';
import { PriorityGlyph, StatusGlyph } from '@/components/Board/glyphs';
import { type Project, priorityName } from '@/components/Board/model';
import { leaveTask } from '@/components/Board/state';
import type { TaskDrawerContent } from '@/components/Board/taskContent';
import { touchEditor } from '@/components/DescriptionEditor/editorControls';
import { FormattingBar } from '@/components/FormattingBar/FormattingBar';
import { IconButton } from '@/components/IconButton/IconButton';
import { useTags, useTaskTags } from '@/lib/collections';
import { springs } from '@/lib/motion';
import { TaskActions } from './TaskActions';
import { ColorTagsPicker, PriorityPicker, StatusPicker, TagsPicker } from './TaskPickers';

export type TaskPanel = 'status' | 'priority' | 'color' | 'tags' | 'more';

export const panelTitle: Record<TaskPanel, string> = {
  status: 'Status',
  priority: 'Priority',
  color: 'Color',
  tags: 'Tags',
  more: 'More',
};

// As Catch's note toolbar: inset in the dock so their corners follow its corners, and only
// the one whose panel is open takes a surface.
const control =
  'size-full rounded-[calc(var(--dock-radius)-0.25rem)] text-foreground/80 transition-[background-color,color,scale] duration-200 hover:bg-foreground/[0.05] hover:text-foreground active:scale-[0.92] aria-expanded:bg-foreground/[0.08] aria-expanded:text-foreground aria-expanded:shadow-[inset_0_1px_0_var(--glass-highlight)] [&_svg]:size-6!';

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
  return (
    <ControlButtons
      status={statuses.find((row) => row.id === task.statusId)}
      priority={task.priority}
      project={project}
      tags={
        tags.length > 0
          ? {
              primary: tags.find((tag) => tag.id === task.primaryTagId)?.name ?? null,
              secondary: tags
                .filter((tag) => secondary.has(tag.id))
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((tag) => tag.name),
              color: taskTagColor(task, tags),
            }
          : null
      }
      onOpen={onOpen}
      controlProps={controlProps}
      tooltips={tooltips}
      more
    />
  );
}

/**
 * The control buttons themselves, for a task or one still being written: status, priority,
 * and when the project has tags, its color (the primary tag) and its other tags, as Catch
 * keeps a note's color and tags apart; optionally the rest of the task's actions.
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
  tags: { primary: string | null; secondary: string[]; color: string | null } | null;
  onOpen(panel: TaskPanel, element: HTMLButtonElement): void;
  controlProps(panel: TaskPanel): ControlProps;
  tooltips?: boolean;
  more?: boolean;
}) {
  return (
    <div className="grid h-[var(--dock-height)] w-full auto-cols-fr grid-flow-col gap-1 p-1">
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
          label={`Color: ${tags.primary ?? 'none'}. Change`}
          className={control}
          tooltip={tooltips}
          {...controlProps('color')}
          onClick={(event) => onOpen('color', event.currentTarget)}
        >
          <Palette
            data-color={tags.color ?? undefined}
            className={tags.color ? 'text-tint-accent' : ''}
          />
        </IconButton>
      )}
      {tags && (
        <IconButton
          label={`Tags: ${tags.secondary.join(', ') || 'none'}. Change`}
          className={control}
          tooltip={tooltips}
          {...controlProps('tags')}
          onClick={(event) => onOpen('tags', event.currentTarget)}
        >
          <Tag />
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
  if (panel === 'color') return <ColorTagsPicker task={task} />;
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
      <div data-task-drawer="">
        <TaskDockRow
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
        </TaskDockRow>
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

/**
 * The task's controls, or Catch's formatting bar in their place while a finger types in the
 * task's description or a comment: the keyboard covers the page, and the dock rides above it.
 */
export function TaskDockRow({
  children,
  onKeyDown,
}: {
  children: ReactNode;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
}) {
  const editor = touchEditor.use();
  const reduced = useReducedMotion();
  const transition = reduced ? { duration: 0 } : springs.snappy;
  return (
    <div className="relative h-[var(--dock-height)]">
      <AnimatePresence initial={false} mode="popLayout">
        {editor ? (
          <motion.div
            key="format"
            className="absolute inset-0 flex items-center px-2"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={transition}
          >
            <FormattingBar controls={editor} className="flex-1 [&_button]:size-11 [&_svg]:size-5" />
          </motion.div>
        ) : (
          <motion.div
            key="controls"
            role="toolbar"
            aria-label="Task controls"
            onKeyDown={onKeyDown}
            className="absolute inset-0"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={transition}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
