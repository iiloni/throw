import { ArrowUpRight, ChevronDown } from 'lucide-react';
import { Popover } from 'radix-ui';
import { cn } from '@/lib/utils';
import { StatusGlyph } from './glyphs';
import { identifier, isClosed, type Project, statusById, type Task } from './model';
import { StatusMenu } from './StatusMenu';
import { board, current, setSubtaskStatus, toggleExpanded, update, useVariants } from './state';

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
  const { project } = current(state);
  const expanded = state.expanded.includes(parent.id);
  const category = (task: Task) => statusById(project, task.statusId)?.category ?? 'backlog';
  const done = subtasks.filter((task) => category(task) === 'done').length;
  const open = subtasks.filter((task) => !isClosed(category(task))).length;

  return (
    <div
      data-no-drag={inert ? undefined : ''}
      className="-z-10 -mt-3 relative mx-2 rounded-b-2xl bg-[color-mix(in_oklch,var(--tint,var(--card)),var(--foreground)_7%)] pt-3 text-xs"
    >
      <button
        type="button"
        tabIndex={inert ? -1 : 0}
        aria-expanded={expanded}
        aria-label={`${done} of ${subtasks.length} subtasks done`}
        onClick={() => toggleExpanded(parent.id)}
        className="flex h-9 w-full items-center gap-2 rounded-b-2xl px-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
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

function SubtaskRow({ project, task }: { project: Project; task: Task }) {
  const [variants] = useVariants();
  const status = statusById(project, task.statusId);
  if (!status) return null;
  const closed = isClosed(status.category);
  const glyph = <StatusGlyph category={status.category} className="size-4" />;
  const title = (
    <span
      className={cn('min-w-0 flex-1 truncate text-left text-[0.8125rem]', closed && 'opacity-55')}
    >
      {task.title}
    </span>
  );
  const rowClass =
    'flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-lg pr-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60 hover:bg-foreground/[0.05]';
  return (
    <li className="flex items-center pl-1">
      {variants.subtaskStatusInPlace ? (
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
            {glyph}
          </button>
        </StatusMenu>
      ) : (
        <span title={status.name} className="flex size-9 shrink-0 items-center justify-center">
          {glyph}
        </span>
      )}
      {variants.subtaskTap === 'open' ? (
        <button type="button" className={rowClass} onClick={() => update({ openTaskId: task.id })}>
          {title}
        </button>
      ) : (
        <Popover.Root>
          <Popover.Trigger asChild>
            <button type="button" className={rowClass}>
              {title}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="right"
              align="start"
              sideOffset={10}
              collisionPadding={12}
              className="shell-menu glass-thick z-50 w-64 rounded-3xl p-3 outline-none"
            >
              <SubtaskPopout project={project} task={task} />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </li>
  );
}

/** A subtask's quick actions: enough to move it along without leaving the board. */
function SubtaskPopout({ project, task }: { project: Project; task: Task }) {
  const status = statusById(project, task.statusId);
  const chip =
    'flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/60';
  return (
    <>
      <p className="px-1 text-muted-foreground text-xs tabular-nums">{identifier(project, task)}</p>
      <p className="px-1 pt-0.5 font-medium text-sm leading-snug">{task.title}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {project.statuses.map((item) => (
          <Popover.Close key={item.id} asChild>
            <button
              type="button"
              aria-pressed={item.id === status?.id}
              onClick={() => setSubtaskStatus(task.id, item.id)}
              className={cn(
                chip,
                item.id === status?.id
                  ? 'bg-foreground text-background'
                  : 'bg-foreground/[0.06] hover:bg-foreground/[0.12]',
              )}
            >
              <StatusGlyph category={item.category} className="size-3" />
              {item.name}
            </button>
          </Popover.Close>
        ))}
      </div>
      <Popover.Close asChild>
        <button
          type="button"
          onClick={() => update({ openTaskId: task.id })}
          className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-xl font-medium text-[color:var(--brand-link)] text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/60"
        >
          Open subtask
          <ArrowUpRight aria-hidden className="size-4" />
        </button>
      </Popover.Close>
    </>
  );
}
