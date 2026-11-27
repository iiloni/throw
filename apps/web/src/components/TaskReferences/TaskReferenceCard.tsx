import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react';
import { Ban } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { blockedLabel } from '@/components/Board/blockers';
import { hasPriorityIcon, PriorityIcon, StatusGlyph } from '@/components/Board/glyphs';
import { TagBadge } from '@/components/TagBadge/TagBadge';
import { cn } from '@/lib/utils';
import type { ReferencedTask, TaskReferenceIndex } from './referenceIndex';
import { type TaskReferences, useOpenTaskReference } from './TaskReferences';

/** As long as a hint waits (TooltipProvider), so passing over text does not flash cards. */
const OPEN_DELAY = 300;
const CLOSE_DELAY = 120;

/**
 * A reference's preview: its status, identifier, title, rank, tags and whether it is
 * blocked, read from the synced rows on the device. It points at its reference from the
 * page's body, so a pane's clipped scroll area cannot cut it off, and never takes the pointer.
 */
export function TaskReferenceCard({
  anchor,
  reference,
  index,
  crossProject,
}: {
  anchor: Element;
  reference: ReferencedTask;
  index: TaskReferenceIndex;
  crossProject: boolean;
}) {
  const { refs, floatingStyles, placement } = useFloating({
    elements: { reference: anchor },
    placement: 'bottom-start',
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const details = index.details(reference);
  const { task, project, status } = reference;
  const title = task.title || 'Untitled task';
  return createPortal(
    <div
      ref={refs.setFloating}
      style={floatingStyles}
      className="pointer-events-none z-[75]"
      data-task-ref-card=""
    >
      <div
        role="tooltip"
        data-side={placement.startsWith('top') ? 'top' : 'bottom'}
        className={cn(
          'glass-thick flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-2 rounded-xl px-3.5 py-3 text-foreground text-sm',
          'shadow-[inset_0_1px_0_var(--glass-highlight),0_10px_30px_-10px_var(--glass-shadow)]!',
          // As a hint grows out of its trigger; reduced motion keeps the fade.
          'fade-in-0 animate-in duration-200 ease-(--ease-emphasized)',
          'motion-safe:zoom-in-95 motion-safe:data-[side=bottom]:slide-in-from-top-[2px] motion-safe:data-[side=top]:slide-in-from-bottom-[2px]',
          placement.startsWith('top') ? 'origin-bottom-left' : 'origin-top-left',
        )}
      >
        <div className="flex min-w-0 items-center gap-2 text-muted-foreground text-xs">
          <StatusGlyph
            category={status?.category ?? 'backlog'}
            color={status?.color}
            className="size-3.5"
          />
          <span className="min-w-0 truncate">{status?.name ?? 'No status'}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0 font-medium tabular-nums">{reference.identifier}</span>
          {crossProject && (
            <span
              data-color={project.color}
              className="ml-auto min-w-0 truncate rounded-md bg-tint px-1.5 font-medium text-[0.6875rem] text-foreground/80"
            >
              {project.name}
            </span>
          )}
        </div>
        <p
          className={cn(
            'line-clamp-3 font-medium leading-snug',
            reference.closed && 'text-muted-foreground line-through decoration-foreground/30',
          )}
        >
          {title}
        </p>
        {(hasPriorityIcon(task.priority) || details.blockers.length > 0) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
            {hasPriorityIcon(task.priority) && (
              <span className="inline-flex items-center gap-1">
                <PriorityIcon priority={task.priority} className="size-3.5" />
                {details.priorityName}
              </span>
            )}
            {details.blockers.length > 0 && (
              <span data-blocked="" className="inline-flex items-center gap-1 text-destructive/90">
                <Ban aria-hidden className="size-3" />
                {blockedLabel(details.blockers)}
              </span>
            )}
          </div>
        )}
        {(details.primaryTag || details.secondaryTags.length > 0) && (
          <div className="flex flex-wrap gap-1">
            {details.primaryTag && (
              <TagBadge tag={details.primaryTag} tags={details.tags} primary interactive={false} />
            )}
            {details.secondaryTags.map((tag) => (
              <TagBadge key={tag.id} tag={tag} tags={details.tags} interactive={false} />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

const finePointer = () =>
  typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/**
 * The references inside `root`: a click or tap opens the task, a mouse resting on one or the
 * keyboard reaching one shows its card. Touch never shows a card; a tap opens the task.
 * `caret` is the reference an editable editor's caret stands in, which shows its card too.
 */
export function TaskReferenceLayer({
  root,
  references,
  editable,
  caret = null,
}: {
  root: HTMLElement | null;
  references: TaskReferences;
  editable: boolean;
  caret?: Element | null;
}) {
  const open = useOpenTaskReference();
  const [hovered, setHovered] = useState<Element | null>(null);
  const showing = useRef<Element | null>(null);
  const timer = useRef(0);
  const latest = useRef({ references, open });
  latest.current = { references, open };

  useEffect(() => {
    if (!root) return;
    const refOf = (target: EventTarget | null) =>
      target instanceof Element ? target.closest('[data-task-ref]') : null;
    const resolve = (element: Element) => {
      const { references } = latest.current;
      const identifier = element.getAttribute('data-task-ref');
      return identifier ? references.index.resolve(references.workspaceId, identifier) : undefined;
    };
    const show = (next: Element | null) => {
      window.clearTimeout(timer.current);
      showing.current = next;
      setHovered(next);
    };
    const schedule = (next: Element | null, delay: number) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => show(next), delay);
    };
    function over(event: PointerEvent) {
      if (event.pointerType !== 'mouse' || event.buttons !== 0 || !finePointer()) return;
      const element = refOf(event.target);
      if (!element) return;
      // From one card straight to the next, as hints do once one is showing.
      if (showing.current) show(element);
      else schedule(element, OPEN_DELAY);
    }
    function out(event: PointerEvent) {
      if (!refOf(event.target)) return;
      const into = refOf(event.relatedTarget);
      // A reference styled in parts is drawn as several spans.
      if (
        into &&
        into.getAttribute('data-task-ref') === refOf(event.target)?.getAttribute('data-task-ref')
      )
        return;
      schedule(null, CLOSE_DELAY);
    }
    function activate(element: Element) {
      const found = resolve(element);
      if (!found) return;
      show(null);
      latest.current.open(found.task, element instanceof HTMLElement ? element : null);
    }
    function click(event: MouseEvent) {
      const element = refOf(event.target);
      if (!element || event.button !== 0) return;
      if (editable && (event.altKey || event.shiftKey || event.ctrlKey || event.metaKey)) return;
      // The end of a drag that selected text is not a click on what it ended over.
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && root?.contains(selection.anchorNode)) return;
      event.preventDefault();
      activate(element);
    }
    function key(event: KeyboardEvent) {
      if (editable || (event.key !== 'Enter' && event.key !== ' ')) return;
      const element = refOf(event.target);
      if (!element || element !== event.target) return;
      event.preventDefault();
      activate(element);
    }
    function focusIn(event: FocusEvent) {
      const element = refOf(event.target);
      if (element && element === event.target && element.matches(':focus-visible')) show(element);
    }
    function focusOut(event: FocusEvent) {
      if (refOf(event.target)) schedule(null, 0);
    }
    function dismiss(event: KeyboardEvent) {
      if (event.key === 'Escape' && showing.current) show(null);
    }
    root.addEventListener('pointerover', over);
    root.addEventListener('pointerout', out);
    root.addEventListener('click', click);
    root.addEventListener('keydown', key);
    root.addEventListener('focusin', focusIn);
    root.addEventListener('focusout', focusOut);
    window.addEventListener('keydown', dismiss, true);
    return () => {
      root.removeEventListener('pointerover', over);
      root.removeEventListener('pointerout', out);
      root.removeEventListener('click', click);
      root.removeEventListener('keydown', key);
      root.removeEventListener('focusin', focusIn);
      root.removeEventListener('focusout', focusOut);
      window.removeEventListener('keydown', dismiss, true);
      window.clearTimeout(timer.current);
    };
  }, [root, editable]);

  // A reference that was redrawn (its text edited, the tasks synced) leaves the document.
  const shown = [hovered, caret].find((element) => element?.isConnected) ?? null;
  const identifier = shown?.getAttribute('data-task-ref');
  const reference = identifier
    ? references.index.resolve(references.workspaceId, identifier)
    : undefined;
  if (!shown || !reference) return null;
  return (
    <TaskReferenceCard
      key={reference.task.id}
      anchor={shown}
      reference={reference}
      index={references.index}
      crossProject={reference.project.id !== references.projectId}
    />
  );
}
