import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { DescriptionPreview } from './DescriptionPreview';

it('paints text and formatting from a BlockNote draft without loading the editor', () => {
  render(
    <DescriptionPreview
      document={[
        { type: 'paragraph', content: [{ type: 'text', text: 'A draft', styles: { bold: true } }] },
        {
          type: 'bulletListItem',
          content: 'A step',
          children: [{ type: 'paragraph', content: 'Nested detail' }],
        },
      ]}
    />,
  );
  expect(screen.getByText('A draft')).toHaveClass('font-bold');
  expect(screen.getByText('A step')).toBeVisible();
  expect(screen.getByText('Nested detail')).toBeVisible();
});
it('keeps links inert and drops media from the transition preview', () => {
  render(
    <DescriptionPreview
      document={[
        {
          type: 'paragraph',
          content: [{ type: 'link', href: 'javascript:alert(1)', content: [{ text: 'A link' }] }],
        },
        { type: 'image', props: { url: 'https://example.com/file.jpg' } },
      ]}
    />,
  );
  expect(screen.getByText('A link')).toBeVisible();
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
});
