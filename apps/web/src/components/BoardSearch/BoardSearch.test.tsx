import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Project, Status, Task } from '@throw/shared';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectBoardData, secondaryTagsByTask } from '@/components/Board/selection';
import { board, initialBoard, receiveBoard, update } from '@/components/Board/state';
import { BoardSearch, BoardSearchSidebar } from './BoardSearch';

const project: Project = {
  id: 'project',
  workspaceId: 'workspace',
  name: 'Board',
  key: 'BRD',
  color: 'teal',
  icon: null,
  position: 'a0',
  priorityNames: ['', '', '', '', ''],
  deletedAt: null,
};
const statuses: Status[] = [
  {
    id: 'build',
    category: 'active',
    name: 'Build',
    projectId: project.id,
    workspaceId: project.workspaceId,
    position: 'a0',
    isDefault: true,
  },
];
let number = 0;
const task = (title: string, size: Task['size']): Task => ({
  id: title,
  projectId: project.id,
  workspaceId: project.workspaceId,
  number: ++number,
  title,
  description: null,
  descriptionVersion: null,
  statusId: 'build',
  priority: 3,
  size,
  position: 'a0',
  parentId: null,
  primaryTagId: null,
  closedAt: null,
  deletedAt: null,
  createdAt: '2026-10-14T12:00:00Z',
});

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});

beforeEach(() => {
  board.set(initialBoard());
  receiveBoard(
    projectBoardData(
      project,
      statuses,
      [task('Weed beds', 2), task('Paint fence', 4)],
      [],
      secondaryTagsByTask([]),
    ),
    { rename: () => {}, place: () => true, send: () => true },
  );
  act(() => update({ searching: true }));
});

const field = () => screen.getByRole('searchbox', { name: 'Search tasks' });

describe('the board’s search bar', () => {
  it('narrows the board as words are typed and says how many cards are left', () => {
    render(<BoardSearch />);
    fireEvent.change(field(), { target: { value: 'weed' } });
    expect(board.get().filter.query).toBe('weed');
    expect(field()).toHaveAccessibleDescription('1 matching. Enter opens BRD-1');
  });

  it('opens the best match on Enter', () => {
    render(<BoardSearch />);
    fireEvent.change(field(), { target: { value: 'fence' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(board.get().openTaskId).toBe('Paint fence');
  });

  it('steps back on Escape: the panel, then what narrows the board, then the bar', () => {
    render(<BoardSearch />);
    const trigger = screen.getByRole('button', { name: 'Filter and sort' });
    fireEvent.click(trigger);
    expect(screen.getByRole('region', { name: 'Filters and sort' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Size' }));
    fireEvent.click(screen.getByRole('button', { name: /^Size S,/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Sort' }));
    fireEvent.click(screen.getByRole('button', { name: 'Size' }));
    fireEvent.click(screen.getByRole('button', { name: 'Largest' }));
    expect(board.get()).toMatchObject({ filter: { sizes: [2] }, sort: 'size-desc' });
    expect(screen.getByRole('group', { name: 'Active filters' })).toHaveTextContent(
      /Largest first/,
    );

    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    expect(board.get().filter.sizes).toEqual([2]);
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(board.get()).toMatchObject({ filter: { sizes: [] }, sort: 'priority', searching: true });
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(board.get().searching).toBe(false);
  });

  it('feathers the top and bottom edges of the docked sidebar scroller when overflowing', () => {
    const { container } = render(<BoardSearchSidebar />);
    const area = container.querySelector<HTMLElement>('[data-slot="scroll-area"][data-edges]');
    const viewport = area?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    expect(area).toBeInTheDocument();
    expect(viewport).toBeInTheDocument();
    if (!area || !viewport) return;

    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 200 });
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 500 });
    viewport.scrollTop = 0;
    fireEvent.scroll(viewport);
    expect(area).not.toHaveAttribute('data-more-top');
    expect(area).toHaveAttribute('data-more-bottom');

    viewport.scrollTop = 100;
    fireEvent.scroll(viewport);
    expect(area).toHaveAttribute('data-more-top');
    expect(area).toHaveAttribute('data-more-bottom');

    viewport.scrollTop = 300;
    fireEvent.scroll(viewport);
    expect(area).toHaveAttribute('data-more-top');
    expect(area).not.toHaveAttribute('data-more-bottom');
  });
});
