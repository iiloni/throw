import {
  comparePositions,
  isClosedCategory,
  type Project,
  type Status,
  type Task,
  taskIdentifier,
} from '@throw/shared';
import { ChevronLeft, ChevronRight, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useContext, useState } from 'react';
import { StatusGlyph } from '@/components/Board/glyphs';
import type { Task as BoardTask } from '@/components/Board/model';
import { StatusMenu } from '@/components/Board/StatusMenu';
import { current, update } from '@/components/Board/state';
import { TaskCard } from '@/components/Board/TaskCard';
import { TaskTitle } from '@/components/Board/TaskView';
import { TaskScrollContext } from '@/components/Board/taskMotionContext';
import { IconButton } from '@/components/IconButton/IconButton';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import { createTask, restoreTask, sendTask, trashTask } from '@/lib/tasks';
import { TaskDescription } from './TaskDescription';
import { TaskDrawer } from './TaskDrawer';

function boardTask(task: Task): BoardTask {
  return {
    ...task,
    closedAt: task.closedAt === null ? null : Date.parse(task.closedAt),
    primaryTagId: null,
    secondaryTagIds: [],
    description: undefined,
  };
}

export function TaskDetails({
  task,
  project,
  statuses,
  tasks,
}: {
  task: Task;
  project: Project;
  statuses: Status[];
  tasks: Task[];
}) {
  const attachScroll = useContext(TaskScrollContext);
  const parent = tasks.find((row) => row.id === task.parentId);
  const children = tasks
    .filter((row) => row.parentId === task.id && row.deletedAt === null)
    .sort((a, b) => comparePositions(a.position, b.position) || a.id.localeCompare(b.id));
  const boardProject = current().project;
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const done = children.filter((child) =>
    isClosedCategory(statuses.find((row) => row.id === child.statusId)?.category ?? 'backlog'),
  ).length;
  return (
    <div className="flex min-h-0 flex-1 flex-col pt-[var(--safe-top)] pb-[var(--keyboard)]">
      <header className="flex shrink-0 items-start justify-between gap-3 px-3 py-3">
        <div
          role="toolbar"
          aria-label="Task navigation"
          className="glass flex min-w-0 items-center rounded-full p-1"
        >
          <IconButton
            label="Back to the board"
            onClick={() => update({ openTaskId: null })}
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
                  onClick={() => update({ openTaskId: parent.id })}
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
            onClick={() => (task.deletedAt ? restoreTask(task.id) : trashTask(task.id))}
          >
            {task.deletedAt ? <RotateCcw /> : <Trash2 />}
          </IconButton>
        </div>
      </header>
      <ScrollArea className="min-h-0 flex-1 [--scrollbar-inset:1rem]">
        <ScrollAreaViewport ref={attachScroll ?? undefined}>
          <div className="px-6 pt-5 pb-10 sm:px-8">
            <TaskTitle task={boardTask(task)} />
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
            <div data-task-tags="" />
            <TaskDescription task={task} />
            {task.parentId === null && (
              <section
                aria-label="Subtasks"
                className="-mx-3 mt-8 rounded-3xl bg-foreground/[0.035] p-3"
              >
                <div className="mb-2 flex min-h-11 items-center gap-2 px-2">
                  <h2 className="font-display font-semibold text-lg tracking-[-0.01em]">
                    Subtasks
                  </h2>
                  <span className="rounded-full bg-foreground/[0.06] px-2 text-muted-foreground text-xs tabular-nums">
                    {done}/{children.length}
                  </span>
                  <span className="flex-1" />
                </div>
                <div className="flex flex-col gap-3">
                  {children.map((child) => {
                    const childStatus = statuses.find((row) => row.id === child.statusId);
                    return (
                      <TaskCard
                        key={child.id}
                        task={boardTask(child)}
                        showStatus
                        onOpen={() => update({ openTaskId: child.id })}
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
                    className="mt-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!title.trim()) return;
                      try {
                        createTask(project.id, { parentId: task.id, title: title.trim() });
                        setTitle('');
                        setAdding(false);
                        setError(null);
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
                      ref={(element) => {
                        element?.focus();
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
                      <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAdding(true)}
                    className="mt-2 flex min-h-11 w-full items-center gap-1 rounded-xl px-3 text-muted-foreground text-sm outline-none hover:bg-foreground/[0.04] focus-visible:ring-[3px] focus-visible:ring-ring/60"
                  >
                    <Plus className="size-3" />
                    Add subtask
                  </button>
                )}
              </section>
            )}
            {/* Comments and activity mount below the description and subtask column. */}
            <div data-task-timeline="" />
          </div>
        </ScrollAreaViewport>
        <ScrollBar />
      </ScrollArea>
      <TaskDrawer task={task} statuses={statuses} />
    </div>
  );
}
