import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockBoards } from './mockData';
import type { Project, Task } from './model';
import {
  moveTargets,
  SelectionControls,
  selectionProject,
  selectionTabs,
  shared,
  trashSelection,
} from './SelectionActions';
import { board, current, initialBoard, update } from './state';
import { TaskCard } from './TaskCard';
import { type SelectionContent, SelectionContentContext } from './taskContent';

function task(id: string, projectId?: string): Task {
  return {
    id,
    number: 1,
    title: id,
    statusId: 'status',
    priority: 3,
    size: null,
    position: 'a0',
    primaryTagId: null,
    secondaryTagIds: [],
    parentId: null,
    closedAt: null,
    projectId,
  };
}

function project(id: string, tags: Project['tags'] = []): Project {
  return {
    id,
    key: id.toUpperCase(),
    name: id,
    color: 'blue',
    icon: null,
    statuses: [
      { id: `${id}-backlog`, name: 'Todo', category: 'backlog', isDefault: true },
      { id: `${id}-done`, name: 'Done', category: 'done', isDefault: true },
    ],
    tags,
    priorityNames: [],
  };
}

const tag = { id: 'tag', name: 'Tag', parentId: null, color: 'red' as const };
const kitchen = project('kitchen', [tag]);
const garden = project('garden');
const workspace: Project = { ...project('all'), members: [kitchen, garden] };

beforeEach(() => {
  localStorage.clear();
  board.set(initialBoard(mockBoards()));
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

describe('what a selection can change together', () => {
  const content = { sizes: true };

  it('offers only moving without the boundary’s pickers', () => {
    expect(selectionTabs(kitchen, [task('a')], null)).toEqual(['status']);
  });

  it('offers tags for cards of one project that has tags, and size only where it is kept', () => {
    expect(selectionTabs(kitchen, [task('a'), task('b')], content)).toEqual([
      'status',
      'priority',
      'size',
      'tags',
    ]);
    expect(selectionTabs(garden, [task('a')], { sizes: false })).toEqual(['status', 'priority']);
  });

  it('leaves tags out once a selection spans projects on the workspace board', () => {
    const one = [task('a', 'kitchen'), task('b', 'kitchen')];
    const both = [task('a', 'kitchen'), task('b', 'garden')];
    expect(selectionProject(workspace, one)?.id).toBe('kitchen');
    expect(selectionTabs(workspace, one, content)).toContain('tags');
    expect(selectionProject(workspace, both)).toBeNull();
    expect(selectionTabs(workspace, both, content)).not.toContain('tags');
    // Several projects share no status, so they move by category.
    expect(moveTargets(workspace, both).map((status) => status.id)).toEqual([
      'category:backlog',
      'category:active',
      'category:done',
      'category:cancelled',
    ]);
    expect(moveTargets(workspace, one)).toBe(kitchen.statuses);
  });

  it('reads a value only when every card shares it', () => {
    expect(shared([2, 2, 2])).toBe(2);
    expect(shared([2, 3])).toBeUndefined();
    expect(shared([null, null])).toBeNull();
  });
});

describe('trashing a selection', () => {
  it('hands the boundary every selected card, then lets the selection and its open task go', () => {
    const [first, second] = current().tasks;
    const trash = vi.fn();
    update({ selection: [first!.id, second!.id], openTaskId: first!.id });
    trashSelection({ sizes: true, panel: () => null, trash });
    expect(trash).toHaveBeenCalledWith([first!.id, second!.id]);
    expect(board.get().selection).toEqual([]);
    expect(board.get().openTaskId).toBeNull();
  });

  it('is offered beside the pickers only where the boundary can trash', () => {
    const [first] = current().tasks;
    update({ selection: [first!.id] });
    const content: SelectionContent = { sizes: true, panel: () => null, trash: vi.fn() };
    const controls = (
      <SelectionControls
        tabs={['status', 'priority']}
        tooltips={false}
        onOpen={() => {}}
        controlProps={() => ({})}
      />
    );
    const { rerender } = render(controls);
    expect(screen.queryByRole('button', { name: 'Move to trash' })).toBeNull();
    rerender(
      <SelectionContentContext.Provider value={content}>
        {controls}
      </SelectionContentContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));
    expect(content.trash).toHaveBeenCalledWith([first!.id]);
  });
});

describe('a right click on a card', () => {
  it('selects it and lets it go, in place of the browser’s menu', () => {
    const [first] = current().tasks;
    render(<TaskCard task={first!} />);
    const card = screen.getByRole('article');
    fireEvent.pointerDown(card, { pointerType: 'mouse', button: 2 });
    expect(fireEvent.contextMenu(card)).toBe(false);
    expect(board.get().selection).toEqual([first!.id]);
    fireEvent.pointerDown(card, { pointerType: 'mouse', button: 2 });
    fireEvent.contextMenu(card);
    expect(board.get().selection).toEqual([]);
  });

  it('leaves a held finger’s menu to its long press', () => {
    const [first] = current().tasks;
    render(<TaskCard task={first!} />);
    const card = screen.getByRole('article');
    fireEvent.pointerDown(card, { pointerType: 'touch', button: 0 });
    fireEvent.pointerUp(window);
    fireEvent.contextMenu(card);
    expect(board.get().selection).toEqual([]);
  });
});
