import { fireEvent, render, screen } from '@testing-library/react';
import type { Tag } from '@throw/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TagTree } from './TagTree';
import { COLLAPSED_TAGS_KEY, COLLAPSED_TAGS_LIMIT } from './useCollapsedTags';

const tag = (id: string, name: string, parentId: string | null = null): Tag => ({
  id,
  workspaceId: 'workspace',
  projectId: 'project',
  name,
  parentId,
  icon: null,
  color: parentId ? null : 'teal',
});
const tags = [tag('home', 'Home'), tag('garden', 'Garden', 'home'), tag('work', 'Work')];

const tree = () => (
  <TagTree
    tags={tags}
    renderTag={(_, path) => <button type="button">{path.map((p) => p.name).join(' / ')}</button>}
  />
);
const stored = () => JSON.parse(localStorage.getItem(COLLAPSED_TAGS_KEY) ?? 'null');
// Rows leaving the tree are inert while they animate out, so role queries skip them.
const garden = () => screen.queryByRole('button', { name: 'Home / Garden' });

beforeEach(() => localStorage.removeItem(COLLAPSED_TAGS_KEY));
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

describe('collapsed tag branches', () => {
  it('stay collapsed when the tree closes and opens again', async () => {
    const first = render(tree());
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Home' }));
    expect(stored()).toEqual(['home']);
    first.unmount();

    render(tree());
    expect(screen.getByRole('button', { name: 'Expand Home' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(garden()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Home' }));
    expect(await screen.findByRole('button', { name: 'Home / Garden' })).toBeInTheDocument();
    expect(stored()).toEqual([]);
  });

  it('follow a collapse made in another mounted tree', () => {
    render(
      <>
        {tree()}
        {tree()}
      </>,
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Collapse Home' })[0]!);
    expect(screen.getAllByRole('button', { name: 'Expand Home' })).toHaveLength(2);
  });

  it('open only for a search, which leaves the stored branches alone', async () => {
    render(tree());
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Home' }));
    const find = screen.getByRole('textbox', { name: 'Find tags' });
    fireEvent.change(find, { target: { value: 'home' } });
    expect(await screen.findByRole('button', { name: 'Home / Garden' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse Home' })).toBeDisabled();
    expect(stored()).toEqual(['home']);
    fireEvent.change(find, { target: { value: '' } });
    expect(garden()).toBeNull();
    expect(screen.getByRole('button', { name: 'Expand Home' })).toBeInTheDocument();
    expect(stored()).toEqual(['home']);
  });

  it('keep other projects’ branches', () => {
    localStorage.setItem(COLLAPSED_TAGS_KEY, JSON.stringify(['other-project-tag']));
    render(tree());
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Home' }));
    expect(stored()).toEqual(['other-project-tag', 'home']);
  });

  it('bounds stale IDs by dropping the oldest remembered branch', () => {
    const ids = Array.from({ length: COLLAPSED_TAGS_LIMIT }, (_, i) => `tag-${i}`);
    localStorage.setItem(COLLAPSED_TAGS_KEY, JSON.stringify(ids));
    render(tree());
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Home' }));
    expect(stored()).toEqual([...ids.slice(1), 'home']);
  });

  it('keeps branches usable when the device denies storage', () => {
    const denied = () => {
      throw new DOMException('Storage denied', 'SecurityError');
    };
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(denied);
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(denied);
    try {
      const first = render(tree());
      fireEvent.click(screen.getByRole('button', { name: 'Collapse Home' }));
      first.unmount();
      render(tree());
      expect(screen.getByRole('button', { name: 'Expand Home' })).toBeInTheDocument();
    } finally {
      read.mockRestore();
      write.mockRestore();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Expand Home' }));
    expect(stored()).toEqual([]);
  });

  it('fall back to all open when the stored value is unreadable', () => {
    localStorage.setItem(COLLAPSED_TAGS_KEY, '{not json');
    render(tree());
    expect(screen.getByRole('button', { name: 'Collapse Home' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Home' }));
    expect(stored()).toEqual(['home']);
  });
});
