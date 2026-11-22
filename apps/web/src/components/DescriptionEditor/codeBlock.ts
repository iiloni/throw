import { createCodeBlockSpec, SyntaxHighlightingExtension } from '@blocknote/core';
import { type AnimationPlaybackControls, animate } from 'motion/react';
import { toast } from 'sonner';
import { haptics } from '@/lib/haptics';
import { curves, springs } from '@/lib/motion';
import { codeLanguageIconProps, codeLanguageId, codeLanguageName } from './codeLanguages';
import { codeSnippetText, copyCodeSnippet, downloadCodeSnippet } from './codeSnippet';

// An empty language can be detected on paste. Explicit Plain text is stored as "text".
const base = createCodeBlockSpec({ defaultLanguage: '' });

export const codeBlock: typeof base = {
  ...base,
  implementation: {
    ...base.implementation,
    meta: {
      ...base.implementation.meta,
      highlight: (block) => codeLanguageId(block.props.language) ?? '',
    },
    render(block, editor) {
      const rendered = base.implementation.render.call(this, block, editor);
      if (this.renderType !== 'nodeView') return rendered;

      const language = block.props.language;
      const name = codeLanguageName(language);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'description-code-language';
      button.dataset.codeBlockId = block.id;
      button.setAttribute('aria-label', `Code language: ${name}`);
      button.title = `Code language: ${name}`;
      const icon = document.createElement('span');
      icon.className = 'description-code-icon';
      icon.setAttribute('aria-hidden', 'true');
      const iconProps = codeLanguageIconProps(language);
      icon.toggleAttribute('data-tinted', iconProps['data-tinted'] === '');
      icon.style.setProperty('--code-language-icon', iconProps.style['--code-language-icon']);
      const label = document.createElement('span');
      label.className = 'description-code-label truncate';
      label.textContent = name;
      button.append(icon, label);
      const chevron = document.createElement('span');
      chevron.className = 'description-code-chevron';
      chevron.setAttribute('aria-hidden', 'true');
      if (editor.isEditable) {
        button.setAttribute('aria-haspopup', 'dialog');
        button.append(chevron);
      }

      const toolbar = document.createElement('div');
      toolbar.className = 'description-code-toolbar glass';
      toolbar.contentEditable = 'false';
      const copy = actionButton('Copy snippet', 'M9 5H5v16h12v-4M9 3h12v14H9z');
      const download = actionButton('Download snippet', 'M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5');
      toolbar.append(button, copy, download);
      rendered.dom.prepend(toolbar);

      copy.addEventListener('click', (event) => {
        event.stopPropagation();
        const current = editor.getBlock(block.id);
        if (current?.type !== 'codeBlock') return;
        void copyCodeSnippet(codeSnippetText(current.content)).then(
          () => {
            haptics.success();
            toast('Snippet copied');
          },
          () => toast.error('Could not copy the snippet'),
        );
      });
      download.addEventListener('click', (event) => {
        event.stopPropagation();
        const current = editor.getBlock(block.id);
        if (current?.type !== 'codeBlock') return;
        download.disabled = true;
        void downloadCodeSnippet(codeSnippetText(current.content), current.props.language)
          .then((message) => {
            if (message) toast(message);
          })
          .catch(() => toast.error('Could not download the snippet'))
          .finally(() => {
            download.disabled = false;
          });
      });

      const revealed = editor.isEditable
        ? [label, chevron, copy, download]
        : [label, copy, download];
      let running: AnimationPlaybackControls[] = [];
      let expanded = false;
      let pinned = false;
      let hovering = false;
      let revealOnClick = false;
      copy.inert = true;
      download.inert = true;
      function expand(open: boolean) {
        if (open === expanded) return;
        expanded = open;
        toolbar.toggleAttribute('data-expanded', open);
        for (const animation of running) animation.stop();
        const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        copy.inert = !open;
        download.inert = !open;
        if (open) for (const element of revealed) element.style.visibility = 'visible';

        const style = getComputedStyle(toolbar);
        const rim =
          toolbar.offsetWidth -
          toolbar.clientWidth +
          Number.parseFloat(style.paddingLeft) +
          Number.parseFloat(style.paddingRight);
        const width = open
          ? button.offsetWidth + copy.offsetWidth + download.offsetWidth + rim
          : icon.offsetWidth + Math.max(0, button.offsetHeight - icon.offsetHeight) + rim;
        const fade = animate(
          revealed,
          { opacity: open ? 1 : 0 },
          still ? { duration: 0 } : curves.fade,
        );
        running = [
          animate(toolbar, { maxWidth: `${width}px` }, still ? { duration: 0 } : springs.smooth),
          fade,
        ];
        if (!open) {
          void fade.then(() => {
            if (expanded) return;
            for (const element of revealed) element.style.visibility = 'hidden';
          });
        }
      }

      toolbar.addEventListener('pointerenter', (event) => {
        if (event.pointerType === 'touch') return;
        hovering = true;
        expand(true);
      });
      toolbar.addEventListener('pointerleave', () => {
        hovering = false;
        if (!pinned && !toolbar.matches(':focus-within')) expand(false);
      });
      toolbar.addEventListener('focusin', () => expand(true));
      toolbar.addEventListener('focusout', (event) => {
        if (event.relatedTarget instanceof Node && toolbar.contains(event.relatedTarget)) return;
        pinned = false;
        if (!hovering) expand(false);
      });
      button.addEventListener('pointerdown', (event) => {
        // The first touch reveals the pill without moving the code caret.
        revealOnClick = event.pointerType === 'touch' && !expanded;
        event.preventDefault();
      });
      button.addEventListener('click', (event) => {
        if (revealOnClick && event.detail > 0) {
          pinned = true;
          expand(true);
          haptics.toggle();
          event.stopPropagation();
        } else if (!editor.isEditable) {
          pinned = !pinned;
          expand(pinned || hovering);
          event.stopPropagation();
        }
        revealOnClick = false;
      });
      toolbar.addEventListener('keydown', (event) => {
        // Tab belongs to the pill here, where the editor would insert indentation.
        event.stopPropagation();
        if (event.key !== 'Escape' || !expanded) return;
        event.preventDefault();
        pinned = false;
        expand(false);
        editor.focus();
      });
      const outside = (event: PointerEvent) => {
        if (event.target instanceof Node && toolbar.contains(event.target)) return;
        pinned = false;
        expand(false);
      };
      document.addEventListener('pointerdown', outside);

      return {
        ...rendered,
        ignoreMutation: (mutation) =>
          (mutation.type !== 'selection' && toolbar.contains(mutation.target)) ||
          (rendered.ignoreMutation?.(mutation) ?? false),
        destroy() {
          for (const animation of running) animation.stop();
          document.removeEventListener('pointerdown', outside);
          rendered.destroy?.();
        },
      };
    },
  },
};

function actionButton(name: string, path: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'description-code-action';
  button.setAttribute('aria-label', name);
  button.title = name;
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line.setAttribute('d', path);
  icon.append(line);
  button.append(icon);
  button.addEventListener('pointerdown', (event) => event.preventDefault());
  return button;
}

export const syntaxHighlighting = SyntaxHighlightingExtension({
  createHighlighter: () =>
    import('./codeHighlighter').then((module) => module.createCodeHighlighter()),
});
