import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardColumn, CollapseColumnButton } from './BoardColumn';
import { type DragState, drag } from './drag';

function Column({
  collapsed,
  onToggle = () => {},
  children = (revealed: boolean) => (
    <div>
      <p>{revealed ? 'revealed' : 'shown'}</p>
      <CollapseColumnButton name="Review" onCollapse={() => onToggle(true)} />
    </div>
  ),
}: {
  collapsed: boolean;
  onToggle?: (collapsed: boolean) => void;
  children?: (revealed: boolean) => React.ReactNode;
}) {
  return (
    <BoardColumn
      columnId="status-review"
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

afterEach(() => drag.set(null));

describe('a board column', () => {
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
    collapse.focus();
    fireEvent.click(collapse);
    expect(screen.getByRole('button', { name: 'Expand Review column' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Review column' }));
    expect(screen.getByRole('button', { name: 'Collapse Review column' })).toHaveFocus();
  });

  it('lights the strip under a held card and hides the collapse control while one is held', () => {
    const { rerender } = render(<Column collapsed />);
    const held: DragState = {
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
    act(() => drag.set(held));
    expect(screen.getByRole('button', { name: 'Expand Review column' })).toHaveAttribute(
      'data-over',
      '',
    );
    rerender(<Column collapsed={false} />);
    expect(screen.queryByRole('button', { name: 'Collapse Review column' })).toBeNull();
  });
});
