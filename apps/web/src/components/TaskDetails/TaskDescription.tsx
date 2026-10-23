import { type ActivityEntry, descriptionSchema, type Task } from '@throw/shared';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { uuidv7 } from 'uuidv7';
import { LazyDescriptionEditor } from '@/components/DescriptionEditor/LazyDescriptionEditor';
import { Button } from '@/components/ui/button';
import {
  type DescriptionDraft,
  descriptionIsStale,
  readDescriptionDraft,
  storeDescriptionDraft,
  useDescriptionDraft,
} from '@/lib/descriptionDrafts';
import { commitDescriptionDraft, registerDescriptionEditor } from '@/lib/descriptionEditing';
import { getTask } from '@/lib/tasks';

export function TaskDescription({
  task,
  recovery,
}: {
  task: Task;
  recovery?: ActivityEntry | null;
}) {
  const draft = useDescriptionDraft(task.id);
  const editing = draft && draft.status !== 'pending';
  const [session, setSession] = useState(() => ({
    document: editing ? draft.document : task.description,
    baseVersion: editing ? draft.baseVersion : task.descriptionVersion,
    key: editing ? draft.editorKey : uuidv7(),
  }));
  const [reviewedVersion, setReviewedVersion] = useState<string | null | undefined>();
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unstored = useRef<DescriptionDraft | null>(null);
  const stale =
    draft && (draft.status === 'conflict' || descriptionIsStale(draft, task.descriptionVersion));

  // Recovery uses the same review controls as a refused save on the sending device.
  useEffect(() => {
    if (!recovery || recovery.taskId !== task.id) return;
    const change = recovery.changes.find((item) => item.field === 'description' && !item.applied);
    const parsed = descriptionSchema.safeParse(change?.rejectedDocument);
    if (!change || !parsed.success) return;
    const existing = readDescriptionDraft(task.id);
    if (unstored.current) {
      setError('Your current draft is kept. Finish it before recovering another description.');
    } else if (existing) {
      if (existing.status !== 'conflict' || existing.submittedVersion !== change.requested)
        setError('Your current draft is kept. Finish it before recovering another description.');
    } else {
      const key = uuidv7();
      try {
        storeDescriptionDraft(task.id, {
          document: parsed.data,
          baseVersion: typeof change.previous === 'string' ? change.previous : null,
          submittedVersion: typeof change.requested === 'string' ? change.requested : null,
          editorKey: key,
          status: 'conflict',
        });
        setSession({
          document: parsed.data,
          baseVersion: typeof change.previous === 'string' ? change.previous : null,
          key,
        });
        setError(null);
      } catch {
        setError('Could not store the recovery draft on this device. Try again.');
      }
    }
    const section = document.getElementById(`description-${task.id}`);
    section?.scrollIntoView({ block: 'start', behavior: 'instant' });
    section?.focus({ preventScroll: true });
  }, [recovery, task.id]);

  useEffect(() => {
    // Only an untouched editor follows remote revisions. Typing owns its content and caret.
    if (!editing && !unstored.current && session.baseVersion !== task.descriptionVersion)
      setSession({
        document: task.description,
        baseVersion: task.descriptionVersion,
        key: uuidv7(),
      });
  }, [editing, session.baseVersion, task.description, task.descriptionVersion]);

  useEffect(() => {
    function flush() {
      try {
        if (unstored.current) {
          storeDescriptionDraft(task.id, unstored.current);
          unstored.current = null;
        }
        const result = commitDescriptionDraft(task.id);
        if (result === 'failed') throw new Error('Could not store description');
        return true;
      } catch {
        toast.error('Could not save your description. Keep the task open and copy your text.');
        return false;
      }
    }
    const unregister = registerDescriptionEditor(task.id, flush);
    return () => {
      unregister();
      // Route changes also leave the task; the board guard handles its own close/switch paths.
      flush();
    };
  }, [task.id]);

  function useLatest() {
    storeDescriptionDraft(task.id, null);
    unstored.current = null;
    setSession({ document: task.description, baseVersion: task.descriptionVersion, key: uuidv7() });
    setReviewing(false);
    setError(null);
  }

  return (
    <section
      id={`description-${task.id}`}
      tabIndex={-1}
      aria-label="Description"
      className="mt-5 min-h-24 scroll-m-5 outline-none focus:ring-2 focus:ring-ring/60"
    >
      {error && (
        <p role="alert" className="mb-3 text-destructive text-sm">
          {error}
        </p>
      )}
      {stale && (
        <div className="mb-5 rounded-2xl bg-foreground/[0.06] p-4 text-sm">
          <p role="status">
            {draft.status === 'conflict'
              ? 'Your description was not applied. Your draft is kept here.'
              : 'The description changed on another device. Your draft is kept here.'}
          </p>
          <Button
            variant="link"
            className="mt-1 px-0"
            onClick={() => {
              setReviewedVersion(task.descriptionVersion);
              setReviewing(true);
            }}
          >
            Review latest description
          </Button>
          {reviewing && (
            <div className="mt-3 border-border border-t pt-3">
              <h2 className="mb-2 font-medium">Latest description</h2>
              <LazyDescriptionEditor
                key={`latest:${task.descriptionVersion}`}
                initialContent={task.description}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={useLatest}>
                  Use latest description
                </Button>
                <Button
                  onClick={() => {
                    if (unstored.current) {
                      setError(
                        'This device could not store your text. Keep the task open and copy it.',
                      );
                      return;
                    }
                    const current = getTask(task.id);
                    if (!current || reviewedVersion !== current.descriptionVersion) {
                      setError(
                        'The description changed again. Review the latest version before keeping yours.',
                      );
                      setReviewing(false);
                      return;
                    }
                    storeDescriptionDraft(task.id, {
                      ...draft,
                      baseVersion: reviewedVersion ?? null,
                      submittedVersion: null,
                      status: 'editing',
                    });
                    setReviewing(false);
                    setError(null);
                  }}
                >
                  Keep my version
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      <LazyDescriptionEditor
        key={session.key}
        initialContent={session.document}
        editable
        onChange={(document) => {
          const existing = readDescriptionDraft(task.id);
          const next: DescriptionDraft = {
            document,
            // A queued draft's base is the version it saved: a parent pane left beneath its
            // subtask keeps its editor after leaving, and editing resumes from that save.
            baseVersion: existing ? existing.baseVersion : session.baseVersion,
            editorKey: session.key,
            submittedVersion: existing?.status === 'conflict' ? existing.submittedVersion : null,
            status: existing?.status === 'conflict' ? 'conflict' : 'editing',
          };
          try {
            storeDescriptionDraft(task.id, next);
            unstored.current = null;
            setError(null);
          } catch {
            unstored.current = next;
            setError(
              'This device could not store your draft. Keep this task open and copy your text.',
            );
          }
        }}
      />
    </section>
  );
}
