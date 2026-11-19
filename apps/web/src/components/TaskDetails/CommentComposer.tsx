import type { CommentBody, Description } from '@throw/shared';
import { useEffect, useState } from 'react';
import { LazyDescriptionEditor } from '@/components/DescriptionEditor/LazyDescriptionEditor';
import { Button } from '@/components/ui/button';
import { readCommentDraft, storeCommentDraft } from '@/lib/commentDrafts';
import { holdUpdateReload } from '@/lib/useUpdateReloadBlocked';
import { hasCommentText } from './history';

const same = (a: Description, b: Description) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Writes a new comment for `draftFor`'s task, or edits `initialContent`. A new comment's
 * text is kept on this device until it is posted or cancelled; an edit lives in the editor.
 */
export function CommentComposer({
  initialContent = null,
  draftFor,
  onSave,
  onCancel,
}: {
  initialContent?: Description;
  draftFor?: string;
  onSave: (body: CommentBody) => void;
  onCancel: () => void;
}) {
  const [start] = useState(() => (draftFor ? readCommentDraft(draftFor) : null) ?? initialContent);
  const [body, setBody] = useState(start);
  const [error, setError] = useState<string | null>(null);
  const writing = hasCommentText(body);
  // Text that exists nowhere else holds an update's reload: an edit only once it differs.
  const unsaved = initialContent === null ? writing : !same(body, initialContent);
  useEffect(() => (unsaved ? holdUpdateReload() : undefined), [unsaved]);
  function save() {
    if (!body?.length || !hasCommentText(body)) return;
    try {
      onSave(body);
      if (draftFor) storeCommentDraft(draftFor, null);
    } catch {
      setError('Could not save this comment. Your text is kept here.');
    }
  }
  function cancel() {
    if (draftFor) storeCommentDraft(draftFor, null);
    onCancel();
  }
  return (
    <section
      aria-label="Comment editor"
      className="mt-3 rounded-2xl border border-border p-4"
      // Before the editor, which would otherwise take Mod-Enter for itself.
      onKeyDownCapture={(event) => {
        if (
          event.key !== 'Enter' ||
          !(event.metaKey || event.ctrlKey) ||
          event.nativeEvent.isComposing
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        save();
      }}
    >
      <LazyDescriptionEditor
        initialContent={start}
        editable
        scrollClearance={96}
        autoFocus
        placeholder="Write a comment…"
        onChange={(document) => {
          setBody(document);
          if (draftFor) storeCommentDraft(draftFor, hasCommentText(document) ? document : null);
        }}
      />
      {error && (
        <p role="alert" className="mt-2 text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button type="button" disabled={!writing} onClick={save}>
          {initialContent ? 'Save comment' : 'Post comment'}
        </Button>
        <Button type="button" variant="ghost" onClick={cancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
