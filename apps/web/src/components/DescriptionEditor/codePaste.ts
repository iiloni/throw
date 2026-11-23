import type { BlockNoteEditor, BlockNoteEditorOptions } from '@blocknote/core';
import { toast } from 'sonner';
import { codeSnippetText, normalizeCodeIndentation } from './codeSnippet';
import type { descriptionEditorSchema } from './DescriptionEditor';

export type CodeEditor = BlockNoteEditor<
  typeof descriptionEditorSchema.blockSchema,
  typeof descriptionEditorSchema.inlineContentSchema,
  typeof descriptionEditorSchema.styleSchema
>;
type PasteContext = Parameters<
  NonNullable<
    BlockNoteEditorOptions<
      typeof descriptionEditorSchema.blockSchema,
      typeof descriptionEditorSchema.inlineContentSchema,
      typeof descriptionEditorSchema.styleSchema
    >['pasteHandler']
  >
>[0];

const requests = new WeakMap<CodeEditor, Map<string, object>>();

/** A choice made while the detector loads always wins, including Plain text. */
export function cancelCodeDetection(editor: CodeEditor, id: string) {
  requests.get(editor)?.delete(id);
}

export async function detectBlockLanguage(editor: CodeEditor, id: string, manual = false) {
  const block = editor.getBlock(id);
  if (!editor.isEditable || block?.type !== 'codeBlock') return;
  const source = codeSnippetText(block.content);
  const language = block.props.language;
  const pending = requests.get(editor) ?? new Map<string, object>();
  requests.set(editor, pending);
  const request = {};
  pending.set(id, request);
  try {
    const { detectCodeLanguage } = await import('./detectCodeLanguage');
    const detected = detectCodeLanguage(source);
    const current = editor.getBlock(id);
    if (
      pending.get(id) !== request ||
      !editor.domElement?.isConnected ||
      !editor.isEditable ||
      current?.type !== 'codeBlock' ||
      current.props.language !== language ||
      codeSnippetText(current.content) !== source
    )
      return;
    if (detected) editor.updateBlock(id, { props: { language: detected } });
    else if (manual) toast('Could not confidently detect a language. Choose one from the list.');
  } catch {
    if (manual) toast('Could not detect the code language. Choose one from the list.');
  } finally {
    if (pending.get(id) === request) pending.delete(id);
  }
}

export function pasteCode({ event, editor, defaultPasteHandler }: PasteContext) {
  const clipboard = event.clipboardData;
  if (!clipboard) return false;
  const text = clipboard.getData('text/plain');
  const { $from, $to } = editor.prosemirrorState.selection;
  if ($from.parent.type.spec.code && $to.parent === $from.parent && text) {
    const block = editor.getTextCursorPosition().block;
    const empty = !codeSnippetText(block.content);
    const beforeCursor = $from.parent.textContent.slice(0, $from.parentOffset);
    const currentLine = beforeCursor.slice(beforeCursor.lastIndexOf('\n') + 1);
    const indent = currentLine.match(/^[ \t]*/)?.[0] ?? '';
    editor.pasteText(normalizeCodeIndentation(text, indent));
    if (empty && block.type === 'codeBlock' && !block.props.language)
      void detectBlockLanguage(editor, block.id);
    return true;
  }

  // Our own blocks carry their exact source and any explicit language choices.
  if (clipboard.types.includes('blocknote/html')) return defaultPasteHandler();

  const before = new Set<string>();
  editor.forEachBlock((block) => {
    if (block.type === 'codeBlock') before.add(block.id);
    return true;
  });
  const handled = defaultPasteHandler();
  const added: string[] = [];
  editor.forEachBlock((block) => {
    if (block.type === 'codeBlock' && !before.has(block.id)) added.push(block.id);
    return true;
  });
  for (const id of added) {
    const block = editor.getBlock(id);
    if (block?.type !== 'codeBlock') continue;
    const source = codeSnippetText(block.content);
    const normalized = normalizeCodeIndentation(source);
    if (normalized !== source) editor.updateBlock(id, { content: normalized });
    if (!block.props.language) void detectBlockLanguage(editor, id);
  }
  return handled;
}
