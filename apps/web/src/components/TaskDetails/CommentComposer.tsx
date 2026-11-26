import type { CommentBody, Description } from '@throw/shared';
import { SendHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LazyDescriptionEditor } from '@/components/DescriptionEditor/LazyDescriptionEditor';
import { Button } from '@/components/ui/button';
import { readCommentDraft, storeCommentDraft } from '@/lib/commentDrafts';
import { holdUpdateReload } from '@/lib/useUpdateReloadBlocked';
import { cn } from '@/lib/utils';
import { hasCommentText } from './history';
import { commentSurface } from './timelineParts';

const same = (a: Description, b: Description) => JSON.stringify(a) === JSON.stringify(b);
const apple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

/**
 * Writes a new comment for `draftFor`'s task, or edits `initialContent`. A new comment's
 * text is kept on this device until it is posted or cancelled; an edit lives in the editor.
 * `bare` leaves out its own surface, for an edit on the comment's card.
 */
export function CommentComposer({
  initialContent = null,
  draftFor,
  onSave,
  onCancel,
  bare = false,
  className,
}: {
  className?: string;
  initialContent?: Description;
  draftFor?: string;
  onSave: (body: CommentBody) => void;
  onCancel: () => void;
  bare?: boolean;
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
  const verb = initialContent ? 'save' : 'post';
  return (
    <section
      aria-label="Comment editor"
      className={cn(
        !bare &&
          cn(
            commentSurface,
            'px-3.5 pt-3 pb-2 transition-shadow duration-200 focus-within:ring-ring/45 sm:px-4',
          ),
        className,
      )}
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
        sideMenu={false}
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
      <div className="mt-2 flex items-center gap-1 border-foreground/[0.07] border-t pt-2">
        {/* A keyboard's shortcut, where there is a keyboard to press it on. */}
        <span
          aria-hidden
          className={cn(
            'mr-auto hidden items-center gap-1 text-muted-foreground text-xs transition-opacity duration-150 pointer-fine:inline-flex',
            !writing && 'opacity-0',
          )}
        >
          <kbd className="rounded-md bg-foreground/[0.07] px-1.5 py-px font-sans text-[0.6875rem]">
            {apple ? '⌘' : 'Ctrl'} ↵
          </kbd>
          to {verb}
        </span>
        <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={cancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!writing}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          className="rounded-full transition-[opacity,background-color]"
          onClick={save}
        >
          <SendHorizontal aria-hidden />
          {initialContent ? 'Save comment' : 'Post comment'}
        </Button>
      </div>
    </section>
  );
}
