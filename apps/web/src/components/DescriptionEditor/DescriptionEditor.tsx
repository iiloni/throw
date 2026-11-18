import '@blocknote/shadcn/style.css';
import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { en } from '@blocknote/core/locales';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import type { Description } from '@throw/shared';
import { useEffect } from 'react';
import { useResolvedTheme } from '@/lib/theme';

// Catch's editor, narrowed to text blocks. No file nodes, upload handlers or embeds.
export const descriptionEditorSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: defaultBlockSpecs.heading,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    quote: defaultBlockSpecs.quote,
    codeBlock: defaultBlockSpecs.codeBlock,
    divider: defaultBlockSpecs.divider,
    table: defaultBlockSpecs.table,
  },
});

/** Content is read on mount; the owner changes the key to accept a remote revision. */
export function DescriptionEditor({
  initialContent,
  editable = false,
  onChange,
  placeholder = 'Describe the work…',
  autoFocus = false,
  scrollClearance = 0,
}: {
  initialContent: Description;
  editable?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /** Keep actions beneath an editor clear of the dock while typing. */
  scrollClearance?: number;
  onChange?: (document: Description) => void;
}) {
  const theme = useResolvedTheme();
  const editor = useCreateBlockNote({
    schema: descriptionEditorSchema,
    initialContent: initialContent?.length
      ? (initialContent as (typeof descriptionEditorSchema.PartialBlock)[])
      : [{ type: 'paragraph' }],
    trailingBlock: true,
    dictionary: {
      ...en,
      placeholders: { ...en.placeholders, default: placeholder },
    },
  });
  useEffect(() => {
    if (autoFocus && editable) editor.focus();
  }, [autoFocus, editable, editor]);
  // Catch keeps the caret above its native keyboard and dock. Throw owns the same inset
  // as a CSS token, so observe it rather than installing a second keyboard tracker. A dock
  // resting over the scroll area declares itself as the area's bottom scroll padding.
  useEffect(() => {
    if (!editable) return;
    let frame = 0;
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!editor.isFocused()) return;
        const keyboard =
          Number.parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--keyboard'),
          ) || 0;
        const view = editor.prosemirrorView;
        const area = view.dom.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
        if (!area) return;
        const covered = Number.parseFloat(getComputedStyle(area).scrollPaddingBottom) || 0;
        if (keyboard <= 0 && covered <= 0) return;
        const caret = view.coordsAtPos(view.state.selection.head);
        const bottom = area.getBoundingClientRect().bottom - covered - 16 - scrollClearance;
        if (caret.bottom > bottom) area.scrollTop += caret.bottom - bottom + 12;
      });
    }
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    const offSelection = editor.onSelectionChange(schedule);
    const offChange = editor.onChange(schedule);
    return () => {
      observer.disconnect();
      offSelection();
      offChange();
      cancelAnimationFrame(frame);
    };
  }, [editor, editable, scrollClearance]);

  return (
    <div className="description-editor">
      <BlockNoteView
        editor={editor}
        editable={editable}
        theme={theme}
        filePanel={false}
        onChange={() => onChange?.(editor.document as Description)}
        className="task-editor"
      />
    </div>
  );
}
