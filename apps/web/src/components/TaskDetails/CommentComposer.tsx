import type { CommentBody, Description } from '@throw/shared';
import { useState } from 'react';
import { LazyDescriptionEditor } from '@/components/DescriptionEditor/LazyDescriptionEditor';
import { Button } from '@/components/ui/button';
import { hasCommentText } from './history';

export function CommentComposer({
  initialContent = null,
  onSave,
  onCancel,
}: {
  initialContent?: Description;
  onSave: (body: CommentBody) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(initialContent);
  const [error, setError] = useState<string | null>(null);
  return (
    <section aria-label="Comment editor" className="mt-3 rounded-2xl border border-border p-4">
      <LazyDescriptionEditor
        initialContent={initialContent}
        editable
        scrollClearance={96}
        autoFocus
        placeholder="Write a comment…"
        onChange={setBody}
      />
      {error && (
        <p role="alert" className="mt-2 text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          disabled={!hasCommentText(body)}
          onClick={() => {
            if (!body?.length || !hasCommentText(body)) return;
            try {
              onSave(body);
            } catch {
              setError('Could not save this comment. Your text is kept here.');
            }
          }}
        >
          {initialContent ? 'Save comment' : 'Post comment'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
