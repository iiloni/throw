import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Color } from '@throw/shared';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardColumn, ColumnHeader } from './BoardColumn';
import { type DragState, drag } from './drag';

function Column({
  collapsed,
  color,
  onToggle = () => {},
  children = (revealed: boolean) => (
    <div>
      <p>{revealed ? 'revealed' : 'shown'}</p>
      <ColumnHeader name="Review" count={3} onCollapse={() => onToggle(true)} />
    </div>
  ),
}: {
  collapsed: boolean;
  color?: Color | null;
  onToggle?: (collapsed: boolean) => void;
  children?: (revealed: boolean) => React.ReactNode;
}) {
  return (
    <BoardColumn
      columnId="status-review"
      color={color}
      name="Review"
      category="active"
      count={3}
      collapsed={collapsed}
      onToggle={onToggle}
      index={1}
      className="grow"
    >
      {children}
    </BoardColumn>
  );
}

const heldCard: DragState = {
  ids: ['task'],
  width: 280,
  height: 80,
  grab: { x: 20, y: 20 },
  origin: 'active',
  priority: 3,
  target: { kind: 'status', statusId: 'status-review' },
  rail: null,
  phase: 'dragging',
  swallowed: false,
  touch: false,
  over: false,
  page: 0,
  moved: true,
};

afterEach(() => drag.set(null));

describe('a board column', () => {
  it('keeps the status color on the shared surface through folding and clearing', () => {
    const { container, rerender } = render(<Column collapsed={false} color="mint" />);
    const surface = container.querySelector('[data-column="status-review"]');
    expect(surface).toHaveAttribute('data-column-color', 'mint');
    const stripe = surface?.querySelector('[data-column-stripe]');
    expect(stripe).toBeInTheDocument();
    rerender(<Column collapsed color="mint" />);
    expect(surface?.querySelector('[data-column-stripe]')).toBe(stripe);
    rerender(<Column collapsed color={null} />);
    expect(surface).not.toHaveAttribute('data-column-color');
    expect(stripe).not.toBeInTheDocument();
  });

  it('folds to a strip that names the column, counts its cards and opens it', () => {
    const onToggle = vi.fn();
    render(<Column collapsed onToggle={onToggle} />);
    const strip = screen.getByRole('button', { name: 'Expand Review column' });
    expect(strip).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('region', { name: 'Review' })).toHaveTextContent('Review3');
    expect(screen.queryByText('shown')).toBeNull();
    fireEvent.click(strip);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('is the column’s status dropzone while folded, and only then', () => {
    const { rerender } = render(<Column collapsed />);
    const strip = screen.getByRole('button', { name: 'Expand Review column' });
    expect(strip).toHaveAttribute('data-drop-status', 'status-review');
    expect(strip).toHaveAttribute('data-status-home', 'status-review');
    rerender(<Column collapsed={false} />);
    expect(document.querySelector('[data-drop-status]')).toBeNull();
  });

  it('marks content shown by opening as revealed, so its cards skip their entry', () => {
    const { rerender } = render(<Column collapsed={false} />);
    expect(screen.getByText('shown')).toBeInTheDocument();
    rerender(<Column collapsed />);
    rerender(<Column collapsed={false} />);
    expect(screen.getByText('revealed')).toBeInTheDocument();
  });

  it('hands focus to the control that takes the place of the one used', () => {
    function Stateful() {
      const [collapsed, setCollapsed] = React.useState(false);
      return <Column collapsed={collapsed} onToggle={setCollapsed} />;
    }
    render(<Stateful />);
    const collapse = screen.getByRole('button', { name: 'Collapse Review column' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    // The header is the control, as on Catch's deck.
    expect(collapse.closest('h2')).toHaveTextContent('Review3');
    collapse.focus();
    fireEvent.click(collapse);
    expect(screen.getByRole('button', { name: 'Expand Review column' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Review column' }));
    expect(screen.getByRole('button', { name: 'Collapse Review column' })).toHaveFocus();
  });

  it('lights the strip under a held card, and keeps the open column’s header while one is held', () => {
    const { rerender } = render(<Column collapsed />);
    act(() => drag.set(heldCard));
    expect(screen.getByRole('button', { name: 'Expand Review column' })).toHaveAttribute(
      'data-over',
      '',
    );
    rerender(<Column collapsed={false} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Review3');
  });

  it('offers its actions on a right click of the header or the strip', async () => {
    const onToggle = vi.fn();
    const { rerender } = render(<Column collapsed={false} onToggle={onToggle} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Collapse Review column' }));
    expect(await screen.findByRole('menu', { name: 'Review column actions' })).toBeVisible();
    // Outside the app's shell there is no project settings to edit the status in.
    expect(screen.queryByRole('menuitem', { name: 'Edit status…' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Collapse column' }));
    expect(onToggle).toHaveBeenCalledWith(true);

    rerender(<Column collapsed onToggle={onToggle} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Expand Review column' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Expand column' }));
    expect(onToggle).toHaveBeenLastCalledWith(false);
  });

  it('keeps its menu shut while a card is held', () => {
    render(<Column collapsed={false} />);
    act(() => drag.set(heldCard));
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Collapse Review column' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
