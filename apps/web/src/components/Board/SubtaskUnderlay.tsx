import type { Color } from '@throw/shared';
import { Ban, ChevronDown } from 'lucide-react';
import { animate, useMotionValue, useReducedMotion } from 'motion/react';
import { useContext, useLayoutEffect, useMemo, useRef } from 'react';
import { Hint } from '@/components/Hint/Hint';
import { afterPaint, springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import {
  blockedHint,
  blockedLabel,
  consumeBlockerHoldClick,
  type SubtaskBlockers,
  subtaskBlockers,
  subtasksBlockedHint,
  subtasksBlockedLabel,
  subtasksSpotlightKey,
  type TaskBlocker,
  TaskBlockersContext,
  useIsBlockerSpotlightTarget,
  useParentHasSpotlightBlocker,
  useSpotlightActiveFor,
  useSpotlightShowsBlocked,
  useSpotlightSync,
  useTaskBlockers,
} from './blockers';
import { StatusGlyph } from './glyphs';
import { type Category, isClosed, type Project, projectOf, statusById, type Task } from './model';
import { StatusMenu } from './StatusMenu';
import { board, current, setSubtaskStatus, toggleExpanded, update } from './state';
import { holdHandlers, lingerHandlers, useBlockerHold } from './useBlockerHold';

const noBlockers: readonly TaskBlocker[] = [];

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
  const boardProject = current(state).project;
  // Subtasks share their parent's project, whose statuses they move among.
  const project = projectOf(boardProject, parent);
  const expanded = state.expanded.includes(parent.id);
  const category = (task: Task) => statusById(project, task.statusId)?.category ?? 'backlog';
  const done = subtasks.filter((task) => category(task) === 'done').length;
  const open = subtasks.filter((task) => !isClosed(category(task))).length;
  const spotlightBlocker = useParentHasSpotlightBlocker(parent.id, !inert);
  const list = useUnfold(expanded, Boolean(reduced));
  const blocked = useSubtaskBlockers(parent.id, subtasks);
  const doneLabel = `${done} of ${subtasks.length} subtasks done`;
  const blockedTab = useBlockedSubtasksMark(parent.id, blocked, boardProject, !inert);

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
        aria-label={blocked ? `${doneLabel}, ${subtasksBlockedLabel(blocked)}` : doneLabel}
        onClick={() => {
          if (consumeBlockerHoldClick()) return;
          toggleExpanded(parent.id);
        }}
        className="flex h-10 w-full items-center gap-2.5 rounded-b-2xl px-3.5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
        {...blockedTab.host}
      >
        {/* One pip per subtask: the shape of the work, not only a fraction. */}
        <span aria-hidden className="flex min-w-0 flex-1 items-center gap-1">
          {subtasks.map((task) => {
            const status = statusById(project, task.statusId);
            return (
              <SubtaskPip
                key={task.id}
                taskId={task.id}
                category={status?.category ?? 'backlog'}
                color={status?.color ?? null}
                inert={inert}
              />
            );
          })}
        </span>
        {blocked && blockedTab.mark}
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
        ref={list}
        data-subtask-list=""
        data-expanded={expanded ? '' : undefined}
        // The spring draws its height: no CSS transition, not even reduced motion's brief one.
        className="overflow-hidden transition-none"
      >
        <ul inert={!expanded || inert}>
          {subtasks.map((task) => (
            <SubtaskRow
              key={task.id}
              project={project}
              boardProject={boardProject}
              parentId={parent.id}
              task={task}
              origin={!inert}
            />
          ))}
          <li aria-hidden className="h-1.5" />
          <li className="sr-only">{open} still open</li>
        </ul>
      </div>
    </div>
  );
}

/**
 * Springs the list's height between nothing and its rows, which stay drawn from the top while
 * it clips them. At rest an open list is as tall as its rows, so a subtask added or renamed
 * while it is open shows at once.
 *
 * The height is a spring on the element rather than a CSS transition so that a gallery can lay
 * its cards out once, for the height the list is going to (`settleSubtaskLists`), and move them
 * with the same spring: they keep in step with the list instead of chasing every frame of it.
 */
function useUnfold(expanded: boolean, reduced: boolean) {
  const list = useRef<HTMLDivElement>(null);
  const height = useMotionValue(0);
  const shown = useRef(expanded);
  const pending = useRef(() => {});
  // The height is the spring's alone: React leaves it be, so the list is still drawn where it
  // was when it is told to open or close.
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    if (!shown.current) element.style.height = '0px';
    const unsubscribe = height.on('change', (value) => {
      element.style.height = `${value}px`;
    });
    return () => {
      unsubscribe();
      pending.current();
      height.stop();
    };
  }, [height]);
  useLayoutEffect(() => {
    const element = list.current;
    if (!element || shown.current === expanded) return;
    shown.current = expanded;
    const rows =
      element.firstElementChild instanceof HTMLElement ? element.firstElementChild : null;
    const to = expanded ? (rows?.offsetHeight ?? 0) : 0;
    pending.current();
    if (reduced) {
      height.stop();
      element.style.height = expanded ? '' : '0px';
      return;
    }
    // From where it is drawn: a list already moving keeps its speed, one at rest starts still.
    if (!height.isAnimating()) height.jump(element.offsetHeight);
    // The board draws again for the change, which is a long frame; a spring started now would
    // lose its first moments to it. A gallery starts its cards' springs after the same paint
    // (`ZoneGallery`), so the two still move as one. Not stopped when it turns back: the next
    // spring takes the value over with its speed.
    pending.current = afterPaint(() => {
      void animate(height, to, springs.pane).then(() => {
        if (shown.current && height.get() === to) element.style.height = '';
      });
    });
  }, [expanded, reduced, height]);
  return list;
}

/**
 * Draws every subtask list under `root` at the height it is opening or closing to, until the
 * returned call puts them back: what a grid measures a card by, so it lays the card out once
 * for where it is going rather than once a frame on the way. Measured as set, not worked out
 * from the list's height now, which the browser rounds differently on every frame.
 */
export function settleSubtaskLists(root: ParentNode) {
  const moving: [HTMLElement, string][] = [];
  for (const list of root.querySelectorAll<HTMLElement>('[data-subtask-list]')) {
    const to = list.hasAttribute('data-expanded') ? '' : '0px';
    if (list.style.height === to) continue;
    moving.push([list, list.style.height]);
    list.style.height = to;
  }
  return () => {
    for (const [list, height] of moving) list.style.height = height;
  };
}

/**
 * The parent's open subtasks' blockers, rolled up for its tab. Kept as one value while nothing
 * in it changes, since a spotlight compares its blockers by identity.
 */
function useSubtaskBlockers(parentId: string, subtasks: readonly Task[]) {
  const map = useContext(TaskBlockersContext);
  const open = subtasks
    .filter((task) => task.closedAt === null)
    .map((task) => task.id)
    .join(' ');
  return useMemo(() => {
    if (!map || open === '') return null;
    return subtaskBlockers(
      parentId,
      open.split(' ').map((id) => ({ id, closedAt: null })),
      (id) => map.get(id) ?? noBlockers,
    );
  }, [map, parentId, open]);
}

/**
 * The tab's mark for blocked subtasks, beside its count: red while any is held up from outside
 * the parent, quiet while they only wait on one another. A mouse lingering on it, or a finger
 * held on it on a tablet, lights up every one of their blockers.
 */
function useBlockedSubtasksMark(
  parentId: string,
  rollup: SubtaskBlockers | null,
  project: Project,
  enabled: boolean,
) {
  const key = subtasksSpotlightKey(parentId);
  const blockers = rollup?.all ?? noBlockers;
  const blockedIds = rollup?.blockedIds;
  const scope = useMemo(
    () => (blockedIds ? { owner: parentId, blocked: blockedIds } : undefined),
    [parentId, blockedIds],
  );
  const active = useSpotlightActiveFor(key, enabled);
  const hold = useBlockerHold(key, blockers, scope);
  useSpotlightSync(key, blockers, enabled, scope);
  const outside = (rollup?.blockedOutside ?? 0) > 0;
  const count = rollup?.blockedIds.length ?? 0;
  return {
    host: enabled && rollup ? holdHandlers(hold) : {},
    mark: rollup && (
      <Hint label={subtasksBlockedHint(rollup, project)}>
        <span
          ref={hold.badge}
          data-subtasks-blocked={outside ? 'outside' : 'inside'}
          data-spotlight-trigger={active ? 'active' : undefined}
          {...(enabled ? lingerHandlers(key, blockers, scope) : {})}
          className={cn(
            '-my-1 flex shrink-0 items-center gap-1 rounded-md px-1 py-1 font-medium tabular-nums transition-colors',
            outside ? 'text-destructive/80' : 'text-foreground/50',
            active &&
              (outside
                ? 'bg-destructive/15 text-destructive'
                : 'bg-foreground/10 text-foreground/80'),
          )}
        >
          <Ban aria-hidden className="size-3" />
          {count > 1 && <span aria-hidden>{count}</span>}
        </span>
      </Hint>
    ),
  };
}

const neutralPip = {
  backlog: 'bg-foreground/15',
  active: 'bg-foreground/45',
  done: 'bg-foreground/80',
  cancelled: 'outline-foreground/20',
};
const coloredPip = {
  backlog: 'bg-[color:var(--column-accent)]/35',
  active: 'bg-[color:var(--column-accent)]/80',
  done: 'bg-[color:var(--column-accent)]',
  cancelled: 'outline-[color:var(--column-accent)]/45',
};

/** One pip in the subtask underlay bar; turns destructive red while this subtask is spotlighted. */
function SubtaskPip({
  taskId,
  category,
  color,
  inert,
}: {
  taskId: string;
  category: Category;
  color: Color | null;
  inert: boolean;
}) {
  const isBlocker = useIsBlockerSpotlightTarget(taskId);
  const highlighted = !inert && isBlocker;
  return (
    <span
      data-category={category}
      data-column-color={color ?? undefined}
      data-subtask-pip={taskId}
      data-spotlight={highlighted ? 'blocker' : undefined}
      className={cn(
        'h-1.5 max-w-6 flex-1 rounded-full transition-colors',
        highlighted ? 'bg-destructive' : (color ? coloredPip : neutralPip)[category],
        !highlighted && category === 'cancelled' && 'bg-transparent outline-1',
      )}
    />
  );
}

/**
 * A subtask on its parent's card: its status changes here, and a tap opens it. On a phone the
 * row stands for the task, as a relation row does: its screen opens out of it and closes back
 * in. A dragged copy's rows are not where a task can go.
 */
function SubtaskRow({
  project,
  boardProject,
  parentId,
  task,
  origin,
}: {
  project: Project;
  /** The board's own project, which a blocked hint names other projects from. */
  boardProject: Project;
  parentId: string;
  task: Task;
  origin: boolean;
}) {
  const status = statusById(project, task.statusId);
  const spotlightBlocker = useIsBlockerSpotlightTarget(task.id);
  const rowRef = useRef<HTMLLIElement>(null);
  const own = useTaskBlockers(task.id);
  const blockers = task.closedAt === null ? own : noBlockers;
  const blocked = blockers.length > 0;
  const scope = useMemo(() => ({ owner: parentId, blocked: [task.id] }), [parentId, task.id]);
  const hold = useBlockerHold(task.id, blockers, scope);
  // Lit from its own mark or from the parent's tab: either way its blockers are showing.
  const showing = useSpotlightShowsBlocked(task.id, origin && blocked);
  useSpotlightSync(task.id, blockers, origin, scope);
  if (!status) return null;
  const closed = isClosed(status.category);
  return (
    // One inset row with one hover fill; the glyph lines up under the progress pips above.
    <li
      ref={rowRef}
      data-task-origin={origin ? task.id : undefined}
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
            <StatusGlyph category={status.category} color={status.color} className="size-4" />
          </button>
        </Hint>
      </StatusMenu>
      <button
        type="button"
        onClick={() => {
          if (consumeBlockerHoldClick()) return;
          update({ openTaskId: task.id }, rowRef.current);
        }}
        className="flex min-h-9 min-w-0 flex-1 items-center gap-2 self-stretch rounded-xl pr-3 pl-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
        {...(origin && blocked ? holdHandlers(hold) : {})}
      >
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-left text-[0.8125rem]',
            closed && 'opacity-55',
          )}
        >
          {task.title}
        </span>
        {blocked && (
          <Hint label={blockedHint(blockers, boardProject)}>
            <span
              ref={hold.badge}
              role="img"
              data-blocked=""
              data-spotlight-trigger={showing ? 'active' : undefined}
              aria-label={blockedLabel(blockers)}
              {...(origin ? lingerHandlers(task.id, blockers, scope) : {})}
              className={cn(
                '-m-1 flex shrink-0 items-center rounded-md p-1 text-destructive/80 transition-colors',
                showing && 'bg-destructive/15 text-destructive',
              )}
            >
              <Ban aria-hidden className="size-3" />
            </span>
          </Hint>
        )}
      </button>
    </li>
  );
}
