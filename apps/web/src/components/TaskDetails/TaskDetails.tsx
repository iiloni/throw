import {
  type ActivityEntry,
  comparePositions,
  type Project,
  type Status,
  type Tag,
  type Task,
  taskIdentifier,
  taskTagColor,
} from '@throw/shared';
import { ChevronLeft, ChevronRight, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useContext, useEffect, useMemo, useState } from 'react';
import { StatusGlyph } from '@/components/Board/glyphs';
import { type Task as BoardTask, projectOf } from '@/components/Board/model';
import { StatusMenu } from '@/components/Board/StatusMenu';
import {
  board,
  current,
  leaveTask,
  openNewSubtask,
  openSubtask,
  update,
} from '@/components/Board/state';
import { CARD_STATUS_CONTROL, TaskCard } from '@/components/Board/TaskCard';
import { cardSurface, TaskTitle } from '@/components/Board/TaskView';
import { TaskScrollContext } from '@/components/Board/taskMotionContext';
import { IconButton } from '@/components/IconButton/IconButton';
import { TaskTags } from '@/components/TaskTags/TaskTags';
import { ScrollArea, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import { useTags, useTaskTags } from '@/lib/collections';
import { haptics } from '@/lib/haptics';
import { createTask, restoreTask, sendTask, trashTask } from '@/lib/tasks';
import { cn } from '@/lib/utils';
import { TaskDescription } from './TaskDescription';
import { TaskDrawer } from './TaskDrawer';
import { TaskRefusalNotice, TaskTimeline } from './TaskTimeline';

function boardTask(task: Task, tags: readonly Tag[]): BoardTask {
  return {
    ...task,
    closedAt: task.closedAt === null ? null : Date.parse(task.closedAt),
    primaryTagColor: taskTagColor(task, tags),
    secondaryTagIds: [],
    description: undefined,
  };
}

function TaskTagList({ task, tags }: { task: Task; tags: readonly Tag[] }) {
  const { taskTags } = useTaskTags(task.id);
  return (
    <div data-task-tags="" className="mt-3 empty:hidden">
      <TaskTags
        tags={tags}
        primaryTagId={task.primaryTagId}
        secondaryTagIds={taskTags.map((row) => row.tagId)}
      />
    </div>
  );
}

export function TaskDetails({
  task,
  project,
  statuses,
  tasks,
  phone = false,
}: {
  task: Task;
  project: Project;
  statuses: Status[];
  tasks: Task[];
  /** On a phone the task's controls are the board drawer's dock (ADR 0009), resting over it. */
  phone?: boolean;
}) {
  const attachScroll = useContext(TaskScrollContext);
  const { tags } = useTags(project.id);
  const parent = tasks.find((row) => row.id === task.parentId);
  const state = board.use();
  // The task this one was opened from, if any: Back returns there rather than to the board.
  const stack = [...state.taskTrail, state.openTaskId];
  const below = tasks.find((row) => row.id === stack[stack.indexOf(task.id) - 1]);
  const children = tasks
    .filter((row) => row.parentId === task.id && row.deletedAt === null)
    .sort((a, b) => comparePositions(a.position, b.position) || a.id.localeCompare(b.id));
  // On the workspace board, the task's own project: its subtasks move among its statuses.
  const boardProject = projectOf(current().project, task);
  const [recovery, setRecovery] = useState<ActivityEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The board's copies carry each subtask's secondary tags, including under a trashed parent.
  const data = current(state);
  const boardTasks = useMemo(
    () => new Map([...data.tasks, ...(data.hiddenTasks ?? [])].map((row) => [row.id, row])),
    [data],
  );
  // Beside the board, a subtask left for its parent's pane hands focus to its card there, as
  // the phone screen returns it to its opener, so the keyboard carries on where it was.
  useEffect(() => {
    if (phone || task.parentId === null) return;
    const id = task.id;
    return () => {
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active && active !== document.body) return;
        document
          .querySelector<HTMLElement>(`[aria-label="Task"] [data-card-id="${CSS.escape(id)}"]`)
          ?.focus();
      });
    };
  }, [phone, task.id, task.parentId]);
  function addSubtask() {
    try {
      const id = createTask(project.id, { parentId: task.id });
      setError(null);
      haptics.success();
      openNewSubtask(id, task.id);
    } catch {
      setError('The subtask could not be added. Try again.');
    }
  }
  // Finished work only, as the card's progress counts it: a cancelled subtask was not done.
  const done = children.filter(
    (child) => statuses.find((row) => row.id === child.statusId)?.category === 'done',
  ).length;
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col pb-[var(--keyboard)]',
        phone && 'pt-[var(--safe-top)]',
      )}
    >
      {/* Beside the board, the toolbars sit above the task's card and line up with its edges,
          and its controls are a dock below it, as Catch's split view holds a note. */}
      <header
        className={cn(
          'flex shrink-0 items-start justify-between gap-3',
          phone ? 'px-3 py-3' : 'pb-3',
        )}
      >
        <div
          role="toolbar"
          aria-label="Task navigation"
          className="glass flex min-w-0 items-center rounded-full p-1"
        >
          <IconButton
            label={
              below
                ? `Back to ${taskIdentifier(project, below) ?? 'the parent task'}`
                : 'Back to the board'
            }
            onClick={leaveTask}
            className="size-10 shrink-0 [&_svg]:size-5"
          >
            <ChevronLeft />
          </IconButton>
          <nav
            aria-label="Task breadcrumb"
            className="flex min-w-0 items-center gap-1 pr-4 text-muted-foreground text-sm tabular-nums"
          >
            {parent && (
              <>
                <button
                  type="button"
                  aria-label={`Open parent ${taskIdentifier(project, parent) ?? 'Pending'}`}
                  onClick={() =>
                    below?.id === parent.id ? leaveTask() : update({ openTaskId: parent.id })
                  }
                  className="min-h-10 truncate rounded-full px-1 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60"
                >
                  {taskIdentifier(project, parent) ?? 'Pending'}
                </button>
                <ChevronRight aria-hidden className="size-3 shrink-0" />
              </>
            )}
            <span className="truncate" aria-current="page">
              {taskIdentifier(project, task) ?? 'Pending'}
            </span>
          </nav>
        </div>
        <div
          role="toolbar"
          aria-label="Task trash"
          className="glass flex shrink-0 rounded-full p-1"
        >
          <IconButton
            label={task.deletedAt ? 'Restore task' : 'Move to trash'}
            className="size-10 text-destructive hover:text-destructive [&_svg]:size-5"
            onClick={() => {
              // Felt once it is done: either can throw if the task went meanwhile.
              if (task.deletedAt) {
                restoreTask(task.id);
                haptics.success();
              } else {
                trashTask(task.id);
                haptics.warning();
              }
            }}
          >
            {task.deletedAt ? <RotateCcw /> : <Trash2 />}
          </IconButton>
        </div>
      </header>
      <ScrollArea className={cn('min-h-0 flex-1 [--scrollbar-inset:1rem]', !phone && cardSurface)}>
        <ScrollAreaViewport
          ref={attachScroll ?? undefined}
          // The dock rests over the content's end; focus and the caret stay clear of it.
          className={cn(phone && 'scroll-pb-[calc(var(--dock-height)+var(--safe-bottom)+2.5rem)]')}
        >
          <div
            className={cn(
              'px-6 sm:px-8',
              phone ? 'pt-5 pb-[calc(var(--dock-height)+var(--safe-bottom)+3rem)]' : 'pt-7 pb-10',
            )}
          >
            <TaskTitle task={boardTask(task, tags)} />
            {task.deletedAt && (
              <p role="status" className="mt-4 text-muted-foreground text-sm">
                This task is in the trash. Restore it from the toolbar.
              </p>
            )}
            {parent?.deletedAt && (
              <p className="mt-4 text-muted-foreground text-sm">
                This subtask is in the trash with its parent. Restore the parent to bring it back.
              </p>
            )}
            <TaskTagList task={task} tags={tags} />
            <TaskRefusalNotice key={`notice:${task.id}`} taskId={task.id} />
            <TaskDescription task={task} recovery={recovery} />
            {task.parentId === null && (
              // Flush with the task, as Catch lists a note's links below it.
              <section aria-label="Subtasks" className="mt-8 flex flex-col gap-2">
                <h2 className="px-1 font-medium text-muted-foreground text-xs tabular-nums">
                  {children.length ? `Subtasks · ${done}/${children.length}` : 'Subtasks'}
                </h2>
                <div className="flex flex-col gap-2">
                  {children.map((child) => {
                    const childStatus = statuses.find((row) => row.id === child.statusId);
                    return (
                      <TaskCard
                        key={child.id}
                        task={{
                          ...boardTask(child, tags),
                          secondaryTagIds: boardTasks.get(child.id)?.secondaryTagIds ?? [],
                        }}
                        showStatus
                        onOpen={() => openSubtask(child.id)}
                        statusControl={
                          childStatus && (
                            <StatusMenu
                              project={boardProject}
                              value={child.statusId}
                              onSelect={(id) => sendTask(child.id, id)}
                            >
                              <button
                                type="button"
                                data-no-drag=""
                                aria-label={`Status of ${child.title || 'Untitled subtask'}: ${childStatus.name}. Change`}
                                className={cn(
                                  CARD_STATUS_CONTROL,
                                  'outline-none hover:bg-foreground/[0.06] focus-visible:ring-[3px] focus-visible:ring-ring/60',
                                )}
                              >
                                <StatusGlyph category={childStatus.category} className="size-3" />
                                <span className="truncate">{childStatus.name}</span>
                              </button>
                            </StatusMenu>
                          )
                        }
                      />
                    );
                  })}
                </div>
                {/* A slot in the list's own shape: the subtask is made at once and grows out
                    of its card as a task of its own, to be written in the full view. */}
                <button
                  type="button"
                  onClick={addSubtask}
                  className="flex min-h-12 w-full items-center gap-2 rounded-2xl border border-foreground/15 border-dashed px-4 text-muted-foreground text-sm outline-none transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60"
                >
                  <Plus className="size-4" />
                  Add subtask
                </button>
                {error && (
                  <p role="alert" className="px-1 text-destructive text-sm">
                    {error}
                  </p>
                )}
              </section>
            )}
            <TaskTimeline
              key={`timeline:${task.id}`}
              task={task}
              project={project}
              context={{
                priorityNames: project.priorityNames,
                parentName: (id) => {
                  const parent = tasks.find((row) => row.id === id);
                  return parent ? (taskIdentifier(project, parent) ?? undefined) : undefined;
                },
              }}
              onRecoverDescription={(entry) => setRecovery({ ...entry })}
            />
          </div>
        </ScrollAreaViewport>
        <ScrollBar />
      </ScrollArea>
      {!phone && <TaskDrawer task={task} statuses={statuses} />}
    </div>
  );
}
