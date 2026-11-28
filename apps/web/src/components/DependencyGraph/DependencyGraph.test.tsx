import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GraphNodeCard } from './GraphNodeCard';
import type { GraphNode } from './graphModel';
import { clampScale, fitView, revealRect, wheelFactor, zoomAround } from './viewport';

const none = { top: 0, right: 0, bottom: 0, left: 0 };

describe('viewport', () => {
  it('fits a large graph inside the space, clear of the insets', () => {
    const view = fitView(
      { width: 2000, height: 500 },
      { width: 1000, height: 800 },
      { ...none, top: 64 },
      0,
    );
    expect(view.scale).toBe(0.5);
    expect(view.x).toBe(0);
    // Centred in the room below the top inset.
    expect(view.y).toBe(64 + (736 - 250) / 2);
  });

  it('shows a small graph at its natural size, in the middle', () => {
    expect(fitView({ width: 100, height: 100 }, { width: 500, height: 300 }, none, 0)).toEqual({
      scale: 1,
      x: 200,
      y: 100,
    });
  });

  it('never fits below the smallest zoom', () => {
    expect(fitView({ width: 100_000, height: 10 }, { width: 500, height: 300 }, none).scale).toBe(
      clampScale(0),
    );
  });

  it('zooms about a point, which stays where it is', () => {
    const view = zoomAround({ x: 10, y: 20, scale: 1 }, 2, { x: 110, y: 120 });
    expect(view).toEqual({ x: -90, y: -80, scale: 2 });
    // The content point under (110, 120) was (100, 100); it is still there.
    expect(view.x + 100 * view.scale).toBe(110);
  });

  it('reveals a node off screen with the least movement, and leaves one in sight alone', () => {
    const view = { x: 0, y: 0, scale: 1 };
    const viewport = { width: 400, height: 300 };
    const inSight = { x: 50, y: 50, width: 100, height: 50 };
    expect(revealRect(view, inSight, viewport, none)).toBe(view);
    const right = revealRect(view, { x: 500, y: 50, width: 100, height: 50 }, viewport, none, 0);
    expect(right).toEqual({ x: -200, y: 0, scale: 1 });
  });

  it('zooms a mouse wheel gently and a trackpad pinch faster per delta', () => {
    expect(wheelFactor({ deltaY: -100, deltaMode: 0, ctrlKey: false })).toBeGreaterThan(1);
    expect(wheelFactor({ deltaY: 100, deltaMode: 0, ctrlKey: false })).toBeLessThan(1);
    expect(wheelFactor({ deltaY: -10, deltaMode: 0, ctrlKey: true })).toBeGreaterThan(
      wheelFactor({ deltaY: -10, deltaMode: 0, ctrlKey: false }),
    );
  });
});

const node: GraphNode = {
  id: 'n',
  identifier: 'APP-3',
  title: 'Ship the release',
  statusName: 'Working',
  category: 'active',
  statusColor: null,
  color: null,
  priority: 2,
  priorityName: 'High',
  state: 'blocked',
  blockedBy: 2,
  external: false,
  projectId: 'app',
  projectName: null,
  parentTitle: null,
};

function card(props: Partial<Parameters<typeof GraphNodeCard>[0]> = {}) {
  const handlers = {
    onOpen: vi.fn(),
    onPoint: vi.fn(),
    onFocusNode: vi.fn(),
    onKeyDown: vi.fn(),
  };
  render(
    <GraphNodeCard
      node={node}
      x={0}
      y={0}
      open={false}
      emphasis="normal"
      critical={false}
      waiting={0}
      reduced
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe('GraphNodeCard', () => {
  it('names the task and how it stands, and opens it when pressed', () => {
    const { onOpen } = card();
    const button = screen.getByRole('button', {
      name: 'APP-3 Ship the release, Working, blocked by 2 tasks',
    });
    expect(button).toHaveAttribute('data-state', 'blocked');
    expect(screen.getByText('Blocked · 2')).toBeInTheDocument();
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledWith(node, button);
  });

  it('marks a bottleneck with the work it frees', () => {
    card({ node: { ...node, state: 'ready', blockedBy: 0 }, waiting: 4 });
    expect(screen.getByRole('button', { name: /4 tasks wait on it$/ })).toBeInTheDocument();
    expect(screen.getByText('Frees 4')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });

  it('names another project’s task by its project', () => {
    card({ node: { ...node, external: true, projectName: 'Operations' } });
    expect(screen.getByRole('button', { name: /in Operations$/ })).toBeInTheDocument();
  });
});
