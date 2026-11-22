import { fireEvent, render, screen } from '@testing-library/react';
import type { Tag } from '@throw/shared';
import { expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({ createTag: vi.fn(), updateTag: vi.fn() }));
vi.mock('@/lib/tags', () => actions);

import { TagEditor } from './TagForm';

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
    <TagEditor
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
  expect(screen.queryByRole('group', { name: 'Color' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Save tag' }));
  expect(actions.updateTag).toHaveBeenCalledWith('root', {
    name: 'Product',
    parentId: 'other',
    color: null,
    icon: null,
  });
});

it('creates a new tag with its starting color, and hands its id to whoever asked for it', () => {
  actions.createTag.mockReturnValue('made');
  const onCreated = vi.fn();
  const { unmount } = render(
    <TagEditor
      projectId="project"
      tags={[root]}
      initial={{ parentId: null, color: 'red' }}
      onDone={() => {}}
      onCreated={onCreated}
    />,
  );
  expect(screen.getByRole('button', { name: 'Red' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Ops' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save tag' }));
  expect(actions.createTag).toHaveBeenLastCalledWith('project', {
    name: 'Ops',
    parentId: null,
    color: 'red',
    icon: null,
  });
  expect(onCreated).toHaveBeenCalledWith('made');
  unmount();
  // The tag manager asks for nothing back, and still creates the tag.
  actions.createTag.mockClear();
  render(
    <TagEditor projectId="project" tags={[root]} initial={{ parentId: null }} onDone={() => {}} />,
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Ops' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save tag' }));
  expect(actions.createTag).toHaveBeenCalledOnce();
});

it('clears a tag’s color and icon from the empty choices', () => {
  render(
    <TagEditor
      projectId="project"
      tags={[root]}
      initial={{ tag: root, parentId: null }}
      onDone={() => {}}
    />,
  );
  const noColor = screen.getByRole('button', { name: 'No color' });
  const noIcon = screen.getByRole('button', { name: 'No icon' });
  expect(noColor).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(noColor);
  fireEvent.click(noIcon);
  expect(noColor).toHaveAttribute('aria-pressed', 'true');
  expect(noIcon).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Save tag' }));
  expect(actions.updateTag).toHaveBeenCalledWith(
    'root',
    expect.objectContaining({ color: null, icon: null }),
  );
});
