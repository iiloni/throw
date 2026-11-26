import { act, renderHook } from '@testing-library/react';
import type { MouseEvent, PointerEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEARCH_SIDEBAR_MIN, SIDEBAR_WIDTH } from '@/components/BoardSearch/BoardSearch';
import { boardRestWidth } from './DesktopBoard';
import {
  PANEL_WIDTH,
  RAIL_SNAP,
  railGeometry,
  STRIP_HOLD_MS,
  STRIP_WIDTH,
  settleRail,
  showsRailEdge,
  useStripPress,
  ZONE_GAP,
} from './SideZone';

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
