import { fireEvent, render, screen } from '@testing-library/react';
import type { Tag } from '@throw/shared';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ColorTagPicker } from './ColorTagPicker';

const tag = (id: string, name: string, parentId: string | null, color: Tag['color']): Tag => ({
  id,
  workspaceId: 'workspace',
  projectId: 'project',
  name,
  parentId,
  icon: null,
  color,
});
const tags = [
  tag('product', 'Product', null, 'teal'),
  tag('mobile', 'Mobile', 'product', null),
  tag('research', 'Research', null, 'amber'),
  tag('chores', 'Chores', null, null),
];

beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
);
afterEach(() => vi.unstubAllGlobals());

function Harness({ onChange }: { onChange: (id: string | null) => void }) {
  const [primary, setPrimary] = useState<string | null>(null);
  return (
    <ColorTagPicker
      tags={tags}
      primaryTagId={primary}
      onChange={(id) => {
        setPrimary(id);
        onChange(id);
      }}
    />
  );
}

it('offers only colors a tag holds, and opens a picked tag’s children', async () => {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  const swatches = screen.getAllByRole('button').flatMap((button) => {
    const name = button.getAttribute('aria-label') ?? '';
    return name.includes(':') ? [name] : [];
  });
  // In palette order, as the project color picker lists them.
  expect(swatches).toEqual(['Amber: Research', 'Teal: Product']);
  expect(screen.getByRole('button', { name: 'No color tag' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Teal: Product' }));
  expect(onChange).toHaveBeenLastCalledWith('product');
  fireEvent.click(await screen.findByRole('button', { name: 'Product / Mobile' }));
  expect(onChange).toHaveBeenLastCalledWith('mobile');
  fireEvent.click(screen.getByRole('button', { name: 'Back from Product' }));
  const swatch = await screen.findByRole('button', { name: 'Teal: Product' });
  expect(swatch).toHaveAttribute('aria-pressed', 'true');
  // Focus follows into the new view, onto what is picked there.
  expect(swatch).toHaveFocus();
  // Picking the primary's root again only opens it, keeping the more specific primary.
  onChange.mockClear();
  fireEvent.click(swatch);
  expect(await screen.findByRole('button', { name: 'Back from Product' })).toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});

it('reaches uncolored tags one step away and clears the primary', async () => {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Tags without a color' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Chores' }));
  expect(onChange).toHaveBeenLastCalledWith('chores');
  fireEvent.click(screen.getByRole('button', { name: 'Back to colors' }));
  fireEvent.click(await screen.findByRole('button', { name: 'No color tag' }));
  expect(onChange).toHaveBeenLastCalledWith(null);
});
