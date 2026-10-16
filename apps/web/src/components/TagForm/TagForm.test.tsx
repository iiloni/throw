import { fireEvent, render, screen } from '@testing-library/react';
import type { Tag } from '@throw/shared';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({ createTag: vi.fn(), updateTag: vi.fn() }));
vi.mock('@/lib/tags', () => actions);
vi.mock('@/components/BottomSheet/BottomSheet', () => ({
  BottomSheet: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));

import { TagForm } from './TagForm';

const root: Tag = {
  id: 'root',
  workspaceId: 'workspace',
  projectId: 'project',
  name: 'Product',
  parentId: null,
  color: 'teal',
  icon: 'rocket',
};
it('offers accessible parents outside the branch, and clears root appearance when moving under another tag', () => {
  const child = {
    ...root,
    id: 'child',
    name: 'Mobile',
    parentId: root.id,
    color: null,
    icon: null,
  };
  const other = { ...root, id: 'other', name: 'Research', color: null };
  render(
    <TagForm
      projectId="project"
      tags={[root, child, other]}
      initial={{ tag: root, parentId: null }}
      onDone={() => {}}
    />,
  );
  const parent = screen.getByRole('combobox', { name: 'Parent tag' });
  expect(screen.queryByRole('option', { name: 'Product' })).toBeNull();
  expect(screen.queryByRole('option', { name: 'Product / Mobile' })).toBeNull();
  fireEvent.change(parent, { target: { value: 'other' } });
  expect(screen.queryByRole('group', { name: 'Colour' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Save tag' }));
  expect(actions.updateTag).toHaveBeenCalledWith('root', {
    name: 'Product',
    parentId: 'other',
    color: null,
    icon: null,
  });
});
