import { describe, expect, it } from 'vitest';
import {
  bandMasonry,
  columnAt,
  columnsFor,
  dropIndex,
  GAP,
  gridFor,
  HEADING,
  masonry,
} from './masonry';

const grid = { columns: 2, columnWidth: 100, gap: 10 };

describe('columnsFor', () => {
  it('fits columns of at least the gallery width, and always one', () => {
    expect(columnsFor(0)).toBe(1);
    // The rail's single column: 304 px less its padding.
    expect(columnsFor(276)).toBe(1);
    expect(columnsFor(2 * 272 + GAP - 1)).toBe(1);
    expect(columnsFor(2 * 272 + GAP)).toBe(2);
    expect(columnsFor(1200)).toBe(4);
  });

  it('shares the width between the columns', () => {
    expect(gridFor(556)).toEqual({ columns: 2, columnWidth: 272, gap: GAP });
    expect(gridFor(276)).toEqual({ columns: 1, columnWidth: 276, gap: GAP });
  });
});

describe('masonry', () => {
  it('puts each card at the top of the shortest column, so the first row reads across', () => {
    const { slots, height } = masonry([100, 50, 60, 40], grid);
    expect(slots).toEqual([
      { x: 0, y: 0 },
      { x: 110, y: 0 },
      { x: 110, y: 60 },
      { x: 0, y: 110 },
    ]);
    expect(height).toBe(150);
  });

  it('runs newest first across the top row, not down the first column', () => {
    const { slots } = masonry([80, 80, 80, 80], { ...grid, columns: 3 });
    expect(slots.slice(0, 3).map((slot) => slot.y)).toEqual([0, 0, 0]);
    expect(slots[3]).toEqual({ x: 0, y: 90 });
  });

  it('stacks one column as a list', () => {
    const { slots, height } = masonry([40, 60], { ...grid, columns: 1 });
    expect(slots).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
    ]);
    expect(height).toBe(110);
  });

  it('is empty without cards', () => {
    expect(masonry([], grid)).toEqual({ slots: [], height: 0 });
  });
});

describe('masonry keeping columns', () => {
  it('moves the cards below a grown card down its column instead of across', () => {
    const before = masonry([100, 50, 60, 40], grid);
    const keep = before.slots.map((slot) => columnAt(slot.x, grid));
    expect(keep).toEqual([0, 1, 1, 0]);
    // The first card grows by 200: afresh, the fourth card would cross to the short column.
    expect(masonry([300, 50, 60, 40], grid).slots[3]).toEqual({ x: 110, y: 130 });
    const { slots, height } = masonry([300, 50, 60, 40], grid, keep);
    expect(slots).toEqual([
      { x: 0, y: 0 },
      { x: 110, y: 0 },
      { x: 110, y: 60 },
      { x: 0, y: 310 },
    ]);
    expect(height).toBe(350);
    // Shrinking back gives the layout it started from.
    expect(masonry([100, 50, 60, 40], grid, keep).slots).toEqual(before.slots);
  });

  it('places a card without a column it can keep in the shortest one', () => {
    expect(masonry([100, 50, 60], grid, [0, undefined, 5]).slots).toEqual([
      { x: 0, y: 0 },
      { x: 110, y: 0 },
      { x: 110, y: 60 },
    ]);
  });

  it('keeps columns band by band', () => {
    const layout = bandMasonry(
      [
        { heights: [100, 50, 40], heading: false, keep: [0, 1, 0] },
        { heights: [30], heading: true, keep: [1] },
      ],
      grid,
    );
    expect(layout.slots[2]).toEqual({ x: 0, y: 110 });
    // The first band ends at 150, the bigger of its columns.
    expect(layout.slots[3]).toEqual({ x: 110, y: 150 + 10 + HEADING });
  });
});

describe('bandMasonry', () => {
  it('lays each band out on its own, below its heading, in shared coordinates', () => {
    const layout = bandMasonry(
      [
        { heights: [100, 50, 60], heading: true },
        { heights: [40], heading: true },
      ],
      grid,
    );
    expect(layout.bands[0]).toEqual({ top: 0, cards: HEADING, height: HEADING + 120 });
    const second = HEADING + 120 + grid.gap;
    expect(layout.bands[1]).toEqual({ top: second, cards: second + HEADING, height: HEADING + 40 });
    expect(layout.slots).toEqual([
      { x: 0, y: HEADING },
      { x: 110, y: HEADING },
      { x: 110, y: HEADING + 60 },
      // A new band starts a new row, rather than filling the gap under the shorter column.
      { x: 0, y: second + HEADING },
    ]);
    expect(layout.height).toBe(second + HEADING + 40);
  });

  it('takes no room for an empty band without a heading', () => {
    const layout = bandMasonry(
      [
        { heights: [], heading: false },
        { heights: [50], heading: false },
        { heights: [], heading: false },
        { heights: [30], heading: false },
      ],
      grid,
    );
    expect(layout.slots).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 60 },
    ]);
    expect(layout.height).toBe(90);
    expect(layout.bands[2]).toMatchObject({ top: 60, height: 0 });
  });

  it('keeps room for an empty band that takes a card', () => {
    const layout = bandMasonry(
      [
        { heights: [], heading: true, minHeight: 80 },
        { heights: [50], heading: true },
      ],
      grid,
    );
    expect(layout.bands[0]!.height).toBe(HEADING + 80);
    expect(layout.slots[0]!.y).toBe(HEADING + 80 + grid.gap + HEADING);
  });
});

describe('dropIndex', () => {
  // Others at: 0 → (0, 0), 1 → (110, 0), 2 → (0, 60); then slot 3 is (110, 60).
  const heights = [50, 50, 50];
  const drop = (center: { x: number; y: number }, current: number) =>
    dropIndex({ ...grid, heights, height: 50, center, current });

  it('keeps the slot the card is still over', () => {
    expect(drop({ x: 50, y: 25 }, 0)).toBe(0);
  });

  it('moves to the slot nearest the card', () => {
    expect(drop({ x: 160, y: 85 }, 0)).toBe(3);
    expect(drop({ x: 160, y: 25 }, 0)).toBe(1);
  });

  it('stays put when another slot is barely closer', () => {
    // Just past the bottom of slot 0, and only slightly nearer slot 2.
    expect(drop({ x: 50, y: 58 }, 0)).toBe(0);
  });

  it('places a card that has no slot yet at the nearest one', () => {
    expect(drop({ x: 160, y: 85 }, -1)).toBe(3);
    expect(drop({ x: 0, y: 0 }, -1)).toBe(0);
  });

  it('reads a single column top to bottom', () => {
    const column = { columns: 1, columnWidth: 100, gap: 10 };
    const at = (y: number) =>
      dropIndex({ ...column, heights: [50, 50], height: 50, center: { x: 50, y }, current: -1 });
    expect(at(10)).toBe(0);
    expect(at(90)).toBe(1);
    expect(at(150)).toBe(2);
  });
});
