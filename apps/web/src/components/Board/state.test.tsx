import { act, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockBoards } from './mockData';
import {
  board,
  current,
  foldingColumnOf,
  initialBoard,
  openSubtask,
  setSubtasksAsCards,
  update,
  useCollapsedColumns,
} from './state';

describe('subtasks as cards', () => {
  beforeEach(() => {
    localStorage.clear();
    board.set(initialBoard());
  });

  it('keeps the choice on the device for the next board', () => {
    localStorage.setItem('throw-board-settings', JSON.stringify({ zoneLabels: true }));
    setSubtasksAsCards(true);
    expect(board.get().subtasksAsCards).toBe(true);
    expect(JSON.parse(localStorage.getItem('throw-board-settings') ?? '{}')).toMatchObject({
      zoneLabels: true,
      subtasksAsCards: true,
    });
    expect(initialBoard().subtasksAsCards).toBe(true);
    setSubtasksAsCards(false);
    expect(initialBoard().subtasksAsCards).toBe(false);
  });

  it('starts off when nothing or something unreadable is stored', () => {
    expect(initialBoard().subtasksAsCards).toBe(false);
    localStorage.setItem('throw-board-settings', '{');
    expect(initialBoard().subtasksAsCards).toBe(false);
  });
});

describe('folded columns', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    board.set(initialBoard(mockBoards()));
  });

  /** A top-level card in an active column of the board shown, and that column. */
  function activeCard() {
    const { project, tasks } = current();
    const task = tasks.find(
      (item) =>
        item.parentId === null &&
        project.statuses.find((status) => status.id === item.statusId)?.category === 'active',
    )!;
    return { project, task, column: foldingColumnOf(project, task)! };
  }

  function Folded({ columnId }: { columnId: string }) {
    const { isCollapsed } = useCollapsedColumns(current().project);
    return <p>{isCollapsed(columnId) ? 'folded' : 'open'}</p>;
  }

  it('keeps a project’s folded columns under that project, on the device', () => {
    const { project, column } = activeCard();
    const { result } = renderHook(() => useCollapsedColumns(project));
    act(() => result.current.setCollapsed(column, true));
    expect(result.current.isCollapsed(column)).toBe(true);
    expect(JSON.parse(localStorage.getItem(`throw-board-collapsed:${project.id}`)!)).toEqual([
      column,
    ]);
    const other = renderHook(() => useCollapsedColumns({ ...project, id: 'another' }));
    expect(other.result.current.isCollapsed(column)).toBe(false);
  });

  it('opens the folded column of a task opened on a desktop', () => {
    const { task, column } = activeCard();
    render(<Folded columnId={column} />);
    const { result } = renderHook(() => useCollapsedColumns(current().project));
    act(() => result.current.setCollapsed(column, true));
    expect(screen.getByText('folded')).toBeInTheDocument();
    act(() => update({ openTaskId: task.id }));
    expect(screen.getByText('open')).toBeInTheDocument();
  });

  it('leaves the desktop’s folded columns alone on a phone', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }));
    const { task, column } = activeCard();
    render(<Folded columnId={column} />);
    const { result } = renderHook(() => useCollapsedColumns(current().project));
    act(() => result.current.setCollapsed(column, true));
    act(() => update({ openTaskId: task.id }));
    expect(screen.getByText('folded')).toBeInTheDocument();
  });

  it('keeps one flag per category on the workspace board, Cancelled folded at first', () => {
    const workspace = { ...current().project, members: [] };
    const { result } = renderHook(() => useCollapsedColumns(workspace));
    expect(result.current.isCollapsed('category:cancelled')).toBe(true);
    expect(result.current.isCollapsed('category:active')).toBe(false);
    act(() => result.current.setCollapsed('category:active', true));
    expect(result.current.isCollapsed('category:active')).toBe(true);
    expect(JSON.parse(localStorage.getItem('throw-workspace-board-folded')!)).toMatchObject({
      active: true,
      cancelled: true,
    });
  });
});

describe('task trail', () => {
  beforeEach(() => {
    localStorage.clear();
    board.set(initialBoard(mockBoards()));
  });

  it('unwinds instead of stacking a duplicate when following a relation back into the trail', () => {
    const [a, b, c] = current().tasks;
    update({ openTaskId: a!.id });
    openSubtask(b!.id);
    openSubtask(c!.id);
    expect(board.get().taskTrail).toEqual([a!.id, b!.id]);
    expect(board.get().openTaskId).toBe(c!.id);

    // Following a link back to A unwinds B and C rather than pushing C onto [A, B] with A open.
    openSubtask(a!.id);
    expect(board.get().openTaskId).toBe(a!.id);
    expect(board.get().taskTrail).toEqual([]);
  });
});
