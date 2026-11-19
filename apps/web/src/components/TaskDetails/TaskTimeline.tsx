import {
  type ActivityEntry,
  type Comment,
  descriptionSchema,
  type Project,
  type Task,
} from '@throw/shared';
import { History, MessageCircle, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { z } from 'zod';
import { LazyDescriptionEditor } from '@/components/DescriptionEditor/LazyDescriptionEditor';
import { IconButton } from '@/components/IconButton/IconButton';
import { SegmentedTabs } from '@/components/SegmentedTabs/SegmentedTabs';
import { Button } from '@/components/ui/button';
import { signedInUserId, useTaskTimeline } from '@/lib/collections';
import { useHasCommentDraft } from '@/lib/commentDrafts';
import { addComment, deleteComment, editComment } from '@/lib/comments';
import { haptics } from '@/lib/haptics';
import { getServerUrl } from '@/lib/serverUrl';
import { usePersistentState } from '@/lib/storage';
import { cn } from '@/lib/utils';
import { CommentComposer } from './CommentComposer';
import { entrySentences, type HistoryContext, shortTime } from './history';

const author = (id: string | null) =>
  id !== null && id === signedInUserId ? 'You' : id ? 'Another member' : 'Deleted member';
const fullTime = (at: string) =>
  new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
/** When the server received it, which is the order the history is in. */
function Time({ at }: { at: string }) {
  return (
    <time dateTime={at} title={`${fullTime(at)}, when it synced`} className="whitespace-nowrap">
      {shortTime(at)}
    </time>
  );
}

const FOCUS_EVENT = 'throw:focus-history';
const tabSchema = z.enum(['comments', 'history']);

/** Shows a history entry: the timeline turns to its History tab, then focuses the entry. */
export function focusHistory(id: string) {
  window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: id }));
}

function CommentRow({ comment, pending }: { comment: Comment; pending: boolean }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const own = comment.userId !== null && comment.userId === signedInUserId;
  return (
    <article aria-label={`${author(comment.userId)} commented`} className="py-1.5">
      {editing ? (
        <CommentComposer
          initialContent={comment.body}
          onSave={(body) => {
            editComment(comment.id, body);
            haptics.success();
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          className="mt-0"
        />
      ) : (
        <div className="rounded-2xl bg-foreground/[0.045] px-3.5 pt-1.5 pb-3">
          <div className="flex min-h-8 items-center gap-2 text-muted-foreground text-xs">
            <span className="font-medium text-foreground">{author(comment.userId)}</span>
            {pending ? <span>Pending sync</span> : <Time at={comment.createdAt!} />}
            {comment.editedAt && <span>· Edited</span>}
            {own && !deleting && (
              <span className="-mr-2 ml-auto flex">
                <IconButton
                  label="Edit comment"
                  className="text-muted-foreground [&_svg]:size-3.5"
                  onClick={() => setEditing(true)}
                >
                  <Pencil />
                </IconButton>
                <IconButton
                  label="Delete comment"
                  className="text-muted-foreground [&_svg]:size-3.5"
                  onClick={() => setDeleting(true)}
                >
                  <Trash2 />
                </IconButton>
              </span>
            )}
          </div>
          <div className="comment-body">
            <LazyDescriptionEditor
              key={JSON.stringify(comment.body)}
              initialContent={comment.body}
            />
          </div>
          {deleting && (
            <div className="mt-2 flex flex-wrap items-center justify-end gap-1 border-border/60 border-t pt-2">
              <p className="min-h-8 basis-full content-center text-muted-foreground text-xs">
                Delete this comment?
              </p>
              <Button variant="ghost" size="sm" onClick={() => setDeleting(false)}>
                Keep comment
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  try {
                    deleteComment(comment.id);
                    haptics.warning();
                  } catch {
                    setError('Could not delete this comment. Try again.');
                  }
                }}
              >
                Delete comment
              </Button>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-1 text-destructive text-sm">
              {error}
            </p>
          )}
        </div>
      )}
    </article>
  );
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
}: {
  task: Task;
  project: Project;
  context: HistoryContext;
  onRecoverDescription: (entry: ActivityEntry) => void;
}) {
  const { timeline, isLoading } = useTaskTimeline(task.id);
  // Which task the composer is open for: the timeline stays mounted as the pane switches tasks.
  const [composingFor, setComposingFor] = useState<string | null>(null);
  const composing = composingFor === task.id;
  const hasDraft = useHasCommentDraft(task.id);
  const [tab, setTab] = usePersistentState('throw-task-timeline-tab', tabSchema, 'comments');
  const [focusing, setFocusing] = useState<string | null>(null);
  const ids = useId();
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
    if (!focusing || tab !== 'history') return;
    const element = document.getElementById(`history-${focusing}`);
    element?.scrollIntoView({ block: 'center', behavior: 'instant' });
    element?.focus({ preventScroll: true });
    setFocusing(null);
  }, [focusing, tab]);
  const comments = timeline.filter((item) => item.type === 'comment');
  const entries = timeline.filter((item) => item.type === 'entry');
  const empty = (text: string) => (
    <p className="px-1 py-4 text-muted-foreground text-sm">
      {isLoading ? 'History has not synced yet.' : text}
    </p>
  );
  return (
    <section aria-label="Task history" data-task-timeline="" className="mt-8">
      <SegmentedTabs
        label="Comments and history"
        value={tab}
        onValueChange={setTab}
        options={[
          {
            value: 'comments',
            id: `${ids}-comments-tab`,
            controls: `${ids}-comments`,
            label: comments.length ? `Comments · ${comments.length}` : 'Comments',
            icon: <MessageCircle className="relative size-4" aria-hidden />,
          },
          {
            value: 'history',
            id: `${ids}-history-tab`,
            controls: `${ids}-history`,
            label: 'History',
            icon: <History className="relative size-4" aria-hidden />,
          },
        ]}
      />
      {/* Both stay mounted, so a comment being written survives a look at the history. */}
      <div
        role="tabpanel"
        id={`${ids}-comments`}
        aria-labelledby={`${ids}-comments-tab`}
        hidden={tab !== 'comments'}
        className="pt-2"
      >
        {!comments.length && !composing && empty('No comments yet.')}
        <ol>
          {comments.map((item) => (
            <li
              key={item.id}
              id={`history-${item.id}`}
              tabIndex={-1}
              className="scroll-m-6 rounded-2xl outline-none [overflow-wrap:anywhere] focus:ring-2 focus:ring-ring/60"
            >
              <CommentRow comment={item.comment} pending={item.pending} />
            </li>
          ))}
        </ol>
        {composing ? (
          <CommentComposer
            key={task.id}
            draftFor={task.id}
            onSave={(body) => {
              addComment(task.id, body);
              haptics.success();
              setComposingFor(null);
            }}
            onCancel={() => setComposingFor(null)}
          />
        ) : (
          <button
            type="button"
            className="mt-2 flex min-h-12 w-full items-center rounded-2xl bg-foreground/[0.045] px-3.5 text-left text-muted-foreground text-sm outline-none transition-colors hover:bg-foreground/[0.07] focus-visible:ring-[3px] focus-visible:ring-ring/60"
            onClick={() => setComposingFor(task.id)}
          >
            {hasDraft ? 'Resume comment draft' : 'Write a comment…'}
          </button>
        )}
      </div>
      <div
        role="tabpanel"
        id={`${ids}-history`}
        aria-labelledby={`${ids}-history-tab`}
        hidden={tab !== 'history'}
        className="pt-2"
      >
        {!entries.length && empty('No history yet.')}
        <ol>
          {entries.map((item) => {
            const refused = item.entry.changes.some((change) => !change.applied);
            return (
              <li
                key={item.id}
                id={`history-${item.id}`}
                tabIndex={-1}
                className="scroll-m-6 rounded-2xl outline-none [overflow-wrap:anywhere] focus:ring-2 focus:ring-ring/60"
              >
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
                      {item.entry.userId !== signedInUserId && (
                        <span className="font-medium">{author(item.entry.userId)}: </span>
                      )}
                      {entrySentences(item.entry, {
                        ...context,
                        priorityNames: project.priorityNames,
                      }).join(' ')}
                    </p>
                    {item.entry.changes.some(
                      (change) =>
                        change.field === 'description' &&
                        !change.applied &&
                        descriptionSchema.safeParse(change.rejectedDocument).success,
                    ) && (
                      <Button
                        variant="link"
                        className="h-auto px-0 py-1.5"
                        onClick={() => onRecoverDescription(item.entry)}
                      >
                        Recover description
                      </Button>
                    )}
                  </div>
                  <span className="mt-px shrink-0 text-muted-foreground/75 text-xs leading-5">
                    <Time at={item.entry.createdAt} />
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
