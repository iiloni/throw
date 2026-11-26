import '@blocknote/shadcn/style.css';
import { type BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { HistoryExtension, SuggestionMenu } from '@blocknote/core/extensions';
import { en } from '@blocknote/core/locales';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import type { Description } from '@throw/shared';
import { type MouseEvent, useEffect, useMemo, useState } from 'react';
import { useResolvedTheme } from '@/lib/theme';
import { CodeLanguagePicker } from './CodeLanguagePicker';
import { codeBlock, syntaxHighlighting } from './codeBlock';
import { pasteCode } from './codePaste';
import {
  type EditorControls,
  type FormattingState,
  type TextStyle,
  touchEditor,
} from './editorControls';

// Catch's editor, narrowed to text blocks. No file nodes, upload handlers or embeds.
export const descriptionEditorSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: defaultBlockSpecs.heading,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    quote: defaultBlockSpecs.quote,
    codeBlock,
    divider: defaultBlockSpecs.divider,
    table: defaultBlockSpecs.table,
  },
});

type Editor = BlockNoteEditor<
  typeof descriptionEditorSchema.blockSchema,
  typeof descriptionEditorSchema.inlineContentSchema,
  typeof descriptionEditorSchema.styleSchema
>;

// A finger formats from the dock's formatting bar, as in Catch; BlockNote's floating toolbar
// suits a mouse.
const coarsePointer =
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

/** Content is read on mount; the owner changes the key to accept a remote revision. */
export function DescriptionEditor({
  initialContent,
  editable = false,
  onChange,
  placeholder = 'Describe the work…',
  autoFocus = false,
  scrollClearance = 0,
  sideMenu = true,
  onControls,
}: {
  initialContent: Description;
  editable?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /** Keep actions beneath an editor clear of the dock while typing. */
  scrollClearance?: number;
  /** BlockNote's drag handle beside each block, which a comment's card has no room for. */
  sideMenu?: boolean;
  onChange?: (document: Description) => void;
  /** Hands the owner this editor's controls while it is mounted, for its undo and redo. */
  onControls?: (controls: EditorControls | null) => void;
}) {
  const theme = useResolvedTheme();
  const editor = useCreateBlockNote({
    schema: descriptionEditorSchema,
    extensions: [syntaxHighlighting],
    pasteHandler: pasteCode,
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
  const [languageBlock, setLanguageBlock] = useState<{ id: string; anchor: Element } | null>(null);
  function openCodeLanguage(event: MouseEvent<HTMLDivElement>) {
    if (!editable || !(event.target instanceof Element)) return;
    // A code block draws its language button itself, outside React (see codeBlock.ts).
    const language = event.target.closest('.description-code-language > button');
    if (language && editor.domElement?.contains(language)) {
      const id = language.closest<HTMLElement>('[data-node-type="blockContainer"]')?.dataset.id;
      if (id) setLanguageBlock((open) => (open?.id === id ? null : { id, anchor: language }));
    }
  }
  const controls = useMemo(() => createControls(editor), [editor]);
  useEffect(() => {
    if (!editable || !onControls) return;
    onControls(controls);
    return () => onControls(null);
  }, [editable, onControls, controls]);
  // While it has focus on a touch screen, this editor is the one the dock formats.
  useEffect(() => {
    if (!editable || !coarsePointer) return;
    const dom = editor.prosemirrorView?.dom;
    if (!dom) return;
    const claim = () => touchEditor.set(controls);
    const release = () => {
      if (touchEditor.get() === controls) touchEditor.set(null);
    };
    if (dom.contains(document.activeElement)) claim();
    dom.addEventListener('focus', claim);
    dom.addEventListener('blur', release);
    return () => {
      dom.removeEventListener('focus', claim);
      dom.removeEventListener('blur', release);
      release();
    };
  }, [editor, editable, controls]);
  // Catch keeps the caret above its native keyboard and dock. Throw owns the same inset
  // as a CSS token, so observe it rather than installing a second keyboard tracker. A dock
  // resting over the scroll area declares itself as the area's bottom scroll padding, and
  // toolbars floating over its top as its top scroll padding.
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
        const style = getComputedStyle(area);
        const covered = Number.parseFloat(style.scrollPaddingBottom) || 0;
        const coveredTop = Number.parseFloat(style.scrollPaddingTop) || 0;
        if (keyboard <= 0 && covered <= 0 && coveredTop <= 0) return;
        const caret = view.coordsAtPos(view.state.selection.head);
        const rect = area.getBoundingClientRect();
        const top = rect.top + coveredTop;
        const bottom = rect.bottom - covered - 16 - scrollClearance;
        // Only a caret hidden under the toolbars: one scrolled further up was scrolled away.
        if (caret.top < top && caret.bottom > rect.top) area.scrollTop -= top - caret.top + 12;
        else if (caret.bottom > bottom) area.scrollTop += caret.bottom - bottom + 12;
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
        formattingToolbar={!coarsePointer}
        sideMenu={sideMenu}
        onChange={() => onChange?.(editor.document as Description)}
        onClick={openCodeLanguage}
        className="task-editor"
      />
      {editable && languageBlock && (
        <CodeLanguagePicker
          key={languageBlock.id}
          editor={editor}
          blockId={languageBlock.id}
          anchor={languageBlock.anchor}
          onClose={() => setLanguageBlock(null)}
        />
      )}
    </div>
  );
}

function createControls(editor: Editor): EditorControls {
  const listeners = new Set<() => void>();
  let state = readState(editor);

  function refresh() {
    const next = readState(editor);
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    for (const listener of listeners) listener();
  }

  function selectedBlocks() {
    return editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
  }

  return {
    getState: () => state,
    subscribe(listener) {
      if (listeners.size === 0) refresh();
      listeners.add(listener);
      const offChange = editor.onChange(refresh);
      const offSelection = editor.onSelectionChange(refresh);
      return () => {
        listeners.delete(listener);
        offChange?.();
        offSelection?.();
      };
    },
    toggleStyle(style) {
      editor.toggleStyles({ [style]: true });
      // Toggling with an empty selection only changes the stored marks, which fires no event.
      refresh();
    },
    toggleBlock(kind) {
      const blocks = selectedBlocks();
      const off = blocks.every((block) => block.type === kind);
      editor.transact(() => {
        for (const block of blocks) {
          editor.updateBlock(
            block,
            off
              ? { type: 'paragraph' }
              : kind === 'heading'
                ? { type: 'heading', props: { level: 3 } }
                : { type: kind },
          );
        }
      });
      refresh();
    },
    insertSlash() {
      editor
        .getExtension(SuggestionMenu)
        ?.openSuggestionMenu('/', { deleteTriggerCharacter: true });
    },
    indent() {
      if (editor.canNestBlock()) editor.nestBlock();
      refresh();
    },
    outdent() {
      if (editor.canUnnestBlock()) editor.unnestBlock();
      refresh();
    },
    undo() {
      // Only hold on to focus: taking it would raise a keyboard the user had put away.
      const focused = editor.isFocused();
      editor.undo();
      if (focused) editor.focus();
      refresh();
    },
    redo() {
      const focused = editor.isFocused();
      editor.redo();
      if (focused) editor.focus();
      refresh();
    },
  };
}

function readState(editor: Editor): FormattingState {
  const active: Partial<Record<TextStyle, unknown>> = editor.getActiveStyles();
  const history = editor.getExtension(HistoryExtension);
  return {
    styles: {
      bold: Boolean(active.bold),
      italic: Boolean(active.italic),
      underline: Boolean(active.underline),
      strike: Boolean(active.strike),
    },
    block: editor.getTextCursorPosition().block.type,
    canIndent: editor.canNestBlock(),
    canOutdent: editor.canUnnestBlock(),
    canUndo: history ? editor.canExec(history.undoCommand) : false,
    canRedo: history ? editor.canExec(history.redoCommand) : false,
  };
}
