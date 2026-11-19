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
import { useContext, useMemo, useRef, useState } from 'react';
import { StatusGlyph } from '@/components/Board/glyphs';
import { type Task as BoardTask, projectOf } from '@/components/Board/model';
import { StatusMenu } from '@/components/Board/StatusMenu';
import { board, current, leaveTask, openSubtask, update } from '@/components/Board/state';
import { TaskCard } from '@/components/Board/TaskCard';
import { cardSurface, TaskTitle } from '@/components/Board/TaskView';
import { TaskScrollContext } from '@/components/Board/taskMotionContext';
import { IconButton } from '@/components/IconButton/IconButton';
import { TaskTags } from '@/components/TaskTags/TaskTags';
import { Button } from '@/components/ui/button';
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
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const addSubtask = useRef<HTMLButtonElement>(null);
  // The board's copies carry each subtask's secondary tags, including under a trashed parent.
  const data = current(state);
  const boardTasks = useMemo(
    () => new Map([...data.tasks, ...(data.hiddenTasks ?? [])].map((row) => [row.id, row])),
    [data],
  );
  function closeSubtaskForm() {
    setAdding(false);
    setTitle('');
    setError(null);
    // The field goes away; focus returns to the control that opened it.
    requestAnimationFrame(() => addSubtask.current?.focus());
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
                                className="-my-2 flex min-h-10 min-w-0 items-center gap-1 rounded-lg px-1 outline-none hover:bg-foreground/[0.06] focus-visible:ring-[3px] focus-visible:ring-ring/60"
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
                {adding ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!title.trim()) return;
                      try {
                        createTask(project.id, { parentId: task.id, title: title.trim() });
                        haptics.success();
                        closeSubtaskForm();
                      } catch {
                        setError('The subtask could not be added. Try again.');
                      }
                    }}
                  >
                    <label className="sr-only" htmlFor={`subtask-${task.id}`}>
                      Subtask title
                    </label>
                    <input
                      id={`subtask-${task.id}`}
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      maxLength={500}
                      // biome-ignore lint/a11y/noAutofocus: the field appears because Add subtask was chosen.
                      autoFocus
                      onKeyDown={(event) => {
                        // Escape leaves the new subtask first, and the task on the next press.
                        // An Escape during IME composition cancels the conversion, not the field.
                        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
                        event.preventDefault();
                        closeSubtaskForm();
                      }}
                      placeholder="What needs doing?"
                      className="h-12 w-full rounded-xl border border-input bg-card px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
                    />
                    {error && (
                      <p role="alert" className="mt-2 text-destructive text-sm">
                        {error}
                      </p>
                    )}
                    <div className="mt-2 flex gap-2">
                      <Button disabled={!title.trim()}>Add subtask</Button>
                      <Button type="button" variant="ghost" onClick={closeSubtaskForm}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <button
                    ref={addSubtask}
                    type="button"
                    onClick={() => setAdding(true)}
                    className="flex min-h-11 w-full items-center gap-1 rounded-xl px-1 text-muted-foreground text-sm outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60"
                  >
                    <Plus className="size-3" />
                    Add subtask
                  </button>
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
