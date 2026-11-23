import {
  type Priority,
  type Size,
  type Status,
  sizeLabel,
  type Task,
  taskTagColor,
} from '@throw/shared';
import { Flag, MoreHorizontal, Scaling, Tag } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { type KeyboardEventHandler, type ReactNode, useEffect } from 'react';
import { PriorityGlyph, StatusGlyph } from '@/components/Board/glyphs';
import { type Project, priorityName } from '@/components/Board/model';
import { leaveTask } from '@/components/Board/state';
import type { TaskDrawerContent } from '@/components/Board/taskContent';
import { touchEditor } from '@/components/DescriptionEditor/editorControls';
import { type ControlProps, DockControl } from '@/components/DockControl/DockControl';
import { FormattingBar } from '@/components/FormattingBar/FormattingBar';
import { RelationPicker } from '@/components/TaskRelations/TaskRelations';
import { useTags, useTaskTags } from '@/lib/collections';
import { useTaskSizeSupport } from '@/lib/compatibility';
import { springs } from '@/lib/motion';
import { TaskActions } from './TaskActions';
import { PriorityPicker, SizePicker, StatusPicker, TaskTagsPicker } from './TaskPickers';

export type TaskPanel = 'status' | 'priority' | 'size' | 'tags' | 'relations' | 'more';
export type DockPanel = Exclude<TaskPanel, 'relations'>;

export const panelTitle: Record<TaskPanel, string> = {
  status: 'Status',
  priority: 'Priority',
  size: 'Size',
  tags: 'Tags',
  relations: 'Link a task',
  more: 'More',
};

const OPEN_PANEL_EVENT = 'throw:open-task-panel';

type OpenPanelDetail = {
  taskId: string;
  panel: TaskPanel;
  trigger?: HTMLElement | null;
};

/**
 * Opens a task panel from outside the dock (for example, an inline “Link a task” button in the
 * Links tab or side column). Both the desktop `TaskDrawer` and the phone drawer listen for it.
 */
export function openTaskPanel(taskId: string, panel: TaskPanel, trigger?: HTMLElement | null) {
  window.dispatchEvent(
    new CustomEvent<OpenPanelDetail>(OPEN_PANEL_EVENT, { detail: { taskId, panel, trigger } }),
  );
}

/** Subscribes a task's dock host to `openTaskPanel` requests for that task. */
export function useOpenTaskPanel(
  taskId: string,
  onRequest: (panel: TaskPanel, trigger?: HTMLElement | null) => void,
) {
  useEffect(() => {
    const listener = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail as OpenPanelDetail | undefined;
      if (!detail || detail.taskId !== taskId) return;
      onRequest(detail.panel, detail.trigger);
    };
    window.addEventListener(OPEN_PANEL_EVENT, listener);
    return () => window.removeEventListener(OPEN_PANEL_EVENT, listener);
  }, [taskId, onRequest]);
}

function tagSummary(tags: { primary: string | null; secondary: string[] }) {
  const names = [
    ...(tags.primary ? [tags.primary] : []),
    ...tags.secondary.filter((name) => name !== tags.primary),
  ];
  return names.join(', ') || 'none';
}

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
  onOpen(panel: DockPanel, element: HTMLButtonElement): void;
  controlProps(panel: DockPanel): ControlProps;
  tooltips?: boolean;
}) {
  const sizeSupported = useTaskSizeSupport();
  const { tags } = useTags(task.projectId);
  const { taskTags } = useTaskTags(task.id);
  const secondary = new Set(taskTags.map((row) => row.tagId));
  return (
    <ControlButtons
      status={statuses.find((row) => row.id === task.statusId)}
      priority={task.priority}
      size={sizeSupported ? (task.size ?? null) : undefined}
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
 * The control buttons themselves, for a task or one still being written: up to five spacious
 * targets — status, priority, optional size, unified tags (tinted with the primary tag's color
 * when the project has tags), and optional task actions.
 */
export function ControlButtons({
  status,
  priority,
  size,
  project,
  tags,
  onOpen,
  controlProps,
  tooltips = true,
  more = false,
}: {
  status: Status | undefined;
  priority: Priority;
  size?: Size | null;
  project: Project;
  /** With no tags in the project there is nothing to pick; the tag manager makes the first. */
  tags: { primary: string | null; secondary: string[]; color: string | null } | null;
  onOpen(panel: DockPanel, element: HTMLButtonElement): void;
  controlProps(panel: DockPanel): ControlProps;
  tooltips?: boolean;
  more?: boolean;
}) {
  return (
    <div className="grid h-[var(--dock-height)] w-full auto-cols-fr grid-flow-col gap-1 p-1">
      <DockControl
        label={`Status: ${status?.name ?? 'Pending'}. Change`}
        tooltip={tooltips}
        {...controlProps('status')}
        onOpen={(element) => onOpen('status', element)}
      >
        <StatusGlyph category={status?.category ?? 'backlog'} color={status?.color} />
      </DockControl>
      <DockControl
        label={`Priority: ${priorityName(project, priority)}. Change`}
        tooltip={tooltips}
        {...controlProps('priority')}
        onOpen={(element) => onOpen('priority', element)}
      >
        {priority === 3 ? (
          <Flag />
        ) : (
          <PriorityGlyph priority={priority} name={priorityName(project, priority)} />
        )}
      </DockControl>
      {size !== undefined && (
        <DockControl
          label={`Size: ${size === null ? 'none' : sizeLabel(size)}. Change`}
          tooltip={tooltips}
          {...controlProps('size')}
          onOpen={(element) => onOpen('size', element)}
        >
          {size === null ? (
            <Scaling />
          ) : (
            <span className="font-semibold text-sm">{sizeLabel(size)}</span>
          )}
        </DockControl>
      )}
      {tags && (
        <DockControl
          label={`Tags: ${tagSummary(tags)}. Change`}
          tooltip={tooltips}
          {...controlProps('tags')}
          onOpen={(element) => onOpen('tags', element)}
        >
          <Tag
            data-color={tags.color ?? undefined}
            className={tags.color ? 'text-tint-accent' : ''}
          />
        </DockControl>
      )}
      {more && (
        <DockControl
          label="More task actions"
          tooltip={tooltips}
          {...controlProps('more')}
          onOpen={(element) => onOpen('more', element)}
        >
          <MoreHorizontal />
        </DockControl>
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
  onLink,
  onClose,
}: {
  panel: TaskPanel;
  task: Task;
  statuses: Status[];
  project: Project;
  onDone(): void;
  onLink(): void;
  /** Shown as a corner close button inside panels that have no dock tab (e.g. desktop relations). */
  onClose?: () => void;
}) {
  if (panel === 'status') return <StatusPicker task={task} statuses={statuses} onPicked={onDone} />;
  if (panel === 'priority')
    return <PriorityPicker task={task} project={project} onPicked={onDone} />;
  if (panel === 'size') return <SizePicker task={task} onPicked={onDone} />;
  if (panel === 'tags') return <TaskTagsPicker task={task} />;
  if (panel === 'relations')
    return <RelationPicker task={task} onPicked={onDone} onClose={onClose} />;
  return <TaskActions task={task} statuses={statuses} onDone={onDone} onLink={onLink} />;
}

/** Connects `openTaskPanel` requests to the phone drawer's `onPage` callback. */
function TaskPanelBridge({
  taskId,
  onPage,
}: {
  taskId: string;
  onPage(page: TaskPanel | null): void;
}) {
  useOpenTaskPanel(taskId, (panel) => onPage(panel));
  return null;
}

/**
 * An open task on a phone, as the board's drawer shows it (ADR 0009): its controls are the
 * dock, and act as tabs over a page holding the picker or actions, with the dock above it.
 * Non-tab pages such as Link a task open with the drawer's own titled header and close button.
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
        <TaskPanelBridge taskId={task.id} onPage={onPage} />
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
      dock: page !== 'relations',
      content:
        page === 'relations' || page === 'tags' ? (
          // Own scroller inside the picker so its bottom controls stay pinned above the safe
          // area or keyboard and the sheet never clips off the top when the keyboard rises.
          <div className="flex max-h-[calc(100dvh-var(--keyboard)-var(--safe-top)-var(--dock-height)-2rem)] min-h-0 flex-1 flex-col pb-[max(0rem,calc(var(--safe-bottom)+0.25rem-var(--keyboard)))] [--tags-max:calc(100dvh-var(--keyboard)-var(--safe-top)-var(--dock-height)-2rem-max(0rem,calc(var(--safe-bottom)+0.25rem-var(--keyboard))))]">
            <TaskPanelContent
              panel={page}
              task={task}
              statuses={statuses}
              project={project}
              onDone={closePage}
              onLink={() => onPage('relations')}
            />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(var(--safe-bottom)+1rem)]">
            <TaskPanelContent
              panel={page}
              task={task}
              statuses={statuses}
              project={project}
              onDone={closePage}
              onLink={() => onPage('relations')}
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
