import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { createElement, type MouseEvent, type PointerEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEARCH_SIDEBAR_MIN, SIDEBAR_WIDTH } from '@/components/BoardSearch/BoardSearch';
import { boardRestWidth } from './DesktopBoard';
import { type DragState, drag, makingWay } from './drag';
import { mockBoards } from './mockData';
import { PEEK_DWELL_MS, PEEK_GRACE_MS } from './railPeek';
import {
  canCollapseGalleryOnEscape,
  PANEL_WIDTH,
  RAIL_SNAP,
  railGeometry,
  SideZone,
  STRIP_HOLD_MS,
  STRIP_WIDTH,
  settleRail,
  showsRailEdge,
  useStripPress,
  ZONE_GAP,
} from './SideZone';
import {
  board,
  current,
  endRailPeek,
  initialBoard,
  isPeeking,
  peekRail,
  revealStatus,
  setZoneView,
  update,
} from './state';

/** A card held and moving, from `origin`. */
function heldFrom(origin: string, taskId: string): DragState {
  return {
    ids: [taskId],
    width: 280,
    height: 80,
    grab: { x: 10, y: 10 },
    origin,
    priority: 3,
    target: null,
    rail: null,
    phase: 'dragging',
    swallowed: false,
    touch: false,
    over: false,
    page: 0,
    moved: true,
  };
}

const rowWidth = 1200;
const base = {
  rowWidth,
  views: { backlog: 'panel', closed: 'strip' } as const,
  widths: { backlog: null, closed: null },
  resize: null,
  holding: false,
  origin: null,
};

describe('railGeometry', () => {
  it('opens a panel as a single column, or as wide as its edge was dragged', () => {
    expect(railGeometry(base).backlog.zone).toBe(PANEL_WIDTH);
    expect(railGeometry({ ...base, widths: { backlog: 520, closed: null } }).backlog.zone).toBe(
      520,
    );
  });

  it('keeps a remembered width short of the gallery, beside the other rail', () => {
    const max = rowWidth - 2 * ZONE_GAP - STRIP_WIDTH;
    const wide = railGeometry({ ...base, widths: { backlog: 5000, closed: null } });
    expect(wide.backlog.max).toBe(max);
    expect(wide.backlog.zone).toBe(max - RAIL_SNAP);
    // Two wide panels never overlap: each leaves the other its own width.
    const both = railGeometry({
      ...base,
      views: { backlog: 'panel', closed: 'panel' },
      widths: { backlog: 5000, closed: 5000 },
    });
    expect(both.backlog.zone + both.closed.zone).toBeLessThanOrEqual(rowWidth - 2 * ZONE_GAP);
  });

  it('follows a held edge exactly, and lays the cards out no narrower than a column', () => {
    const held = railGeometry({ ...base, resize: { zone: 'backlog', width: 180 } });
    expect(held.backlog).toMatchObject({ zone: 180, drawn: 180, content: PANEL_WIDTH });
    expect(held.backlog.tracking).toBe(true);
    expect(held.closed.tracking).toBe(false);
  });

  it('takes the board as a gallery, and keeps its width while a card is held', () => {
    const full = railGeometry({ ...base, views: { backlog: 'full', closed: 'strip' } });
    expect(full.backlog.zone).toBe(rowWidth - STRIP_WIDTH - 2 * ZONE_GAP);
    const holding = railGeometry({
      ...base,
      views: { backlog: 'full', closed: 'strip' },
      holding: true,
      origin: 'backlog',
    });
    // The cards keep their columns and places under the held card, and after the drop.
    expect(holding.backlog).toMatchObject({
      zone: full.backlog.zone,
      drawn: full.backlog.drawn,
      content: full.backlog.content,
    });
    // The strip beside it takes the gallery's gap for the active dropzones, up to its edge.
    expect(holding.closed.zone).toBe(STRIP_WIDTH);
    expect(holding.closed.drawn).toBe(STRIP_WIDTH + 2 * ZONE_GAP);
    expect(holding.backlog.zone + holding.closed.drawn).toBe(rowWidth);
    // The same state at another width does not spring.
    expect(railGeometry({ ...base, rowWidth: 900 }).backlog.mode).toBe(
      railGeometry(base).backlog.mode,
    );
  });

  it('lays the cards out once for where the row is going, while the rail follows it', () => {
    const sliding = railGeometry({
      ...base,
      views: { backlog: 'full', closed: 'strip' },
      rowWidth: 1100,
      restWidth: 800,
    });
    expect(sliding.backlog.zone).toBe(1100 - STRIP_WIDTH - 2 * ZONE_GAP);
    expect(sliding.backlog.content).toBe(800 - STRIP_WIDTH - 2 * ZONE_GAP);
  });

  it('widens a strip under a held card from elsewhere, without moving the columns', () => {
    const strip = railGeometry({ ...base, holding: true, origin: 'active' }).closed;
    expect(strip.zone).toBe(STRIP_WIDTH);
    expect(strip.drawn).toBeGreaterThan(STRIP_WIDTH);
  });

  it('holds gallery content steady at its resting width while the docked search sidebar slides', () => {
    const frameWidth = 1600;
    const expectedRest = frameWidth - SIDEBAR_WIDTH;
    const expectedContent = expectedRest - STRIP_WIDTH - 2 * ZONE_GAP;
    // Simulate intermediate row widths as BoardSearchSidebar expands from 0 to SIDEBAR_WIDTH.
    const frames = [1600, 1520, 1410, 1300, expectedRest].map((liveRow) =>
      railGeometry({
        ...base,
        views: { backlog: 'full', closed: 'strip' },
        rowWidth: liveRow,
        restWidth: boardRestWidth({
          frameWidth,
          rowWidth: liveRow,
          searching: true,
          paneSpace: 0,
        }),
      }),
    );
    // Outer rail width tracks rowWidth frame-by-frame, while content stays pinned to the resting width.
    expect(frames.map((frame) => frame.backlog.zone)).toEqual(
      [1600, 1520, 1410, 1300, expectedRest].map((liveRow) => liveRow - STRIP_WIDTH - 2 * ZONE_GAP),
    );
    expect(new Set(frames.map((frame) => frame.backlog.content))).toEqual(
      new Set([expectedContent]),
    );
  });
});

describe('boardRestWidth', () => {
  it('subtracts docked search sidebar and task pane space from frameWidth', () => {
    expect(
      boardRestWidth({ frameWidth: 1600, rowWidth: 1500, searching: true, paneSpace: 0 }),
    ).toBe(1600 - SIDEBAR_WIDTH);
    expect(
      boardRestWidth({ frameWidth: 1600, rowWidth: 1100, searching: true, paneSpace: 488 }),
    ).toBe(1600 - SIDEBAR_WIDTH - 488);
    expect(
      boardRestWidth({ frameWidth: 1600, rowWidth: 1300, searching: false, paneSpace: 488 }),
    ).toBe(1600 - 488);
  });

  it('ignores search sidebar space below SEARCH_SIDEBAR_MIN, falls back before measurement, and never goes negative', () => {
    expect(
      boardRestWidth({
        frameWidth: SEARCH_SIDEBAR_MIN - 1,
        rowWidth: SEARCH_SIDEBAR_MIN - 1,
        searching: true,
        paneSpace: 0,
      }),
    ).toBe(SEARCH_SIDEBAR_MIN - 1);
    expect(boardRestWidth({ frameWidth: 0, rowWidth: 900, searching: true, paneSpace: 488 })).toBe(
      900,
    );
    expect(
      boardRestWidth({ frameWidth: 1320, rowWidth: 100, searching: true, paneSpace: 1200 }),
    ).toBe(0);
  });
});

describe('settleRail', () => {
  const max = 1000;
  it('snaps shut near a strip, open near the whole board, and keeps widths between', () => {
    expect(settleRail(PANEL_WIDTH - RAIL_SNAP, max).view).toBe('strip');
    expect(settleRail(PANEL_WIDTH - RAIL_SNAP + 1, max)).toEqual({
      view: 'panel',
      width: PANEL_WIDTH,
    });
    expect(settleRail(600, max)).toEqual({ view: 'panel', width: 600 });
    expect(settleRail(max - RAIL_SNAP, max).view).toBe('full');
  });

  it('never snaps to the gallery where there is no room beyond a column', () => {
    expect(settleRail(PANEL_WIDTH + 10, PANEL_WIDTH + 20)).toEqual({
      view: 'panel',
      width: PANEL_WIDTH,
    });
  });
});

describe('showsRailEdge', () => {
  it('gives a panel an edge, and neither a strip nor a gallery', () => {
    expect(showsRailEdge('panel', false, false)).toBe(true);
    expect(showsRailEdge('strip', false, false)).toBe(false);
    expect(showsRailEdge('full', false, false)).toBe(false);
  });

  it('keeps a held edge until it is let go, even past the gallery’s snap', () => {
    expect(showsRailEdge('panel', true, false)).toBe(true);
    expect(showsRailEdge('full', true, false)).toBe(true);
    expect(showsRailEdge('full', false, false)).toBe(false);
  });

  it('hides the edge while the rail stands in as dropzones', () => {
    expect(showsRailEdge('panel', false, true)).toBe(false);
    expect(showsRailEdge('panel', true, true)).toBe(false);
  });
});

describe('useStripPress', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function strip() {
    const onPress = vi.fn();
    const onHold = vi.fn();
    const { result, unmount } = renderHook(() => useStripPress({ onPress, onHold }));
    const pointer = (pointerType: string, x = 0, y = 0, button = 0) =>
      ({ pointerType, button, clientX: x, clientY: y }) as PointerEvent<HTMLElement>;
    const mouse = (detail: number) => {
      const event = { detail, preventDefault: vi.fn() };
      return event as typeof event & MouseEvent<HTMLElement>;
    };
    return { press: () => result.current, onPress, onHold, pointer, mouse, unmount };
  }

  it('opens a column on a quick tap, and on a keyboard click', () => {
    const { press, onPress, onHold, pointer, mouse } = strip();
    press().onPointerDown(pointer('touch'));
    act(() => vi.advanceTimersByTime(STRIP_HOLD_MS - 50));
    press().onPointerUp();
    press().onClick(mouse(1));
    act(() => vi.advanceTimersByTime(STRIP_HOLD_MS));
    press().onClick(mouse(0));
    expect(onPress).toHaveBeenCalledTimes(2);
    expect(onHold).not.toHaveBeenCalled();
  });

  it('opens the gallery on a hold and swallows the click that follows', () => {
    const { press, onPress, onHold, pointer, mouse } = strip();
    press().onPointerDown(pointer('mouse'));
    act(() => vi.advanceTimersByTime(STRIP_HOLD_MS));
    expect(onHold).toHaveBeenCalledOnce();
    const menu = mouse(0);
    press().onContextMenu(menu);
    expect(menu.preventDefault).toHaveBeenCalled();
    press().onPointerUp();
    const click = mouse(1);
    press().onClick(click);
    expect(click.preventDefault).toHaveBeenCalled();
    expect(onPress).not.toHaveBeenCalled();
    // Only the one click: the next one opens a column again.
    press().onClick(mouse(1));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('lets go of a hold that moves, leaves, is cancelled or unmounts', () => {
    const { press, onHold, pointer, unmount } = strip();
    press().onPointerDown(pointer('pen', 0, 0));
    press().onPointerMove(pointer('pen', 4, 4));
    press().onPointerMove(pointer('pen', 12, 0));
    act(() => vi.advanceTimersByTime(STRIP_HOLD_MS));
    for (const end of ['onPointerLeave', 'onPointerCancel'] as const) {
      press().onPointerDown(pointer('touch'));
      press()[end]();
      act(() => vi.advanceTimersByTime(STRIP_HOLD_MS));
    }
    press().onPointerDown(pointer('touch'));
    unmount();
    act(() => vi.advanceTimersByTime(STRIP_HOLD_MS));
    expect(onHold).not.toHaveBeenCalled();
  });

  it('ignores the secondary mouse buttons, and leaves their menu alone', () => {
    const { press, onHold, pointer, mouse } = strip();
    press().onPointerDown(pointer('mouse', 0, 0, 2));
    act(() => vi.advanceTimersByTime(STRIP_HOLD_MS));
    const menu = mouse(0);
    press().onContextMenu(menu);
    expect(onHold).not.toHaveBeenCalled();
    expect(menu.preventDefault).not.toHaveBeenCalled();
  });
});

describe('canCollapseGalleryOnEscape', () => {
  const escapeEvent = (overrides: Partial<KeyboardEvent> = {}) =>
    ({
      key: 'Escape',
      defaultPrevented: false,
      isComposing: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      target: document.body,
      ...overrides,
    }) as KeyboardEvent;

  const fullState = () => ({
    backlog: 'full' as const,
    closed: 'strip' as const,
    openTaskId: null,
    carrying: null,
    selection: [] as string[],
  });

  afterEach(() => {
    drag.set(null);
    document.body.innerHTML = '';
  });

  it('allows collapsing only the full zone on a plain, unhandled Escape', () => {
    expect(canCollapseGalleryOnEscape('backlog', escapeEvent(), fullState())).toBe(true);
    expect(canCollapseGalleryOnEscape('closed', escapeEvent(), fullState())).toBe(false);
    expect(canCollapseGalleryOnEscape('backlog', escapeEvent({ key: 'Enter' }), fullState())).toBe(
      false,
    );
    expect(
      canCollapseGalleryOnEscape('backlog', escapeEvent({ defaultPrevented: true }), fullState()),
    ).toBe(false);
    expect(
      canCollapseGalleryOnEscape('backlog', escapeEvent({ isComposing: true }), fullState()),
    ).toBe(false);
    expect(canCollapseGalleryOnEscape('backlog', escapeEvent({ ctrlKey: true }), fullState())).toBe(
      false,
    );
  });

  it('yields to active task pane, carry, selection and drag modes', () => {
    const sampleTask = mockBoards()[0]!.tasks[0]!;
    expect(
      canCollapseGalleryOnEscape('backlog', escapeEvent(), { ...fullState(), openTaskId: 't-1' }),
    ).toBe(false);
    expect(
      canCollapseGalleryOnEscape('backlog', escapeEvent(), {
        ...fullState(),
        carrying: { taskId: sampleTask.id, seen: sampleTask, preview: sampleTask },
      }),
    ).toBe(false);
    expect(
      canCollapseGalleryOnEscape('backlog', escapeEvent(), { ...fullState(), selection: ['t-1'] }),
    ).toBe(false);
    drag.set({
      ids: [sampleTask.id],
      width: 240,
      height: 80,
      grab: { x: 0, y: 0 },
      origin: 'backlog',
      priority: sampleTask.priority,
      target: null,
      rail: null,
      phase: 'dragging',
      swallowed: false,
      touch: false,
      over: false,
      page: 0,
      moved: true,
    });
    expect(canCollapseGalleryOnEscape('backlog', escapeEvent(), fullState())).toBe(false);
  });

  it('yields to higher-priority overlays but ignores passive tooltips', () => {
    for (const html of [
      '<div role="dialog"></div>',
      '<div role="alertdialog"></div>',
      '<div role="menu"></div>',
      '<div role="listbox"></div>',
      '<div data-radix-popper-content-wrapper><div>Popover</div></div>',
    ]) {
      document.body.innerHTML = html;
      expect(canCollapseGalleryOnEscape('backlog', escapeEvent(), fullState())).toBe(false);
    }
    document.body.innerHTML =
      '<div data-radix-popper-content-wrapper><div data-slot="tooltip-content"><span role="tooltip">Back to a column</span></div></div>';
    expect(canCollapseGalleryOnEscape('backlog', escapeEvent(), fullState())).toBe(true);
  });

  it('yields when an editable element or search control is focused', () => {
    for (const html of [
      '<input type="text" />',
      '<textarea></textarea>',
      '<select><option>One</option></select>',
      '<div contenteditable="true" tabindex="0">Edit</div>',
      '<search><button type="button">Filter</button></search>',
    ]) {
      document.body.innerHTML = html;
      const focusable = document.body.querySelector<HTMLElement>(
        'input, textarea, select, [contenteditable], button',
      )!;
      focusable.focus();
      expect(
        canCollapseGalleryOnEscape('backlog', escapeEvent({ target: focusable }), fullState()),
      ).toBe(false);
    }
  });
});

describe('SideZone Escape collapse', () => {
  function renderZone(zone: 'backlog' | 'closed') {
    function Harness() {
      const state = board.use();
      const rails = railGeometry({
        rowWidth: 1440,
        views: { backlog: state.backlog, closed: state.closed },
        widths: { backlog: null, closed: null },
        resize: null,
        holding: false,
        origin: null,
      });
      return createElement(SideZone, { zone, geometry: rails[zone] });
    }
    return render(createElement(Harness));
  }

  beforeEach(() => {
    localStorage.clear();
    drag.set(null);
    board.set(initialBoard(mockBoards()));
  });

  afterEach(() => {
    drag.set(null);
  });

  it('collapses a panel-opened gallery back to panel and restores focus to its toggle', () => {
    act(() => {
      setZoneView('backlog', 'panel');
      setZoneView('backlog', 'full');
    });
    renderZone('backlog');
    const toggle = screen.getByRole('button', { name: 'Back to a column' });
    act(() => toggle.focus());

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(board.get().backlog).toBe('panel');
    expect(screen.getByRole('button', { name: 'Open as a gallery' })).toHaveFocus();
  });

  it('collapses a strip-opened gallery back to strip and restores focus to the strip button', () => {
    act(() => {
      setZoneView('closed', 'strip');
      setZoneView('closed', 'full');
    });
    renderZone('closed');
    const toggle = screen.getByRole('button', { name: 'Back to a column' });
    act(() => toggle.focus());

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(board.get().closed).toBe('strip');
    expect(screen.getByRole('button', { name: /^Open closed,/ })).toHaveFocus();
  });

  it('leaves focus alone when collapsing from an unrelated control outside the rail', () => {
    act(() => {
      setZoneView('backlog', 'strip');
      setZoneView('backlog', 'full');
    });
    const outside = document.createElement('button');
    outside.textContent = 'Nav';
    document.body.appendChild(outside);
    try {
      renderZone('backlog');
      act(() => outside.focus());

      fireEvent.keyDown(window, { key: 'Escape' });

      expect(board.get().backlog).toBe('strip');
      expect(outside).toHaveFocus();
    } finally {
      outside.remove();
    }
  });

  it('does not collapse on the same Escape that closes a task or clears selection', () => {
    const taskId = mockBoards()[0]!.tasks[0]!.id;
    act(() => {
      setZoneView('backlog', 'panel');
      setZoneView('backlog', 'full');
      update({ openTaskId: taskId });
    });
    renderZone('backlog');

    // Simulate useBoardBoundary dismissing the task synchronously without calling preventDefault.
    const boundary = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const live = board.get();
      if (live.selection.length > 0) update({ selection: [] });
      else if (live.openTaskId) update({ openTaskId: null });
    };
    window.addEventListener('keydown', boundary);
    try {
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(board.get().openTaskId).toBeNull();
      expect(board.get().backlog).toBe('full');

      // Selection also takes precedence before gallery collapse.
      act(() => update({ selection: [taskId] }));
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(board.get().selection).toEqual([]);
      expect(board.get().backlog).toBe('full');

      // With overlays and modes clear, the next Escape collapses the gallery.
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(board.get().backlog).toBe('panel');
    } finally {
      window.removeEventListener('keydown', boundary);
    }
  });
});

describe('railGeometry peek', () => {
  const strips = { ...base, views: { backlog: 'strip', closed: 'strip' } as const };

  it('draws a peeked strip as its panel over the columns, which keep the strip’s room', () => {
    const rest = railGeometry(strips);
    const peek = railGeometry({ ...strips, peek: 'backlog' });
    expect(peek.backlog.zone).toBe(STRIP_WIDTH);
    expect(peek.backlog.drawn).toBe(PANEL_WIDTH);
    expect(peek.backlog.content).toBe(PANEL_WIDTH);
    // Its own spring opens it, and the columns' (zone) has nowhere to go.
    expect(peek.backlog.mode).not.toBe(rest.backlog.mode);
    expect(peek.closed).toEqual(rest.closed);
  });

  it('peeks as wide as the panel was last dragged, and leaves an open panel alone', () => {
    const widths = { backlog: 480, closed: null };
    expect(railGeometry({ ...strips, widths, peek: 'backlog' }).backlog.drawn).toBe(480);
    expect(railGeometry({ ...base, peek: 'backlog' }).backlog).toEqual(railGeometry(base).backlog);
  });

  it('does not narrow the other rail for a peek', () => {
    const views = { backlog: 'strip', closed: 'panel' } as const;
    const widths = { backlog: null, closed: 5000 };
    expect(railGeometry({ ...base, views, widths, peek: 'backlog' }).closed).toEqual(
      railGeometry({ ...base, views, widths }).closed,
    );
  });

  it('turns back into dropzones for a card held from elsewhere', () => {
    const held = { ...strips, holding: true, origin: 'active' };
    expect(railGeometry({ ...held, peek: 'backlog' }).backlog).toEqual(railGeometry(held).backlog);
    // A card held from the peek itself keeps it open.
    const own = railGeometry({ ...strips, holding: true, origin: 'backlog', peek: 'backlog' });
    expect(own.backlog).toMatchObject({ zone: STRIP_WIDTH, drawn: PANEL_WIDTH });
  });

  it('follows a peek’s held edge over the columns', () => {
    const held = railGeometry({
      ...strips,
      peek: 'backlog',
      resize: { zone: 'backlog', width: 420 },
    });
    expect(held.backlog).toMatchObject({ zone: STRIP_WIDTH, drawn: 420, tracking: true });
  });
});

describe('rail peek state', () => {
  beforeEach(() => {
    board.set({ ...initialBoard(mockBoards()), backlog: 'strip', closed: 'strip' });
  });

  it('peeks only at a strip', () => {
    peekRail('backlog');
    expect(board.get().railPeek).toBe('backlog');
    expect(board.get().backlog).toBe('strip');
    expect(isPeeking(board.get(), 'backlog')).toBe(true);
    endRailPeek('backlog');
    expect(board.get().railPeek).toBeNull();

    board.set({ ...board.get(), backlog: 'panel' });
    peekRail('backlog');
    expect(board.get().railPeek).toBeNull();
  });

  it('settles a peek into whatever its rail is set to', () => {
    peekRail('backlog');
    setZoneView('backlog', 'panel');
    expect(board.get()).toMatchObject({ backlog: 'panel', railPeek: null });

    setZoneView('backlog', 'strip');
    peekRail('backlog');
    setZoneView('backlog', 'strip');
    expect(board.get()).toMatchObject({ backlog: 'strip', railPeek: null });

    peekRail('backlog');
    setZoneView('backlog', 'full');
    // Escape takes the gallery back to the strip the peek stood on.
    expect(board.get()).toMatchObject({ backlog: 'full', railPeek: null });
    expect(board.get().railBeforeFull.backlog).toBe('strip');
  });

  it('keeps a peek while the other rail opens as a column, and ends it for a gallery', () => {
    peekRail('backlog');
    setZoneView('closed', 'panel');
    expect(board.get().railPeek).toBe('backlog');
    setZoneView('closed', 'full');
    expect(board.get()).toMatchObject({ backlog: 'strip', railPeek: null });
  });

  it('keeps a peek open for a card sent there from the keyboard', () => {
    const backlogStatus = current().project.statuses.find((item) => item.category === 'backlog')!;
    peekRail('backlog');
    revealStatus(backlogStatus.id);
    expect(board.get()).toMatchObject({ backlog: 'panel', railPeek: null });
  });
});

describe('SideZone peek', () => {
  function renderZone() {
    function Harness() {
      const state = board.use();
      const held = drag.use();
      const rails = railGeometry({
        rowWidth: 1440,
        views: { backlog: state.backlog, closed: state.closed },
        widths: { backlog: null, closed: null },
        resize: null,
        holding: makingWay(held),
        origin: held?.origin ?? null,
        peek: state.railPeek,
      });
      return createElement(SideZone, { zone: 'backlog', geometry: rails.backlog });
    }
    return render(createElement(Harness));
  }
  const strip = () => screen.getByRole('button', { name: /^Open backlog,/ });
  const rail = () => screen.getByRole('complementary', { name: 'Backlog' });
  function dwell() {
    fireEvent.pointerEnter(strip(), { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(PEEK_DWELL_MS));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    drag.set(null);
    board.set({ ...initialBoard(mockBoards()), backlog: 'strip', closed: 'strip' });
  });

  afterEach(() => {
    drag.set(null);
    vi.useRealTimers();
  });

  it('opens over the columns after a mouse rests on the strip, and closes after it leaves', () => {
    renderZone();
    dwell();
    expect(board.get()).toMatchObject({ backlog: 'strip', railPeek: 'backlog' });
    expect(rail()).toHaveAttribute('data-peek');
    expect(screen.getByRole('button', { name: 'Close backlog' })).toBeInTheDocument();

    fireEvent.pointerLeave(rail(), { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(PEEK_GRACE_MS - 50));
    fireEvent.pointerEnter(rail(), { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(PEEK_GRACE_MS));
    expect(board.get().railPeek).toBe('backlog');

    fireEvent.pointerLeave(rail(), { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(PEEK_GRACE_MS));
    expect(board.get().railPeek).toBeNull();
    expect(strip()).toBeInTheDocument();
  });

  it('shows how long is left of the dwell around the strip’s icon', () => {
    const view = renderZone();
    expect(view.container.querySelector('[data-dwell-ring]')).toBeNull();
    fireEvent.pointerEnter(strip(), { pointerType: 'mouse' });
    expect(strip()).toHaveAttribute('data-dwelling');
    expect(view.container.querySelector('[data-dwell-ring]')).not.toBeNull();
    fireEvent.pointerDown(strip(), { pointerType: 'mouse', button: 0 });
    // Pressed, the strip keeps to its own press: the ring goes and nothing peeks.
    expect(strip()).not.toHaveAttribute('data-dwelling');
    act(() => vi.advanceTimersByTime(PEEK_DWELL_MS));
    expect(board.get().railPeek).toBeNull();
  });

  it('does not open for a touch, or for a mouse that leaves first', () => {
    renderZone();
    fireEvent.pointerEnter(strip(), { pointerType: 'touch' });
    act(() => vi.advanceTimersByTime(PEEK_DWELL_MS));
    expect(board.get().railPeek).toBeNull();

    fireEvent.pointerEnter(strip(), { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(PEEK_DWELL_MS / 2));
    fireEvent.pointerLeave(strip(), { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(PEEK_DWELL_MS));
    expect(board.get().railPeek).toBeNull();
  });

  it('stays open once something in it is clicked', () => {
    renderZone();
    dwell();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(board.get()).toMatchObject({ backlog: 'panel', railPeek: null });
    fireEvent.pointerLeave(rail(), { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(PEEK_GRACE_MS * 2));
    expect(board.get().backlog).toBe('panel');
  });

  it('closes from its own close button, and opens as a gallery from its toggle', () => {
    renderZone();
    dwell();
    fireEvent.click(screen.getByRole('button', { name: 'Close backlog' }));
    expect(board.get()).toMatchObject({ backlog: 'strip', railPeek: null });

    dwell();
    fireEvent.click(screen.getByRole('button', { name: 'Open as a gallery' }));
    expect(board.get()).toMatchObject({ backlog: 'full', railPeek: null });
  });

  it('stays open for the backlog shortcut', () => {
    renderZone();
    dwell();
    fireEvent.keyDown(window, { key: '[' });
    expect(board.get()).toMatchObject({ backlog: 'panel', railPeek: null });
  });

  it('keeps a card held from it while it is over it, and lets go once it is dragged out', () => {
    renderZone();
    dwell();
    const taskId = mockBoards()[0]!.tasks[0]!.id;
    act(() => drag.set(heldFrom('backlog', taskId)));
    // Moved about inside it, the peek stays for the card to be placed there.
    act(() => vi.advanceTimersByTime(PEEK_GRACE_MS * 4));
    expect(board.get().railPeek).toBe('backlog');
    expect(rail()).toHaveAttribute('data-peek');

    // Dragged out, it goes back to its strip with the card still held, uncovering the columns.
    fireEvent.pointerLeave(rail(), { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(PEEK_GRACE_MS));
    expect(board.get().railPeek).toBeNull();
    expect(drag.get()).not.toBeNull();
    // Nor does it open again under the held card.
    fireEvent.pointerEnter(strip(), { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(PEEK_DWELL_MS));
    expect(board.get().railPeek).toBeNull();
  });

  it('keeps a card dragged back in before the grace runs out', () => {
    renderZone();
    dwell();
    const taskId = mockBoards()[0]!.tasks[0]!.id;
    act(() => drag.set(heldFrom('backlog', taskId)));
    fireEvent.pointerLeave(rail(), { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(PEEK_GRACE_MS - 50));
    fireEvent.pointerEnter(rail(), { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(PEEK_GRACE_MS * 2));
    expect(board.get().railPeek).toBe('backlog');
  });

  it('gives way to a card held from elsewhere', () => {
    renderZone();
    dwell();
    const taskId = mockBoards()[0]!.tasks[0]!.id;
    act(() => drag.set(heldFrom('active', taskId)));
    expect(board.get().railPeek).toBeNull();
    expect(rail()).not.toHaveAttribute('data-peek');
  });

  it('does not open while a card is held', () => {
    renderZone();
    const taskId = mockBoards()[0]!.tasks[0]!.id;
    act(() => drag.set(heldFrom('backlog', taskId)));
    fireEvent.pointerEnter(strip(), { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(PEEK_DWELL_MS));
    expect(board.get().railPeek).toBeNull();
  });

  it('is not kept once the rail leaves the board', () => {
    const view = renderZone();
    dwell();
    view.unmount();
    expect(board.get().railPeek).toBeNull();
  });
});
