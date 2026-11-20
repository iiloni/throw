import { describe, expect, test } from 'vitest';
import { blocksToMarkdown, markdownToBlocks } from './markdown';

describe('MCP Markdown', () => {
  test('round-trips headings, ordinary and nested lists, links, emphasis and code', () => {
    const markdown = [
      '## Ship the queue',
      '',
      'A **bold** and *italic* [PR](https://example.com/pr/7) with `git status`.',
      '',
      '3. First',
      '   - Nested',
      '4. Second',
      '',
      '```ts',
      'const ready = true;',
      '```',
    ].join('\n');
    const blocks = markdownToBlocks(markdown);
    expect(blocks.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'numberedListItem',
      'numberedListItem',
      'codeBlock',
    ]);
    expect(blocks[2]).toMatchObject({
      props: { start: 3 },
      children: [{ type: 'bulletListItem' }],
    });
    const restored = blocksToMarkdown(blocks);
    expect(restored.lossy).toBe(false);
    expect(restored.markdown).toContain('https://example.com/pr/7');
    expect(markdownToBlocks(restored.markdown!)).toEqual(blocks);
  });

  test.each([
    '<iframe src="https://example.com"></iframe>',
    '![image](https://example.com/image.png)',
    '[untrusted](javascript:alert%281%29)',
    '[untrusted](file:///tmp/file)',
  ])('rejects unsupported Markdown: %s', (input) => {
    expect(() => markdownToBlocks(input)).toThrow();
  });

  test('resolves reference links and leaves their definitions out of the stored document', () => {
    const document = markdownToBlocks('[Pull request][pr]\n\n[pr]: https://example.com/pull/7');
    expect(document).toHaveLength(1);
    expect(blocksToMarkdown(document).markdown).toContain(
      '[Pull request](https://example.com/pull/7)',
    );
  });

  test('flags lossy legacy text and omits unsafe link targets while keeping their labels', () => {
    expect(
      blocksToMarkdown([
        { type: 'checkListItem', props: { checked: true }, content: 'Check release' },
        {
          type: 'paragraph',
          content: [
            {
              type: 'link',
              href: 'javascript:alert(1)',
              content: [{ type: 'text', text: 'label' }],
            },
          ],
        },
        {
          type: 'table',
          content: { rows: [{ cells: [[{ type: 'text', text: 'Column A' }], 'Column B'] }] },
        },
      ]),
    ).toEqual({
      lossy: true,
      markdown: expect.stringMatching(/Check release[\s\S]*label[\s\S]*Column A[\s\S]*Column B/),
    });
  });

  test('keeps valid Unicode and rejects an isolated surrogate', () => {
    expect(blocksToMarkdown(markdownToBlocks('Ready 🚀')).markdown).toBe('Ready 🚀');
    expect(() => markdownToBlocks(`Draft ${String.fromCharCode(0xd800)}`)).toThrow('valid Unicode');
  });

  test('caps Markdown conversion and keeps absent descriptions nullable', () => {
    expect(blocksToMarkdown(null)).toEqual({ markdown: null, lossy: false });
    expect(blocksToMarkdown([{ type: 'paragraph', content: 'x'.repeat(60_000) }])).toEqual({
      markdown: 'x'.repeat(48_000),
      lossy: true,
    });
  });
});
