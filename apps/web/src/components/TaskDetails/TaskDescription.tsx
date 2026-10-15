import type { Task } from '@throw/shared';
import { useState } from 'react';
import { uuidv7 } from 'uuidv7';
import { LazyDescriptionEditor } from '@/components/DescriptionEditor/LazyDescriptionEditor';
import { Button } from '@/components/ui/button';
import {
  descriptionIsStale,
  readDescriptionDraft,
  storeDescriptionDraft,
  useDescriptionDraft,
} from '@/lib/descriptionDrafts';
import { getTask, saveDescription } from '@/lib/tasks';

export function TaskDescription({ task }: { task: Task }) {
  const draft = useDescriptionDraft(task.id);
  const [reviewedVersion, setReviewedVersion] = useState<string | null | undefined>(undefined);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const editing = draft && draft.status !== 'pending';
  const stale =
    draft && (draft.status === 'conflict' || descriptionIsStale(draft, task.descriptionVersion));

  function begin() {
    try {
      storeDescriptionDraft(task.id, {
        document: task.description,
        baseVersion: task.descriptionVersion,
        editorKey: uuidv7(),
        submittedVersion: null,
        status: 'editing',
      });
      setStorageFailed(false);
      setError(null);
    } catch {
      setError('This device could not store a draft. Free some storage and try again.');
    }
  }

  function save(replace = false) {
    if (!draft) return;
    const current = getTask(task.id);
    if (!current) return;
    if (replace && reviewedVersion !== current.descriptionVersion) {
      setError('The description changed again. Review the latest version before applying yours.');
      setReviewing(false);
      return;
    }
    try {
      const saved = saveDescription(
        task.id,
        draft.document,
        replace ? (reviewedVersion ?? null) : draft.baseVersion,
      );
      if (!saved) {
        storeDescriptionDraft(task.id, { ...draft, status: 'conflict' });
        return;
      }
      storeDescriptionDraft(task.id, {
        ...draft,
        baseVersion: saved.version,
        submittedVersion: saved.version,
        status: 'pending',
      });
      setReviewing(false);
      setError(null);
      void saved.transaction.isPersisted.promise.catch(() => {
        const pending = readDescriptionDraft(task.id);
        // A failed older write must never replace text written after it was queued.
        if (pending?.status === 'pending' && pending.submittedVersion === saved.version)
          storeDescriptionDraft(task.id, { ...draft, status: 'editing' });
        setError('The description could not be saved. Your draft is still on this device.');
      });
    } catch {
      setError('The description could not be saved. Keep this pane open and copy your text.');
    }
  }

  return (
    <section aria-label="Description" className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-semibold text-sm">Description</h2>
        {!editing && (
          <Button variant="ghost" size="sm" onClick={begin}>
            Edit description
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="mb-3 text-destructive text-sm">
          {error}
        </p>
      )}
      {stale && (
        <div className="mb-4 rounded-xl bg-foreground/[0.06] p-4 text-sm">
          <p role="status">
            {draft.status === 'conflict'
              ? 'Your description was not applied. Your text is kept here; the server’s version stands.'
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
              <h3 className="mb-2 font-medium">Latest description</h3>
              <LazyDescriptionEditor
                key={`latest:${task.descriptionVersion}`}
                initialContent={task.description}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    storeDescriptionDraft(task.id, null);
                    setReviewing(false);
                  }}
                >
                  Use latest description
                </Button>
                <Button disabled={storageFailed} onClick={() => save(true)}>
                  Apply my version
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      <LazyDescriptionEditor
        key={editing ? draft.editorKey : `read:${task.descriptionVersion}`}
        initialContent={editing ? draft.document : task.description}
        editable={!!editing}
        onChange={(document) => {
          if (!editing) return;
          try {
            storeDescriptionDraft(task.id, { ...draft, document });
            setStorageFailed(false);
            setError(null);
          } catch {
            setStorageFailed(true);
            setError(
              'This device could not store your draft. Keep this pane open and copy your text.',
            );
          }
        }}
      />
      {editing ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button disabled={!!stale || storageFailed} onClick={() => save()}>
            Save description
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              storeDescriptionDraft(task.id, null);
              setReviewing(false);
            }}
          >
            Cancel
          </Button>
          <span className="text-muted-foreground text-xs">Draft kept on this device</span>
        </div>
      ) : draft?.status === 'pending' ? (
        <p className="mt-2 text-muted-foreground text-xs">Queued for sync</p>
      ) : null}
    </section>
  );
}
