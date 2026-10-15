import {
  comparePositions,
  isClosedCategory,
  PRIORITIES,
  type Project,
  type Status,
  type Task,
  taskIdentifier,
} from '@throw/shared';
import { ArrowUpLeft, ChevronDown, Plus } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import { PriorityGlyph, StatusGlyph } from '@/components/Board/glyphs';
import { type Task as BoardTask, priorityName } from '@/components/Board/model';
import { StatusMenu } from '@/components/Board/StatusMenu';
import { current, update } from '@/components/Board/state';
import { TaskTitle } from '@/components/Board/TaskView';
import { Button } from '@/components/ui/button';
import { createTask, sendTask, updateTask } from '@/lib/tasks';
import { TaskDescription } from './TaskDescription';

const field =
  'flex min-h-11 items-center gap-2 rounded-xl bg-foreground/[0.06] px-3 text-sm outline-none hover:bg-foreground/[0.1] focus-visible:ring-[3px] focus-visible:ring-ring/60';

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
  const parent = tasks.find((row) => row.id === task.parentId);
  const children = tasks
    .filter((row) => row.parentId === task.id && row.deletedAt === null)
    .sort((a, b) => comparePositions(a.position, b.position) || a.id.localeCompare(b.id));
  const status = statuses.find((row) => row.id === task.statusId);
  const boardProject = current().project;
  const titleTask: BoardTask = {
    ...task,
    closedAt: null,
    primaryTagId: null,
    secondaryTagIds: [],
    description: undefined,
  };
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const done = children.filter((child) =>
    isClosedCategory(statuses.find((row) => row.id === child.statusId)?.category ?? 'backlog'),
  ).length;

  return (
    <>
      {parent && (
        <button
          type="button"
          onClick={() => update({ openTaskId: parent.id })}
          className="mb-3 flex max-w-full items-center gap-1.5 rounded text-muted-foreground text-sm outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60"
        >
          <ArrowUpLeft aria-hidden className="size-4 shrink-0" />
          <span className="truncate">
            {taskIdentifier(project, parent) ?? 'Pending'} {parent.title || 'Untitled task'}
          </span>
        </button>
      )}
      <TaskTitle task={titleTask} />
      {task.deletedAt && (
        <p role="status" className="mt-4 text-muted-foreground text-sm">
          This task is in the trash. Restore it from Task actions.
        </p>
      )}
      {parent?.deletedAt && (
        <p className="mt-4 text-muted-foreground text-sm">
          This subtask is in the trash with its parent. Restore the parent to bring it back.
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        {status && (
          <StatusMenu
            project={boardProject}
            value={status.id}
            onSelect={(id) => sendTask(task.id, id)}
          >
            <button type="button" aria-label={`Status: ${status.name}. Change`} className={field}>
              <StatusGlyph category={status.category} />
              {status.name}
              <ChevronDown aria-hidden className="size-3 text-muted-foreground" />
            </button>
          </StatusMenu>
        )}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label={`Priority: ${priorityName(boardProject, task.priority)}. Change`}
              className={field}
            >
              <PriorityGlyph
                priority={task.priority}
                name={priorityName(boardProject, task.priority)}
              />
              {priorityName(boardProject, task.priority)}
              <ChevronDown aria-hidden className="size-3 text-muted-foreground" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="start"
              sideOffset={6}
              collisionPadding={12}
              className="shell-menu glass-thick z-50 w-56 rounded-2xl p-2"
            >
              <DropdownMenu.RadioGroup value={String(task.priority)}>
                {PRIORITIES.map((priority) => (
                  <DropdownMenu.RadioItem
                    key={priority}
                    value={String(priority)}
                    aria-label={priorityName(boardProject, priority)}
                    onSelect={() => updateTask(task.id, { priority })}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 text-sm outline-none data-[highlighted]:bg-accent"
                  >
                    <PriorityGlyph
                      priority={priority}
                      name={priorityName(boardProject, priority)}
                    />
                    {priorityName(boardProject, priority)}
                    {task.priority === priority && (
                      <span aria-hidden className="ml-auto">
                        ✓
                      </span>
                    )}
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      {/* Tags slot: mount TaskTags and its primary/secondary picker here after PR #8 lands. */}
      <div data-task-tags="" />
      <TaskDescription task={task} />
      {task.parentId === null && (
        <section aria-label="Subtasks" className="mt-9">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-semibold text-sm">
              Subtasks{' '}
              <span className="ml-2 font-normal text-muted-foreground tabular-nums">
                {done}/{children.length}
              </span>
            </h2>
            {!adding && (
              <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
                <Plus />
                Add subtask
              </Button>
            )}
          </div>
          {children.length > 0 ? (
            <ul className="divide-y divide-foreground/[0.07]">
              {children.map((child) => {
                const childStatus = statuses.find((row) => row.id === child.statusId);
                return (
                  <li key={child.id} className="flex items-center gap-2">
                    {childStatus && (
                      <StatusMenu
                        project={boardProject}
                        value={child.statusId}
                        onSelect={(id) => sendTask(child.id, id)}
                      >
                        <button
                          type="button"
                          aria-label={`Status of ${child.title || 'Untitled subtask'}: ${childStatus.name}. Change`}
                          className="flex size-11 shrink-0 items-center justify-center rounded-lg outline-none hover:bg-foreground/[0.06] focus-visible:ring-[3px] focus-visible:ring-ring/60"
                        >
                          <StatusGlyph category={childStatus.category} />
                        </button>
                      </StatusMenu>
                    )}
                    <button
                      type="button"
                      onClick={() => update({ openTaskId: child.id })}
                      className="flex min-h-14 min-w-0 flex-1 flex-col justify-center rounded-lg py-2 text-left outline-none hover:bg-foreground/[0.04] focus-visible:ring-[3px] focus-visible:ring-ring/60"
                    >
                      <span className="w-full truncate text-sm">
                        {child.title || 'Untitled subtask'}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {taskIdentifier(project, child) ?? 'Pending'} · {childStatus?.name}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            !adding && (
              <p className="py-2 text-muted-foreground text-sm">
                Break this task into smaller steps.
              </p>
            )
          )}
          {adding && (
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
                className="h-11 w-full rounded-xl border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
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
          )}
        </section>
      )}
      {/* The timeline step mounts comments and activity here, below the description. */}
      <div data-task-timeline="" />
    </>
  );
}
