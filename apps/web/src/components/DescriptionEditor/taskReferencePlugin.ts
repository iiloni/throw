import type { Node } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { findTaskReferences } from '@/lib/taskReferences';

/** What the editor knows of a reference it draws. */
export type ResolvedReference = { taskId: string; category: string; label: string };

export type ReferenceResolver = {
  resolve(identifier: string): ResolvedReference | undefined;
  /** A read-only editor's references are focusable links; an editable one's are text. */
  editable: boolean;
};

const key = new PluginKey<DecorationSet>('taskReferences');

// Stands in for text a reference may not run through: code, a link, a hard break.
const BARRIER = '￼';

function decorate(doc: Node, resolver: ReferenceResolver | null) {
  if (!resolver) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.spec.code) return false;
    if (!node.isTextblock) return true;
    // A block's text as one string, so a reference whose halves are styled apart still reads
    // whole. Each character keeps its document position.
    let text = '';
    const positions: number[] = [];
    node.forEach((child, offset) => {
      const usable =
        child.isText &&
        !child.marks.some((mark) => mark.type.spec.code || mark.type.name === 'link');
      if (!usable || !child.text) {
        text += BARRIER;
        positions.push(-1);
        return;
      }
      text += child.text;
      for (let i = 0; i < child.text.length; i++) positions.push(pos + 1 + offset + i);
    });
    for (const match of findTaskReferences(text)) {
      const found = resolver.resolve(match.identifier);
      if (!found) continue;
      const from = positions[match.start]!;
      const to = positions[match.end - 1]! + 1;
      decorations.push(
        Decoration.inline(
          from,
          to,
          {
            class: 'task-ref',
            'data-task-ref': match.identifier,
            'data-task-id': found.taskId,
            'data-category': found.category,
            spellcheck: 'false',
            ...(resolver.editable
              ? {}
              : {
                  role: 'link',
                  tabindex: '0',
                  'aria-label': `${match.identifier}: ${found.label}`,
                }),
          },
          { identifier: match.identifier },
        ),
      );
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * Draws each `#KEY-N` the device can resolve as a link, leaving the text itself untouched, so
 * the stored document and its Markdown hold only `#KEY-N` (see `lib/taskReferences.ts`).
 * `read` is asked on every change; `refreshTaskReferences` asks it again after the tasks did.
 */
export function taskReferencePlugin(read: () => ReferenceResolver | null) {
  return new Plugin<DecorationSet>({
    key,
    state: {
      init: (_config, state) => decorate(state.doc, read()),
      apply: (tr, set, _old, state) =>
        tr.docChanged || tr.getMeta(key) ? decorate(state.doc, read()) : set,
    },
    props: {
      decorations: (state) => key.getState(state),
      handleDOMEvents: {
        // A press on a reference opens it on release (TaskReferenceLayer) instead of placing
        // the caret, which would raise a phone's keyboard first. A modified press, or the
        // keyboard, still edits its text.
        mousedown(view, event) {
          if (!view.editable || event.button !== 0) return false;
          if (event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return false;
          if (!(event.target instanceof Element) || !event.target.closest('[data-task-ref]'))
            return false;
          event.preventDefault();
          return true;
        },
      },
    },
  });
}

export function refreshTaskReferences(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(key, true).setMeta('addToHistory', false));
}

/** The reference the caret stands inside, past its first character and before its end. */
export function referenceAtCaret(view: EditorView): Element | null {
  const { selection } = view.state;
  if (!selection.empty) return null;
  const head = selection.head;
  const found = key
    .getState(view.state)
    ?.find(head, head)
    .find((decoration) => decoration.from < head && head < decoration.to);
  if (!found) return null;
  const { node } = view.domAtPos(found.from + 1);
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest('[data-task-ref]') ?? null;
}
