import { ChevronDown } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { Hint } from '@/components/Hint/Hint';
import { cn } from '@/lib/utils';
import { useIsBlockerSpotlightTarget, useParentHasSpotlightBlocker } from './blockers';
import { StatusGlyph } from './glyphs';
import { type Category, isClosed, type Project, projectOf, statusById, type Task } from './model';
import { StatusMenu } from './StatusMenu';
import { board, current, setSubtaskStatus, toggleExpanded, update } from './state';

type Props = {
  parent: Task;
  subtasks: Task[];
  /** Drawn on the dragged copy: shown, not operable. */
  inert?: boolean;
};

/**
 * A tab tucked under a card that counts its subtasks and unfolds to list them, as a link
 * tucks under a note in Catch. Its top edge hides under the card, so it reads as a card behind.
 */
export function SubtaskUnderlay({ parent, subtasks, inert = false }: Props) {
  const state = board.use();
  const reduced = useReducedMotion();
  // Subtasks share their parent's project, whose statuses they move among.
  const project = projectOf(current(state).project, parent);
  const expanded = state.expanded.includes(parent.id);
  const category = (task: Task) => statusById(project, task.statusId)?.category ?? 'backlog';
  const done = subtasks.filter((task) => category(task) === 'done').length;
  const open = subtasks.filter((task) => !isClosed(category(task))).length;
  const spotlightBlocker = useParentHasSpotlightBlocker(parent.id, !inert);

  return (
    <div
      data-no-drag={inert ? undefined : ''}
      data-subtask-underlay=""
      data-spotlight={spotlightBlocker ? 'blocker' : undefined}
      data-spotlight-instant={reduced ? '' : undefined}
      className="spotlight-underlay -z-10 -mt-3 relative mx-2.5 rounded-b-2xl bg-[color-mix(in_oklch,var(--tint,var(--card)),var(--foreground)_7%)] pt-3 text-xs"
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
            <SubtaskPip key={task.id} taskId={task.id} category={category(task)} inert={inert} />
          ))}
        </span>
        <span
          className={cn(
            'shrink-0 font-medium tabular-nums',
            spotlightBlocker ? 'text-foreground/85' : 'text-foreground/60',
          )}
        >
          {done}/{subtasks.length}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 transition-transform duration-200',
            spotlightBlocker ? 'text-foreground/70' : 'text-foreground/45',
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
          <li aria-hidden className="h-1.5" />
          <li className="sr-only">{open} still open</li>
        </ul>
      </div>
    </div>
  );
}

/** One pip in the subtask underlay bar; turns destructive red while this subtask is spotlighted. */
function SubtaskPip({
  taskId,
  category,
  inert,
}: {
  taskId: string;
  category: Category;
  inert: boolean;
}) {
  const isBlocker = useIsBlockerSpotlightTarget(taskId);
  const highlighted = !inert && isBlocker;
  return (
    <span
      data-category={category}
      data-subtask-pip={taskId}
      data-spotlight={highlighted ? 'blocker' : undefined}
      className={cn(
        'h-1.5 max-w-6 flex-1 rounded-full transition-colors',
        highlighted
          ? 'bg-destructive'
          : 'bg-foreground/15 data-[category=active]:bg-foreground/45 data-[category=done]:bg-foreground/80 data-[category=cancelled]:bg-transparent data-[category=cancelled]:outline data-[category=cancelled]:outline-1 data-[category=cancelled]:outline-foreground/20',
      )}
    />
  );
}

/** A subtask on its parent's card: its status changes here, and a tap opens it. */
function SubtaskRow({ project, task }: { project: Project; task: Task }) {
  const status = statusById(project, task.statusId);
  const spotlightBlocker = useIsBlockerSpotlightTarget(task.id);
  if (!status) return null;
  const closed = isClosed(status.category);
  return (
    // One inset row with one hover fill; the glyph lines up under the progress pips above.
    <li
      data-spotlight={spotlightBlocker ? 'blocker' : undefined}
      className={cn(
        'mx-1.5 flex min-h-9 items-center rounded-xl transition-colors hover:bg-foreground/[0.05]',
        spotlightBlocker && 'bg-destructive/12 ring-1 ring-destructive/75 ring-inset',
      )}
    >
      <StatusMenu
        project={project}
        value={status.id}
        onSelect={(statusId) => setSubtaskStatus(task.id, statusId)}
      >
        <Hint label={status.name}>
          <button
            type="button"
            aria-label={`Status: ${status.name}. Change`}
            className="flex size-9 shrink-0 items-center justify-center rounded-xl outline-none hover:bg-foreground/[0.07] focus-visible:ring-[3px] focus-visible:ring-ring/60"
          >
            <StatusGlyph category={status.category} className="size-4" />
          </button>
        </Hint>
      </StatusMenu>
      <button
        type="button"
        onClick={() => update({ openTaskId: task.id })}
        className="flex min-h-9 min-w-0 flex-1 items-center self-stretch rounded-xl pr-3 pl-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
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
