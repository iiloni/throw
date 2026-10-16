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
it('keeps primary, ancestor and descendant selections independently usable with full path labels', () => {
  const onPrimaryChange = vi.fn();
  const onSecondaryChange = vi.fn();
  render(
    <TagPicker
      tags={[root, child]}
      primaryTagId={child.id}
      secondaryTagIds={[root.id]}
      onPrimaryChange={onPrimaryChange}
      onSecondaryChange={onSecondaryChange}
    />,
  );
  expect(screen.getByRole('radio', { name: 'Primary: Product / Mobile' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Secondary: Product' })).toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Secondary: Product / Mobile' }));
  expect(onSecondaryChange).toHaveBeenCalledWith(child.id, true);
  expect(onPrimaryChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('radio', { name: /^Primary: Product$/ }));
  expect(onPrimaryChange).toHaveBeenCalledWith(root.id);
  fireEvent.click(screen.getByRole('button', { name: 'Clear primary' }));
  expect(onPrimaryChange).toHaveBeenLastCalledWith(null);
});
it('searches full ancestry and lets users collapse and reopen branches', async () => {
  render(
    <TagPicker
      tags={[root, child]}
      primaryTagId={null}
      secondaryTagIds={[]}
      onPrimaryChange={() => {}}
      onSecondaryChange={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Collapse Product' }));
  // Exiting rows are inert while their height animation finishes.
  expect(screen.queryByRole('radio', { name: 'Primary: Product / Mobile' })).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: 'Find tags' }), {
    target: { value: 'product' },
  });
  expect(
    await screen.findByRole('radio', { name: 'Primary: Product / Mobile' }),
  ).toBeInTheDocument();
  const collapse = screen.getByRole('button', { name: 'Collapse Product' });
  expect(collapse).toBeDisabled();
  expect(collapse).toHaveAttribute('aria-expanded', 'true');
  fireEvent.change(screen.getByRole('textbox', { name: 'Find tags' }), {
    target: { value: '' },
  });
  expect(screen.queryByRole('radio', { name: 'Primary: Product / Mobile' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Expand Product' }));
  expect(
    await screen.findByRole('radio', { name: 'Primary: Product / Mobile' }),
  ).toBeInTheDocument();
});
