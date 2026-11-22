import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { describe, expect, it } from 'vitest';
import { codeBlock } from './codeBlock';
import { createCodeHighlighter } from './codeHighlighter';
import {
  CODE_LANGUAGES,
  codeLanguageFileName,
  codeLanguageIcon,
  codeLanguageId,
  codeLanguageName,
} from './codeLanguages';
import { codeSnippetText } from './codeSnippet';

describe('code block languages', () => {
  it('resolves older aliases while leaving unknown names readable', () => {
    expect(codeLanguageId(' JS ')).toBe('javascript');
    expect(codeLanguageId('none')).toBe('text');
    expect(codeLanguageId('novel-lang')).toBeUndefined();
    expect(codeLanguageName('novel-lang')).toBe('novel-lang');
    expect(codeLanguageName('')).toBe('Plain text');
    expect(codeLanguageIcon('')).not.toBe(codeLanguageIcon('novel-lang'));
  });

  it('uses safe filenames for export and an icon for each bundled language', () => {
    expect(codeLanguageFileName('py')).toBe('snippet.py');
    expect(codeLanguageFileName('dockerfile')).toBe('Dockerfile');
    expect(codeLanguageFileName('../../unsafe')).toBe('snippet.txt');
    for (const language of Object.keys(CODE_LANGUAGES)) {
      expect(codeLanguageIcon(language), language).toMatch(/\.svg(?:\?|$)/);
    }
  });

  it('colors known code with theme tokens', async () => {
    const highlighter = await createCodeHighlighter();
    try {
      await highlighter.loadLanguage('javascript');
      const tokens = highlighter.codeToTokens('const answer = 42;', {
        lang: 'javascript',
        theme: 'throw',
      });
      expect(tokens.tokens.flat()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ content: 'const', color: 'var(--code-token-keyword)' }),
        ]),
      );
    } finally {
      highlighter.dispose();
    }
  });
});

it('exports the original source from both string and BlockNote content', () => {
  const source = 'if (x < y) {\n\treturn x;\n}';
  expect(codeSnippetText(source)).toBe(source);
  expect(
    codeSnippetText([
      { type: 'text', text: 'if (x < y) {\n', styles: {} },
      { type: 'text', text: '\treturn x;\n}', styles: {} },
    ]),
  ).toBe(source);
});

it('keeps explicit plain text distinct from an unlabelled Markdown fence', () => {
  const editor = BlockNoteEditor.create({
    schema: BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, codeBlock } }),
  });
  const blocks = editor.tryParseMarkdownToBlocks(
    '```\nconst answer = 42;\n```\n\n```text\nconst answer = 42;\n```',
  );
  expect(blocks).toMatchObject([
    { type: 'codeBlock', props: { language: '' } },
    { type: 'codeBlock', props: { language: 'text' } },
  ]);
});
