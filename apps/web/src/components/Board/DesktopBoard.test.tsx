import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenTaskPane, seamOf } from './DesktopBoard';
import { mockBoards } from './mockData';
import { board, current, initialBoard, setTaskPaneWidth, update } from './state';

const HANDLE_WIDTH = 24;
const PANE_MARGIN = 24;

describe('OpenTaskPane', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    board.set(initialBoard(mockBoards()));
  });

  it('keeps padding and minimum target width inside the clipping frame so open and close never squish or stall on padding', () => {
    const task = current().tasks[0]!;
    act(() => {
      setTaskPaneWidth(700);
      update({ openTaskId: task.id });
    });
    render(<OpenTaskPane frameWidth={1440} />);

    const frame = document.querySelector<HTMLElement>('[data-task-pane-frame]');
    expect(frame).toBeInTheDocument();
    // Outer animated frame clips without horizontal padding, so width: 0 reaches 0px cleanly.
    expect(frame).toHaveClass('overflow-hidden', 'shrink-0');
    expect(frame?.className).not.toMatch(/\b(p|px|pl|pr)-/);

    const inner = frame?.firstElementChild as HTMLElement;
    expect(inner).toHaveStyle({ minWidth: `${700 + HANDLE_WIDTH + PANE_MARGIN}px` });
    expect(inner).toHaveClass('pr-6');

    const handle = screen.getByRole('separator', { name: 'Resize task' });
    expect(handle).toHaveAttribute('aria-valuenow', '700');
    expect(screen.getByRole('region', { name: 'Task' })).toBeInTheDocument();

    // Keyboard resize updates the inner frame's minimum width to match the new pane width.
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(handle).toHaveAttribute('aria-valuenow', '732');
    expect(inner).toHaveStyle({ minWidth: `${732 + HANDLE_WIDTH + PANE_MARGIN}px` });
  });

  it('marks the leaving frame inert on close and respects reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const task = current().tasks[0]!;
    act(() => update({ openTaskId: task.id }));
    render(<OpenTaskPane frameWidth={1440} />);
    expect(document.querySelector('[data-task-pane-frame]')).toBeInTheDocument();

    act(() => update({ openTaskId: null }));
    const leaving = document.querySelector<HTMLElement>('[data-task-pane-frame]');
    // With reduced motion the exit transition has duration 0; if still present before unmount, it is inert.
    if (leaving) expect(leaving).toHaveAttribute('inert');
  });
});

describe('seamOf', () => {
  beforeEach(() => board.set(initialBoard(mockBoards())));

  it('opens the seam with the task pane and shuts it as the task closes', () => {
    expect(seamOf(board.get())).toBe('shut');
    act(() => update({ openTaskId: current().tasks[0]!.id }));
    expect(seamOf(board.get())).toBe('open');
    act(() => update({ openTaskId: null }));
    expect(seamOf(board.get())).toBe('shut');
  });

  it('stays shut for a task the board does not hold', () => {
    act(() => update({ openTaskId: 'gone' }));
    expect(seamOf(board.get())).toBe('shut');
  });
});
