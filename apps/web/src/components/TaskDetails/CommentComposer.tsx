import type { CommentBody, Description } from '@throw/shared';
import { useEffect, useState } from 'react';
import { LazyDescriptionEditor } from '@/components/DescriptionEditor/LazyDescriptionEditor';
import { Button } from '@/components/ui/button';
import { readCommentDraft, storeCommentDraft } from '@/lib/commentDrafts';
import { holdUpdateReload } from '@/lib/useUpdateReloadBlocked';
import { hasCommentText } from './history';

/** A draft stays on this device until the comment is saved or explicitly cancelled. */
export function CommentComposer({
  initialContent = null,
  draftKey,
  onSave,
  onCancel,
}: {
  initialContent?: Description;
  draftKey: string | null;
  onSave: (body: CommentBody) => void;
  onCancel: () => void;
}) {
  const [draft] = useState(() => readCommentDraft(draftKey));
  const [body, setBody] = useState(draft ?? initialContent);
  const [changed, setChanged] = useState(draft !== null);
  const [error, setError] = useState<string | null>(null);
  const writing = hasCommentText(body);
  useEffect(() => (changed ? holdUpdateReload() : undefined), [changed]);
  function save() {
    if (!body?.length || !hasCommentText(body)) return;
    try {
      onSave(body);
      storeCommentDraft(draftKey, null);
    } catch {
      setError('Could not save this comment. Your text is kept here.');
    }
  }
  function cancel() {
    storeCommentDraft(draftKey, null);
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
        initialContent={draft ?? initialContent}
        editable
        scrollClearance={96}
        autoFocus
        placeholder="Write a comment…"
        onChange={(document) => {
          setBody(document);
          const keepDraft = initialContent !== null || hasCommentText(document);
          setChanged(keepDraft);
          storeCommentDraft(draftKey, keepDraft ? (document ?? []) : null);
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
