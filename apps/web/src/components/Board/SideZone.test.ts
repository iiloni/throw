import { describe, expect, it } from 'vitest';
import {
  PANEL_WIDTH,
  RAIL_SNAP,
  railGeometry,
  STRIP_WIDTH,
  settleRail,
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

  it('takes the board as a gallery, less the dropzones while a card is held', () => {
    const full = railGeometry({ ...base, views: { backlog: 'full', closed: 'strip' } });
    expect(full.backlog.zone).toBe(rowWidth - STRIP_WIDTH - 2 * ZONE_GAP);
    const holding = railGeometry({
      ...base,
      views: { backlog: 'full', closed: 'strip' },
      holding: true,
      origin: 'backlog',
    });
    expect(holding.backlog.zone).toBeLessThan(full.backlog.zone);
    // A change of state springs; the same state at another width does not.
    expect(holding.backlog.mode).not.toBe(full.backlog.mode);
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
