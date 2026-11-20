import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardList } from './CardList';
import { type DragState, drag } from './drag';
import { mockBoards } from './mockData';
import { board, current, initialBoard, type ListId, listTasks } from './state';

/** A column with cards in more than one priority, so the held card's has others to fold. */
function mixedColumn() {
  const state = board.get();
  for (const status of current(state).project.statuses) {
    if (status.category !== 'active') continue;
    const listId: ListId = `status:${status.id}`;
    const tasks = listTasks(state, listId);
    const lead = tasks[0];
    if (lead && tasks.some((task) => task.priority !== lead.priority)) return { listId, lead };
  }
  throw new Error('The mock board has a column of mixed priorities');
}

function held(listId: ListId, ids: string[], moved: boolean, priority = 3): DragState {
  return {
    ids,
    width: 280,
    height: 80,
    grab: { x: 20, y: 20 },
    origin: 'active',
    priority: priority as DragState['priority'],
    target: ids.length > 1 ? null : { kind: 'place', listId, priority: priority as 3, index: 0 },
    rail: null,
    phase: 'dragging',
    swallowed: false,
    touch: false,
    over: false,
    page: 0,
    moved,
  };
}

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

afterEach(() => {
  drag.set(null);
  vi.unstubAllGlobals();
});

describe('a column under a card just picked up', () => {
  it.each(['compact', 'full'] as const)(
    'keeps its layout in %s until the card moves, then makes way',
    (heldColumn) => {
      localStorage.setItem('throw-board-settings', JSON.stringify({ heldColumn }));
      const { listId, lead } = mixedColumn();
      const { container } = render(<CardList listId={listId} />);
      const column = container.querySelector('section')!;

      act(() => drag.set(held(listId, [lead.id], false, lead.priority)));
      expect(column.querySelector('[data-drop-rail]')).toBeNull();
      expect(column.querySelector('[data-folded]')).toBeNull();
      expect(column.querySelector('[data-dim]')).toBeNull();
      expect(column.querySelector('[data-mode="label"], [data-mode="open"]')).toBeNull();
      expect(column).not.toHaveAttribute('data-over');
      // Its own place stays open where it was.
      const gap = column.querySelector<HTMLElement>(`[data-slot="${lead.id}"]`)
        ?.previousElementSibling as HTMLElement;
      expect(gap).toHaveAttribute('data-gap');
      expect(gap.style.height).toBe('92px');

      act(() => drag.set(held(listId, [lead.id], true, lead.priority)));
      expect(column).toHaveAttribute('data-over');
      if (heldColumn === 'compact') {
        expect(column.querySelector('[data-drop-rail]')).not.toBeNull();
        expect(column.querySelector('[data-folded]')).not.toBeNull();
      } else {
        expect(column.querySelector('[data-drop-rail]')).toBeNull();
        expect(column.querySelector('[data-dim]')).not.toBeNull();
        expect(column.querySelector('[data-mode="label"]')).not.toBeNull();
      }
    },
  );

  it('keeps several held cards in place, faded, until they move', () => {
    const { listId } = mixedColumn();
    const ids = listTasks(board.get(), listId)
      .slice(0, 2)
      .map((task) => task.id);
    const { container } = render(<CardList listId={listId} />);
    const slot = (id: string) => container.querySelector<HTMLElement>(`[data-slot="${id}"]`)!;

    act(() => drag.set(held(listId, ids, false)));
    for (const id of ids) {
      expect(slot(id).hidden).toBe(false);
      expect(slot(id)).not.toHaveAttribute('data-folded');
    }

    act(() => drag.set(held(listId, ids, true)));
    for (const id of ids) expect(slot(id)).toHaveAttribute('data-folded');
  });
});
