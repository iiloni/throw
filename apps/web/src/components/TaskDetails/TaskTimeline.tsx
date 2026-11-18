import {
  type ActivityEntry,
  type Comment,
  descriptionSchema,
  type Project,
  type Task,
} from '@throw/shared';
import { useState } from 'react';
import { LazyDescriptionEditor } from '@/components/DescriptionEditor/LazyDescriptionEditor';
import { Button } from '@/components/ui/button';
import { signedInUserId, useTaskTimeline } from '@/lib/collections';
import { addComment, deleteComment, editComment } from '@/lib/comments';
import { getServerUrl } from '@/lib/serverUrl';
import { CommentComposer } from './CommentComposer';
import { entrySentences, type HistoryContext } from './history';

const author = (id: string | null) =>
  id !== null && id === signedInUserId ? 'You' : id ? 'Another member' : 'Deleted member';
const time = (at: string) =>
  new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function focusHistory(id: string) {
  const element = document.getElementById(`history-${id}`);
  element?.scrollIntoView({ block: 'center', behavior: 'instant' });
  element?.focus({ preventScroll: true });
}

function CommentRow({ comment, pending }: { comment: Comment; pending: boolean }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const own = comment.userId !== null && comment.userId === signedInUserId;
  return (
    <article aria-label={`${author(comment.userId)} commented`} className="py-4">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
        <span className="font-medium text-foreground">{author(comment.userId)}</span>
        {pending ? (
          <span className="text-muted-foreground">Pending sync</span>
        ) : (
          <time
            className="text-muted-foreground"
            dateTime={comment.createdAt!}
            title="Received by the server"
          >
            {time(comment.createdAt!)}
          </time>
        )}
        {comment.editedAt && <span className="text-muted-foreground">Edited</span>}
      </div>
      {editing ? (
        <CommentComposer
          initialContent={comment.body}
          onSave={(body) => {
            editComment(comment.id, body);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <LazyDescriptionEditor key={JSON.stringify(comment.body)} initialContent={comment.body} />
      )}
      {own && !editing && (
        <div className="mt-1 flex flex-wrap gap-1">
          {deleting ? (
            <>
              <span className="self-center text-muted-foreground text-xs">
                Delete this comment?
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => {
                  try {
                    deleteComment(comment.id);
                  } catch {
                    setError('Could not delete this comment. Try again.');
                  }
                }}
              >
                Delete comment
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDeleting(false)}>
                Keep comment
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                Edit comment
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDeleting(true)}>
                Delete comment
              </Button>
            </>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
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
  const [composing, setComposing] = useState(false);
  return (
    <section
      aria-label="Task history"
      data-task-timeline=""
      className="mt-10 border-border border-t pt-5"
    >
      <h2 className="font-medium text-muted-foreground text-xs">History</h2>
      <p className="mt-1 text-muted-foreground text-xs">Times show when changes synced.</p>
      {!timeline.length && (
        <p className="py-5 text-muted-foreground text-sm">
          {isLoading ? 'History has not synced yet.' : 'No history yet.'}
        </p>
      )}
      <ol className="mt-3 divide-y divide-border/50">
        {timeline.map((item) => (
          <li
            key={item.id}
            id={`history-${item.id}`}
            tabIndex={-1}
            className="scroll-m-6 rounded-lg outline-none [overflow-wrap:anywhere] focus:ring-2 focus:ring-ring/60"
          >
            {item.type === 'comment' ? (
              <CommentRow comment={item.comment} pending={item.pending} />
            ) : (
              <div className="py-3 text-muted-foreground text-sm leading-relaxed">
                <div className="mb-1 flex flex-wrap gap-x-2 text-xs">
                  <span>{author(item.entry.userId)}</span>
                  <time dateTime={item.entry.createdAt} title="Received by the server">
                    {time(item.entry.createdAt)}
                  </time>
                </div>
                <p
                  className={
                    item.entry.changes.some((change) => !change.applied)
                      ? 'text-foreground'
                      : undefined
                  }
                >
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
                    className="h-auto px-0 py-2"
                    onClick={() => onRecoverDescription(item.entry)}
                  >
                    Recover description
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      {composing ? (
        <CommentComposer
          onSave={(body) => {
            addComment(task.id, body);
            setComposing(false);
          }}
          onCancel={() => setComposing(false)}
        />
      ) : (
        <Button
          type="button"
          variant="secondary"
          className="mt-4 min-h-11"
          onClick={() => setComposing(true)}
        >
          Write a comment…
        </Button>
      )}
    </section>
  );
}
