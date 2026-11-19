import { fireEvent, render, screen } from '@testing-library/react';
import type { Tag } from '@throw/shared';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TagPicker } from './TagPicker';

const root: Tag = {
  id: 'root',
  workspaceId: 'workspace',
  projectId: 'project',
  name: 'Product',
  parentId: null,
  icon: 'rocket',
  color: 'teal',
};
const child: Tag = {
  ...root,
  id: 'child',
  name: 'Mobile',
  parentId: root.id,
  color: null,
  icon: null,
};
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
it('assigns secondary tags independently of the primary, with full path labels', () => {
  const onChange = vi.fn();
  render(
    <TagPicker
      tags={[root, child]}
      primaryTagId={child.id}
      secondaryTagIds={[root.id]}
      onChange={onChange}
    />,
  );
  expect(screen.getByRole('checkbox', { name: 'Product' })).toBeChecked();
  // The primary is marked, and may be secondary too.
  const primary = screen.getByRole('checkbox', { name: 'Product / Mobile' });
  expect(primary).not.toBeChecked();
  expect(primary.closest('label')).toHaveTextContent('Primary');
  fireEvent.click(primary);
  expect(onChange).toHaveBeenCalledWith(child.id, true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Product' }));
  expect(onChange).toHaveBeenLastCalledWith(root.id, false);
});
it('searches full ancestry and lets users collapse and reopen branches', async () => {
  render(
    <TagPicker tags={[root, child]} primaryTagId={null} secondaryTagIds={[]} onChange={() => {}} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Collapse Product' }));
  // Exiting rows are inert while their height animation finishes.
  expect(screen.queryByRole('checkbox', { name: 'Product / Mobile' })).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: 'Find tags' }), {
    target: { value: 'product' },
  });
  expect(await screen.findByRole('checkbox', { name: 'Product / Mobile' })).toBeInTheDocument();
  const collapse = screen.getByRole('button', { name: 'Collapse Product' });
  expect(collapse).toBeDisabled();
  expect(collapse).toHaveAttribute('aria-expanded', 'true');
  fireEvent.change(screen.getByRole('textbox', { name: 'Find tags' }), {
    target: { value: '' },
  });
  expect(screen.queryByRole('checkbox', { name: 'Product / Mobile' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Expand Product' }));
  expect(await screen.findByRole('checkbox', { name: 'Product / Mobile' })).toBeInTheDocument();
});
