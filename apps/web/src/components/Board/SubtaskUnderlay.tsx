import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { StatusGlyph } from './glyphs';
import { isClosed, type Project, statusById, type Task } from './model';
import { StatusMenu } from './StatusMenu';
import { board, current, setSubtaskStatus, toggleExpanded, update } from './state';

type Props = {
  parent: Task;
  subtasks: Task[];
  /** Drawn on the dragged copy: shown, not operable. */
  inert?: boolean;
  /** Starts unfolded and folds at once, for a copy of a card lifted with its subtasks open. */
  folding?: boolean;
  /** Its card is away, opened as a task: the edge that tucks under the card stays hidden. */
  uncovered?: boolean;
};

/**
 * A tab tucked under a card that counts its subtasks and unfolds to list them, as a link
 * tucks under a note in Catch. Its top edge hides under the card, so it reads as a card behind.
 */
export function SubtaskUnderlay({
  parent,
  subtasks,
  inert = false,
  folding = false,
  uncovered = false,
}: Props) {
  const state = board.use();
  const { project } = current(state);
  const [unfolded, setUnfolded] = useState(folding);
  // One painted frame unfolded, so the fold is a transition and not a jump.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setUnfolded(false));
    return () => cancelAnimationFrame(frame);
  }, []);
  const expanded = unfolded || state.expanded.includes(parent.id);
  const category = (task: Task) => statusById(project, task.statusId)?.category ?? 'backlog';
  const done = subtasks.filter((task) => category(task) === 'done').length;
  const open = subtasks.filter((task) => !isClosed(category(task))).length;

  return (
    <div
      data-no-drag={inert ? undefined : ''}
      className={cn(
        '-z-10 -mt-3 relative mx-2.5 rounded-b-2xl bg-[color-mix(in_oklch,var(--tint,var(--card)),var(--foreground)_7%)] pt-3 text-xs',
        uncovered && '[clip-path:inset(0.75rem_0_0_0)]',
      )}
    >
      <button
        type="button"
        tabIndex={inert ? -1 : 0}
        aria-expanded={expanded}
        aria-label={`${done} of ${subtasks.length} subtasks done`}
        onClick={() => toggleExpanded(parent.id)}
        className="flex h-10 w-full items-center gap-2.5 rounded-b-2xl px-3.5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
      >
        {/* One pip per subtask: the shape of the work, not only a fraction. */}
        <span aria-hidden className="flex min-w-0 flex-1 items-center gap-1">
          {subtasks.map((task) => (
            <span
              key={task.id}
              data-category={category(task)}
              className="h-1.5 max-w-6 flex-1 rounded-full bg-foreground/15 transition-colors data-[category=active]:bg-foreground/45 data-[category=done]:bg-foreground/80 data-[category=cancelled]:bg-transparent data-[category=cancelled]:outline data-[category=cancelled]:outline-1 data-[category=cancelled]:outline-foreground/20"
            />
          ))}
        </span>
        <span className="shrink-0 font-medium text-foreground/60 tabular-nums">
          {done}/{subtasks.length}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 text-foreground/45 transition-transform duration-200',
            expanded && 'rotate-180',
          )}
        />
      </button>
      <div
        data-subtask-list=""
        className={cn(
          'grid transition-[grid-template-rows] duration-300 ease-[var(--ease-emphasized)]',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <ul inert={!expanded || inert} className="min-h-0 overflow-hidden">
          {subtasks.map((task) => (
            <SubtaskRow key={task.id} project={project} task={task} />
          ))}
          <li aria-hidden className="h-2" />
          <li className="sr-only">{open} still open</li>
        </ul>
      </div>
    </div>
  );
}

/** A subtask on its parent's card: its status changes here, and a tap opens it. */
function SubtaskRow({ project, task }: { project: Project; task: Task }) {
  const status = statusById(project, task.statusId);
  if (!status) return null;
  const closed = isClosed(status.category);
  return (
    <li className="flex items-center pl-1">
      <StatusMenu
        project={project}
        value={status.id}
        onSelect={(statusId) => setSubtaskStatus(task.id, statusId)}
      >
        <button
          type="button"
          aria-label={`Status: ${status.name}. Change`}
          title={status.name}
          className="flex size-9 shrink-0 items-center justify-center rounded-full outline-none hover:bg-foreground/[0.07] focus-visible:ring-[3px] focus-visible:ring-ring/60"
        >
          <StatusGlyph category={status.category} className="size-4" />
        </button>
      </StatusMenu>
      <button
        type="button"
        onClick={() => update({ openTaskId: task.id })}
        className="flex min-h-9 min-w-0 flex-1 items-center rounded-lg pr-3 outline-none hover:bg-foreground/[0.05] focus-visible:ring-[3px] focus-visible:ring-ring/60"
      >
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-left text-[0.8125rem]',
            closed && 'opacity-55',
          )}
        >
          {task.title}
        </span>
      </button>
    </li>
  );
}
