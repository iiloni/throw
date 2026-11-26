import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { haptics } from '@/lib/haptics';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  LONG_PRESS_MS,
} from './context-menu';

vi.mock('@/lib/haptics', () => ({ haptics: { longPress: vi.fn() } }));

function Menu({ onClick = () => {} }: { onClick?: () => void }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button type="button" onClick={onClick}>
          Row
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent aria-label="Row actions">
        <ContextMenuItem>Rename</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

const row = () => screen.getByRole('button', { name: 'Row' });
const touch = { pointerType: 'touch', pointerId: 1, button: 0, clientX: 40, clientY: 40 };

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.mocked(haptics.longPress).mockClear();
});

describe('a context menu', () => {
  it('opens on a right click, felt only from a long press', () => {
    render(<Menu />);
    fireEvent.contextMenu(row(), { clientX: 10, clientY: 10 });
    expect(screen.getByRole('menu', { name: 'Row actions' })).toBeInTheDocument();
    expect(haptics.longPress).not.toHaveBeenCalled();
  });

  it('opens from a long press on a touch screen, felt, without the click its lift sends', () => {
    const onClick = vi.fn();
    render(<Menu onClick={onClick} />);
    // The open menu hides the page behind it from roles, so the row is held on to.
    const held = row();
    expect(held).toHaveClass('select-none');
    fireEvent.pointerDown(held, touch);
    // A finger's tremor, inside the slop, does not cancel it.
    fireEvent.pointerMove(held, { ...touch, clientX: 44, clientY: 37 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS - 1));
    expect(screen.queryByRole('menu')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('menu', { name: 'Row actions' })).toBeInTheDocument();
    expect(haptics.longPress).toHaveBeenCalledTimes(1);

    fireEvent.pointerUp(held, touch);
    fireEvent.click(held);
    expect(onClick).not.toHaveBeenCalled();
    // A click after the lift's, such as Enter's, acts again.
    act(() => vi.advanceTimersByTime(300));
    fireEvent.click(held);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('lets a finger that moves on, lifts early or is a mouse go without a menu', () => {
    const onClick = vi.fn();
    render(<Menu onClick={onClick} />);
    fireEvent.pointerDown(row(), touch);
    fireEvent.pointerMove(row(), { ...touch, clientX: 60 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.pointerDown(row(), touch);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS / 2));
    fireEvent.pointerUp(row(), touch);
    fireEvent.click(row());
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onClick).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(row(), { ...touch, pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(haptics.longPress).not.toHaveBeenCalled();
  });

  it('is felt once when the browser’s own long press opens it first', () => {
    render(<Menu />);
    fireEvent.pointerDown(row(), touch);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS - 100));
    fireEvent.contextMenu(row(), touch);
    expect(screen.getByRole('menu', { name: 'Row actions' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(haptics.longPress).toHaveBeenCalledTimes(1);
  });
});
