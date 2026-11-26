import { type ActivityEntry, descriptionSchema, type Project, type Task } from '@throw/shared';
import { History, Link2, MessageCircle } from 'lucide-react';
import { cancelFrame, frame, motion, useReducedMotion } from 'motion/react';
import {
  memo,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { z } from 'zod';
import { Collapse } from '@/components/Collapse/Collapse';
import { Hint } from '@/components/Hint/Hint';
import { SegmentedTabs } from '@/components/SegmentedTabs/SegmentedTabs';
import { useTabSwipe } from '@/components/SegmentedTabs/useTabSwipe';
import { Button } from '@/components/ui/button';
import { signedInUserId, useTaskTimeline } from '@/lib/collections';
import { useHasCommentDraft } from '@/lib/commentDrafts';
import { addComment } from '@/lib/comments';
import { haptics } from '@/lib/haptics';
import { getServerUrl } from '@/lib/serverUrl';
import { usePersistentState } from '@/lib/storage';
import { cn } from '@/lib/utils';
import { CommentComposer } from './CommentComposer';
import { CommentList, CommentPrompt } from './Comments';
import { entrySentences, type HistoryContext, shortTime } from './history';
import { author, fullTime } from './timelineParts';

/** When the server received it, which is the order the history is in. */
function Time({ at }: { at: string }) {
  return (
    <Hint label={`${fullTime(at)}, when it synced`} describe>
      <time dateTime={at} className="whitespace-nowrap">
        {shortTime(at)}
      </time>
    </Hint>
  );
}

const FOCUS_EVENT = 'throw:focus-history';
const FOCUS_LINKS_EVENT = 'throw:focus-links';
const basePanels = ['comments', 'history'] as const;
const allPanels = ['comments', 'history', 'links'] as const;
// `none` hides all panels; any other stored value falls back to Comments.
const tabSchema = z.enum([...allPanels, 'none']);

/**
 * Shows a history entry: the timeline turns to its History tab, opening it if all were
 * hidden, then focuses the entry.
 */
export function focusHistory(id: string) {
  window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: id }));
}

/**
 * Turns to the Links tab when links live in the tabs (narrow panes and phones), so a task
 * just linked from the dock shows up right away.
 */
export function focusLinks() {
  window.dispatchEvent(new CustomEvent(FOCUS_LINKS_EVENT));
}

// Rows render only when their own data changes: switching tabs must stay cheap, or the
// render holds up the tab indicator's spring on a phone.
const HistoryRow = memo(function HistoryRow({
  entry,
  context,
  onRecoverDescription,
}: {
  entry: ActivityEntry;
  context: HistoryContext;
  onRecoverDescription: (entry: ActivityEntry) => void;
}) {
  const refused = entry.changes.some((change) => !change.applied);
  return (
    <div className="flex gap-3 px-3.5 py-1.5 text-muted-foreground text-sm leading-normal">
      <span
        aria-hidden
        className={cn(
          'mt-2 size-1.5 shrink-0 rounded-full',
          refused ? 'bg-destructive' : 'bg-foreground/25',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className={refused ? 'text-foreground' : undefined}>
          {entry.userId !== signedInUserId && (
            <span className="font-medium">{author(entry.userId)}: </span>
          )}
          {entrySentences(entry, context).join(' ')}
          {entry.viaTokenName && (
            <span className="break-all text-muted-foreground"> via {entry.viaTokenName}</span>
          )}
        </p>
        {entry.changes.some(
          (change) =>
            change.field === 'description' &&
            !change.applied &&
            descriptionSchema.safeParse(change.rejectedDocument).success,
        ) && (
          <Button
            variant="link"
            className="h-auto px-0 py-1.5"
            onClick={() => onRecoverDescription(entry)}
          >
            Recover description
          </Button>
        )}
      </div>
      <span className="mt-px shrink-0 text-muted-foreground/75 text-xs leading-5">
        <Time at={entry.createdAt} />
      </span>
    </div>
  );
});

/** Room left above the tabs on a desktop pane, which has no toolbar floating over it. */
const REVEAL_MARGIN = 16;
/** Longest a reveal waits for the panel to show, and to finish opening (ms). */
const REVEAL_WITHIN = 1500;
const REVEAL_FOR = 3000;
const noop = () => {};

/**
 * Scrolls the task's scroller down to show a panel being turned to, in step with the panel
 * opening: to the end when the whole panel fits below the tabs, or else until the tabs reach
 * the top of the view, below the toolbars floating over it on a phone. It only moves down,
 * and leaves a panel that will fit in view alone. A scroll of the user's own cancels it.
 *
 * Called before the panel changes, so it knows the height the panel opens from. Each frame,
 * after motion has drawn the panel's height, the scroll covers as much of its way as the
 * height has of its own, so the two arrive together and the scroll is never cut short by an
 * end that has not opened yet.
 */
function revealPanel(section: HTMLElement, panelId: string, instant: boolean) {
  const scroller = section.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
  const box = section.querySelector<HTMLElement>('[data-collapse]');
  const content = box?.firstElementChild;
  if (!scroller || !box || !(content instanceof HTMLElement)) return noop;
  const tabs = section.querySelector<HTMLElement>('[role="tablist"]') ?? section;
  const style = getComputedStyle(scroller);
  // A phone's scroll padding keeps focus clear of its floating toolbars and dock.
  const above = Math.max(Number.parseFloat(style.scrollPaddingTop) || 0, REVEAL_MARGIN);
  const below = Number.parseFloat(style.scrollPaddingBottom) || 0;
  const from = scroller.scrollTop;
  const fromHeight = box.hidden ? 0 : box.getBoundingClientRect().height;
  const started = performance.now();
  let checked = false;
  const stop = () => {
    cancelFrame(step);
    scroller.removeEventListener('wheel', stop);
    scroller.removeEventListener('touchstart', stop);
  };
  function step() {
    const panel = document.getElementById(panelId);
    const elapsed = performance.now() - started;
    if (!scroller || !box || !(content instanceof HTMLElement)) return;
    if (!panel || panel.hidden) {
      if (elapsed > REVEAL_WITHIN) stop();
      return;
    }
    const settled = box.getAttribute('data-collapse') === 'open';
    const view = scroller.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    const height = boxRect.height;
    // The panel's own height, laid out in full while the box around it opens.
    const full = content.offsetHeight;
    const scrollTop = scroller.scrollTop;
    const end = scroller.scrollHeight - height + full - scroller.clientHeight;
    const tabsAt = tabs.getBoundingClientRect().top - view.top + scrollTop;
    const goal = Math.min(tabsAt - above, end);
    if (!checked) {
      checked = true;
      const panelEnd = boxRect.top - view.top + scrollTop + full;
      if (panelEnd <= from + scroller.clientHeight - below || goal <= from + 1) {
        stop();
        return;
      }
      // Nothing to keep step with: the new panel is as tall as the one it replaces.
      if (!settled && Math.abs(full - fromHeight) < 1) {
        stop();
        scroller.scrollTo({ top: goal, behavior: instant ? 'instant' : 'smooth' });
        return;
      }
    }
    if (settled || elapsed > REVEAL_FOR) {
      stop();
      scroller.scrollTop = goal;
      return;
    }
    const progress = Math.min(Math.max((height - fromHeight) / (full - fromHeight), 0), 1);
    // Short of the end that has opened so far: arriving there at speed would bounce.
    const opened = scroller.scrollHeight - scroller.clientHeight - 2;
    scroller.scrollTop = Math.max(Math.min(from + (goal - from) * progress, opened), scrollTop);
  }
  frame.postRender(step, true);
  scroller.addEventListener('wheel', stop, { passive: true });
  scroller.addEventListener('touchstart', stop, { passive: true });
  return stop;
}

export function TaskRefusalNotice({ taskId }: { taskId: string }) {
  const { timeline } = useTaskTimeline(taskId);
  const storageKey = `throw-refusals:${getServerUrl()}:${signedInUserId}:${taskId}`;
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : [];
    } catch {
      return [];
    }
  });
  const refused = timeline.filter(
    (item) =>
      item.type === 'entry' &&
      item.entry.userId === signedInUserId &&
      item.entry.changes.some((change) => !change.applied) &&
      !dismissed.includes(item.id),
  );
  if (!refused.length) return null;
  return (
    <aside
      aria-label="Unapplied changes"
      className="mt-5 rounded-2xl bg-foreground/[0.06] p-4 text-sm"
    >
      <p>
        {refused.length === 1
          ? 'A change was not applied when it synced.'
          : `${refused.length} updates had changes that were not applied when they synced.`}
      </p>
      <div className="mt-1 flex flex-wrap gap-2">
        <Button variant="link" className="px-0" onClick={() => focusHistory(refused[0]!.id)}>
          Review in history
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            const next = [...dismissed, ...refused.map((item) => item.id)];
            setDismissed(next);
            try {
              localStorage.setItem(storageKey, JSON.stringify(next));
            } catch {
              /* Dismiss for this visit if storage is unavailable. */
            }
          }}
        >
          Dismiss notice
        </Button>
      </div>
    </aside>
  );
}

export function TaskTimeline({
  task,
  project,
  context,
  onRecoverDescription,
  links,
}: {
  task: Task;
  project: Project;
  context: HistoryContext;
  onRecoverDescription: (entry: ActivityEntry) => void;
  /**
   * Relations as a 3rd tab on narrow panes and phones; wide desktop panes move them to the
   * side column (ADR 0012) and animate the 3rd tab out.
   */
  links?: {
    inTabs: boolean;
    mounted: boolean;
    count: number;
    blocked: boolean;
    content: ReactNode;
    add?: ReactNode;
  };
}) {
  const { timeline, isLoading } = useTaskTimeline(task.id);
  // Which task the composer is open for: the timeline stays mounted as the pane switches tasks.
  const [composingFor, setComposingFor] = useState<string | null>(null);
  const composing = composingFor === task.id;
  const hasDraft = useHasCommentDraft(task.id);
  const [stored, setTab] = usePersistentState('throw-task-timeline-tab', tabSchema, 'comments');
  const [lastBase, setLastBase] = useState<'comments' | 'history'>(
    stored === 'history' ? 'history' : 'comments',
  );
  if ((stored === 'comments' || stored === 'history') && stored !== lastBase) setLastBase(stored);
  const showLinks = links?.inTabs ?? false;
  const reducedMotion = useReducedMotion();
  const ids = useId();
  const section = useRef<HTMLElement | null>(null);
  const stopReveal = useRef<(() => void) | null>(null);
  useEffect(() => () => stopReveal.current?.(), []);
  // A tab turned to by hand (or a link just made) brings its panel into view.
  const turnTo = useCallback(
    (next: (typeof allPanels)[number] | null) => {
      stopReveal.current?.();
      stopReveal.current = null;
      // Measured before the change, from the panel as it stands.
      if (next !== null && section.current)
        stopReveal.current = revealPanel(section.current, `${ids}-${next}`, reducedMotion === true);
      setTab(next ?? 'none');
    },
    [setTab, ids, reducedMotion],
  );
  const tab = stored === 'none' ? null : !showLinks && stored === 'links' ? lastBase : stored;
  // The panel showing, or the one on its way out (and back in) while all are hidden.
  const [panel, setPanel] = useState(tab ?? 'comments');
  if (tab !== null && tab !== panel) setPanel(tab);
  // Whether the open panel has finished opening, so an entry in it has its place.
  const [laidOut, setLaidOut] = useState(tab !== null);
  if (tab === null && laidOut) setLaidOut(false);
  // Switching panels in place follows the tabs at a lower priority, so the indicator starts
  // moving before the panels change. While opening, the panel measured must be the new one.
  const deferredPanel = useDeferredValue(panel);
  const shown = laidOut ? deferredPanel : panel;
  const swipe = useTabSwipe({
    value: tab,
    shown: tab === null ? null : shown,
    values: showLinks ? allPanels : basePanels,
    onValueChange: turnTo,
  });
  const swipeRef = swipe.ref;
  const sectionRef = useCallback(
    (element: HTMLElement | null) => {
      section.current = element;
      swipeRef(element);
    },
    [swipeRef],
  );
  const [focusing, setFocusing] = useState<string | null>(null);
  useEffect(() => {
    const onFocus = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== 'string') return;
      setTab('history');
      setFocusing(event.detail);
    };
    window.addEventListener(FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_EVENT, onFocus);
  }, [setTab]);
  useEffect(() => {
    if (!showLinks) return;
    const onFocusLinks = () => turnTo('links');
    window.addEventListener(FOCUS_LINKS_EVENT, onFocusLinks);
    return () => window.removeEventListener(FOCUS_LINKS_EVENT, onFocusLinks);
  }, [showLinks, turnTo]);
  useEffect(() => {
    if (!focusing || shown !== 'history' || !laidOut) return;
    const element = document.getElementById(`history-${focusing}`);
    element?.scrollIntoView({ block: 'center', behavior: 'instant' });
    element?.focus({ preventScroll: true });
    setFocusing(null);
  }, [focusing, shown, laidOut]);
  const historyContext = useMemo(
    () => ({ ...context, priorityNames: project.priorityNames }),
    [context, project.priorityNames],
  );
  const comments = timeline.filter((item) => item.type === 'comment');
  const entries = timeline.filter((item) => item.type === 'entry');
  const empty = (text: string) => (
    <p className="px-1 py-4 text-muted-foreground text-sm">
      {isLoading ? 'History has not synced yet.' : text}
    </p>
  );
  const tabOptions = [
    {
      value: 'comments' as const,
      id: `${ids}-comments-tab`,
      controls: `${ids}-comments`,
      label: comments.length ? `Comments · ${comments.length}` : 'Comments',
      icon: <MessageCircle className="relative size-4 shrink-0" aria-hidden />,
    },
    {
      value: 'history' as const,
      id: `${ids}-history-tab`,
      controls: `${ids}-history`,
      label: 'History',
      icon: <History className="relative size-4 shrink-0" aria-hidden />,
    },
    ...(links
      ? [
          {
            value: 'links' as const,
            id: `${ids}-links-tab`,
            controls: `${ids}-links`,
            label: links.count ? `Links · ${links.count}` : 'Links',
            icon: <Link2 className="relative size-4 shrink-0" aria-hidden />,
            badge: links.blocked ? (
              <>
                <span
                  aria-hidden
                  className="relative ml-1.5 size-1.5 shrink-0 rounded-full bg-destructive"
                />
                <span className="sr-only">, blocked</span>
              </>
            ) : undefined,
            hidden: !showLinks,
          },
        ]
      : []),
  ];
  return (
    // Swiping sideways over the tabs or a panel turns between them; scrolling stays the pane's.
    <section
      aria-label="Task history"
      data-task-timeline=""
      className="mt-8 touch-pan-y"
      ref={sectionRef}
      {...swipe.handlers}
    >
      <SegmentedTabs
        label={showLinks ? 'Comments, history and links' : 'Comments and history'}
        value={tab}
        onValueChange={turnTo}
        collapsible
        drag={swipe.drag}
        options={tabOptions}
      />
      {/* Panels stay mounted, so a comment being written survives switching tabs or hiding them. */}
      <Collapse open={tab !== null} contentKey={shown} onRest={setLaidOut}>
        <motion.div style={{ x: swipe.x, opacity: swipe.opacity }}>
          <div
            role="tabpanel"
            id={`${ids}-comments`}
            aria-labelledby={`${ids}-comments-tab`}
            hidden={shown !== 'comments'}
            className="pt-2"
          >
            {!comments.length && !composing && empty('No comments yet.')}
            <CommentList comments={comments} loading={isLoading} />
            <CommentPrompt
              composing={composing}
              hasDraft={hasDraft}
              onCompose={() => setComposingFor(task.id)}
              composer={
                <CommentComposer
                  key={task.id}
                  bare
                  draftFor={task.id}
                  onSave={(body) => {
                    addComment(task.id, body);
                    haptics.success();
                    setComposingFor(null);
                  }}
                  onCancel={() => setComposingFor(null)}
                />
              }
            />
          </div>
          <div
            role="tabpanel"
            id={`${ids}-history`}
            aria-labelledby={`${ids}-history-tab`}
            hidden={shown !== 'history'}
            className="pt-2"
          >
            {!entries.length && empty('No history yet.')}
            <ol>
              {entries.map((item) => (
                <li
                  key={item.id}
                  id={`history-${item.id}`}
                  tabIndex={-1}
                  className="scroll-m-6 rounded-2xl outline-none [overflow-wrap:anywhere] focus:ring-2 focus:ring-ring/60"
                >
                  <HistoryRow
                    entry={item.entry}
                    context={historyContext}
                    onRecoverDescription={onRecoverDescription}
                  />
                </li>
              ))}
            </ol>
          </div>
          {links && (
            <div
              role="tabpanel"
              id={`${ids}-links`}
              aria-labelledby={`${ids}-links-tab`}
              hidden={shown !== 'links'}
              className="pt-2"
            >
              {links.mounted && (
                <div className="flex flex-col gap-3">
                  {links.count > 0 ? (
                    links.content
                  ) : (
                    <p className="px-1 pt-2 pb-1 text-muted-foreground text-sm">
                      No linked tasks yet.
                    </p>
                  )}
                  {links.add}
                </div>
              )}
            </div>
          )}
        </motion.div>
      </Collapse>
    </section>
  );
}
