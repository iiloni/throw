import { act, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockBoards } from './mockData';
import {
  board,
  clampTaskPaneWidth,
  current,
  DEFAULT_TASK_PANE_WIDTH,
  foldingColumnOf,
  initialBoard,
  openSubtask,
  setSubtasksAsCards,
  setTaskPaneWidth,
  update,
  useCollapsedColumns,
  useTaskPaneWidth,
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

describe('task split-pane width', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to 440 when nothing or invalid data is stored', () => {
    const { result } = renderHook(() => useTaskPaneWidth());
    expect(result.current[0]).toBe(DEFAULT_TASK_PANE_WIDTH);

    for (const bad of ['{', '0', '-120', '"wide"', 'null']) {
      localStorage.setItem('throw-task-pane-width', bad);
      const next = renderHook(() => useTaskPaneWidth());
      expect(next.result.current[0]).toBe(DEFAULT_TASK_PANE_WIDTH);
    }
  });

  it('persists rounded positive widths in localStorage and shares them across readers', () => {
    const first = renderHook(() => useTaskPaneWidth());
    const second = renderHook(() => useTaskPaneWidth());

    act(() => setTaskPaneWidth(612.4));
    expect(first.result.current[0]).toBe(612);
    expect(second.result.current[0]).toBe(612);
    expect(localStorage.getItem('throw-task-pane-width')).toBe('612');

    // Non-positive or non-finite values are ignored without clobbering the stored width.
    act(() => {
      setTaskPaneWidth(0);
      setTaskPaneWidth(-50);
      setTaskPaneWidth(Number.NaN);
      setTaskPaneWidth(Number.POSITIVE_INFINITY);
    });
    expect(first.result.current[0]).toBe(612);
    expect(localStorage.getItem('throw-task-pane-width')).toBe('612');
  });

  it('clamps to the frame bounds without clobbering stored widths on narrow or unmeasured frames', () => {
    act(() => setTaskPaneWidth(680));
    const { result } = renderHook(() => useTaskPaneWidth());

    // Initial mount before ResizeObserver measures the frame: keep the stored width.
    expect(clampTaskPaneWidth(result.current[0], 0, 340)).toBe(680);
    // Transient narrow viewport clamps rendered width to 62% of frameWidth.
    expect(clampTaskPaneWidth(result.current[0], 900, 340)).toBeCloseTo(558, 5);
    // Very narrow viewport clamps to PANE_MIN.
    expect(clampTaskPaneWidth(result.current[0], 400, 340)).toBe(340);
    // Stored width is untouched, so widening restores the preference.
    expect(localStorage.getItem('throw-task-pane-width')).toBe('680');
    expect(clampTaskPaneWidth(result.current[0], 1440, 340)).toBe(680);
    // Sub-minimum stored values still render at least PANE_MIN.
    expect(clampTaskPaneWidth(200, 0, 340)).toBe(340);
    expect(clampTaskPaneWidth(200, 1440, 340)).toBe(340);
  });
});
