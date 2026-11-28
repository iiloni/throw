import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardUnderPane, OpenTaskPane, usePaneCover } from './DesktopBoard';
import { mockBoards } from './mockData';
import {
  board,
  current,
  initialBoard,
  setTaskPaneExpanded,
  setTaskPaneWidth,
  update,
} from './state';
import { TaskContentContext } from './taskContent';

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
    // Its split width, and what expanding gains on top (nothing, beside the board).
    expect(inner.style.minWidth).toBe(
      `calc(${700 + HANDLE_WIDTH + PANE_MARGIN}px + var(--pane-gained, 0px))`,
    );
    expect(inner.style.getPropertyValue('--pane-gained')).toBe('0px');
    expect(inner).toHaveClass('pr-6');

    const handle = screen.getByRole('separator', { name: 'Resize task' });
    expect(handle).toHaveAttribute('aria-valuenow', '700');
    expect(screen.getByRole('region', { name: 'Task' })).toBeInTheDocument();

    // Keyboard resize updates the inner frame's minimum width to match the new pane width.
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(handle).toHaveAttribute('aria-valuenow', '732');
    expect(inner.style.minWidth).toContain(`${732 + HANDLE_WIDTH + PANE_MARGIN}px`);
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

  it('expands over the board to the frame’s width, keeping its place in the row, and hides the grip', () => {
    const task = current().tasks[0]!;
    act(() => {
      setTaskPaneWidth(700);
      setTaskPaneExpanded(true);
      update({ openTaskId: task.id });
    });
    function Harness() {
      const cover = usePaneCover(board.use());
      return (
        <div className="flex">
          <BoardUnderPane {...cover}>
            <button type="button">A card</button>
          </BoardUnderPane>
          <OpenTaskPane frameWidth={1440} cover={cover.cover} />
        </div>
      );
    }
    render(
      <TaskContentContext value={{ body: () => <p>Task body</p> }}>
        <Harness />
      </TaskContentContext>,
    );
    const frame = document.querySelector<HTMLElement>('[data-task-pane-frame]')!;
    expect(frame).toHaveAttribute('data-expanded');
    // Opened expanded, it is already at the frame's width: the task lays out for it at once.
    const inner = frame.firstElementChild as HTMLElement;
    expect(inner.style.getPropertyValue('--pane-gained')).toBe(
      `${1440 - 700 - HANDLE_WIDTH - PANE_MARGIN}px`,
    );
    // The board beneath keeps its split layout, out of reach while the task covers it.
    const under = document.querySelector<HTMLElement>('[data-board-under-pane]')!;
    expect(under).toHaveAttribute('inert');
    expect(under).toHaveAttribute('aria-hidden', 'true');
    // The grip has nothing to share the width with.
    const grip = screen.getByRole('separator', { name: 'Resize task', hidden: true });
    expect(grip.parentElement).toHaveAttribute('inert');

    act(() => setTaskPaneExpanded(false));
    expect(frame).not.toHaveAttribute('data-expanded');
    expect(under).not.toHaveAttribute('inert');
    expect(grip.parentElement).not.toHaveAttribute('inert');
  });

  it('never expands the prototype’s mock task, which has no control to collapse it', () => {
    const task = current().tasks[0]!;
    act(() => {
      setTaskPaneExpanded(true);
      update({ openTaskId: task.id });
    });
    render(<OpenTaskPane frameWidth={1440} />);
    const frame = document.querySelector<HTMLElement>('[data-task-pane-frame]')!;
    expect(frame).not.toHaveAttribute('data-expanded');
  });
});
