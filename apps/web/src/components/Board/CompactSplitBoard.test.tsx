import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BoardHandoff,
  COMPACT_BELOW,
  COMPACT_LEAVE,
  CompactSplitBoard,
  compactFor,
} from './CompactSplitBoard';
import { drag } from './drag';
import { mockBoards } from './mockData';
import { board, current, initialBoard, update } from './state';

describe('compactFor', () => {
  it('turns compact below the threshold and back only once there is clear room again', () => {
    expect(compactFor(COMPACT_BELOW + 40, false)).toBe(false);
    expect(compactFor(COMPACT_BELOW - 1, false)).toBe(true);
    // Between the two, the board stays as it is, so a handle dragged across does not flicker.
    expect(compactFor(COMPACT_BELOW + 10, true)).toBe(true);
    expect(compactFor(COMPACT_BELOW + 10, false)).toBe(false);
    expect(compactFor(COMPACT_LEAVE, true)).toBe(false);
  });

  it('keeps its layout until the board has been measured', () => {
    expect(compactFor(0, true)).toBe(true);
    expect(compactFor(0, false)).toBe(false);
  });
});

describe('CompactSplitBoard', () => {
  const handoff = (): BoardHandoff => ({
    scope: current().project.id,
    column: null,
    lists: new Map(),
    view: null,
  });

  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      value: vi.fn(),
      configurable: true,
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    board.set(initialBoard(mockBoards()));
    drag.set(null);
  });

  const tab = (name: RegExp) =>
    within(screen.getByRole('tablist', { name: 'Board view' })).getByRole('tab', { name });

  it('pages through the active columns and shows the backlog and closed tasks as views', () => {
    const { project } = current();
    const active = project.statuses.filter((status) => status.category === 'active');
    const state = handoff();
    render(<CompactSplitBoard handoff={state} />);
    expect(tab(/Board/)).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelectorAll('[data-pager] > [data-page]')).toHaveLength(active.length);
    expect(screen.getByRole('tabpanel', { name: /Board/ })).not.toHaveAttribute('hidden');

    act(() => {
      fireEvent.click(tab(/Backlog/));
    });
    expect(state.view).toBe('backlog');
    // The columns stay mounted behind it, so a card carried out keeps its touch, but stop
    // being a pager a held card turns.
    expect(document.querySelector('[data-pager]')).toBeNull();
    expect(document.querySelector('[data-view="board"]')).toHaveAttribute('hidden');
    expect(document.querySelector('[data-view="backlog"]')).not.toHaveAttribute('hidden');
  });

  it('opens on the column and view the other layout left', () => {
    const { project } = current();
    const active = project.statuses.filter((status) => status.category === 'active');
    const state = { ...handoff(), column: active[1]!.id, view: 'closed' as const };
    render(<CompactSplitBoard handoff={state} />);
    expect(tab(/Closed/)).toHaveAttribute('aria-selected', 'true');
    // The columns are first drawn when the board's view is first shown, on that column.
    expect(screen.queryByRole('navigation', { name: 'Columns', hidden: true })).toBeNull();
    fireEvent.click(tab(/Board/));
    expect(
      within(screen.getByRole('navigation', { name: 'Columns' })).getByRole('button', {
        current: 'page',
      }),
    ).toHaveAccessibleName(new RegExp(`^${active[1]!.name}, \\d+ tasks?$`));
  });

  it('turns its view switch into the other views’ statuses while a card is held', () => {
    const { project, tasks } = current();
    const task = tasks.find((item) =>
      project.statuses.some(
        (status) => status.id === item.statusId && status.category === 'active',
      ),
    )!;
    render(<CompactSplitBoard handoff={handoff()} />);
    act(() => {
      drag.set({
        ids: [task.id],
        width: 280,
        height: 80,
        grab: { x: 10, y: 10 },
        origin: 'active',
        priority: task.priority,
        target: null,
        rail: null,
        phase: 'dragging',
        swallowed: false,
        touch: false,
        over: false,
        page: 0,
        moved: true,
      });
    });
    const closed = project.statuses.filter(
      (status) => status.category === 'done' || status.category === 'cancelled',
    );
    const backlog = project.statuses.filter((status) => status.category === 'backlog');
    const header = document.querySelector('[data-compact-board]')!;
    const targets = [...header.querySelectorAll<HTMLElement>('[data-drop-status]')]
      .filter((element) => !element.closest('[data-view]'))
      .map((element) => element.dataset.dropStatus);
    expect(targets).toEqual([...backlog, ...closed].map((status) => status.id));
    // On the columns, the board's own target is where the card already is.
    expect(header.querySelector('[data-drop-expand]')).toBeNull();
  });

  it('slides its dock away as a list scrolls down, and back as it scrolls up', async () => {
    render(<CompactSplitBoard handoff={handoff()} />);
    const dock = document.querySelector('[data-compact-dock]')!;
    const list = document.querySelector<HTMLElement>('[data-view="board"] [data-autoscroll]')!;
    Object.defineProperty(list, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 500, configurable: true });
    // The scrolls a view makes as it is shown are where it starts.
    await act(() => new Promise(requestAnimationFrame));
    const scrollTo = (top: number) =>
      act(() => {
        list.scrollTop = top;
        fireEvent.scroll(list);
      });
    scrollTo(30);
    scrollTo(60);
    expect(dock).not.toHaveAttribute('data-away');
    scrollTo(160);
    expect(dock).toHaveAttribute('data-away');
    scrollTo(130);
    expect(dock).toHaveAttribute('data-away');
    scrollTo(80);
    expect(dock).not.toHaveAttribute('data-away');
    scrollTo(300);
    expect(dock).toHaveAttribute('data-away');
    // Near the top it is always there.
    scrollTo(20);
    expect(dock).not.toHaveAttribute('data-away');
  });

  it('gives the dock’s place to the selection bar', () => {
    const { tasks } = current();
    render(<CompactSplitBoard handoff={handoff()} />);
    const dock = document.querySelector('[data-compact-dock]')!;
    act(() => update({ selection: [tasks[0]!.id] }));
    expect(dock).toHaveAttribute('data-away');
    expect(dock).toHaveAttribute('inert');
    act(() => update({ selection: [] }));
    expect(dock).not.toHaveAttribute('data-away');
  });
});
