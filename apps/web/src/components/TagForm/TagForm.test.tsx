import { fireEvent, render, screen } from '@testing-library/react';
import type { Tag } from '@throw/shared';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

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
beforeEach(() => {
  // A phone: the parent list opens in place under its field.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

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
  fireEvent.click(screen.getByRole('button', { name: 'Parent tag Top level' }));
  expect(
    screen.getAllByRole('option').map((option) => option.querySelector('.truncate')?.textContent),
  ).toEqual(['Top level', 'Research']);
  fireEvent.click(screen.getByRole('option', { name: 'Research' }));
  expect(screen.getByRole('button', { name: 'Parent tag Research' })).toBeInTheDocument();
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

it('finds a nested parent by its path and names where it sits', () => {
  const child = { ...root, id: 'child', name: 'Mobile', parentId: root.id, color: null };
  render(
    <TagEditor
      projectId="project"
      tags={[root, child]}
      initial={{ parentId: null }}
      onDone={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Parent tag Top level' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Search tags' }), {
    target: { value: 'product / mo' },
  });
  const mobile = screen.getByRole('option', { name: /^Mobile/ });
  expect(mobile).toHaveTextContent('Product');
  fireEvent.click(mobile);
  expect(screen.getByRole('button', { name: 'Parent tag Mobile' })).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Color' })).toBeNull();
});

it('marks each taken color with its tag’s icon and says which tag holds it', () => {
  const other = { ...root, id: 'other', name: 'Research', color: 'red' as const, icon: null };
  render(
    <TagEditor
      projectId="project"
      tags={[root, other]}
      initial={{ tag: root, parentId: null }}
      onDone={() => {}}
    />,
  );
  // The tag's own color stays free to keep.
  const teal = screen.getByRole('button', { name: 'Teal' });
  expect(teal).not.toHaveAttribute('aria-disabled');
  expect(teal.querySelector('svg')).toBeNull();
  const red = screen.getByRole('button', { name: 'Red' });
  expect(red).toHaveAttribute('aria-disabled', 'true');
  expect(red).toHaveAccessibleDescription('Red: already used by Research');
  expect(red.querySelector('svg')).not.toBeNull();
  fireEvent.click(red);
  expect(red).toHaveAttribute('aria-pressed', 'false');
});
