/**
 * Catch's masonry (`apps/web/src/lib/masonry.ts`): each card goes to the top of the shortest
 * column, leftmost on a tie, so reading order runs across the top row first. Throw adds
 * bands: the backlog's priorities, each under its own heading, stacked in one coordinate
 * space so a card changing band keeps its springs, as Catch's pinned and other notes do.
 */
export type Point = { x: number; y: number };

export type Grid = { columns: number; columnWidth: number; gap: number };

/** Gallery cards are at least this wide, as the CSS grid's were. */
export const MIN_COLUMN_WIDTH = 272;
export const GAP = 12;

/** As many columns of at least `min` as fit across `width`, and never fewer than one. */
export function columnsFor(width: number, min = MIN_COLUMN_WIDTH, gap = GAP) {
  return Math.max(1, Math.floor((width + gap) / (min + gap)));
}

/** The grid that fills `width`: its columns share what the gaps leave. */
export function gridFor(width: number, columns = columnsFor(width), gap = GAP): Grid {
  return { columns, columnWidth: Math.max(0, (width - gap * (columns - 1)) / columns), gap };
}

class Columns {
  private readonly tops: number[];

  constructor(private readonly grid: Grid) {
    this.tops = Array.from({ length: Math.max(1, grid.columns) }, () => 0);
  }

  private shortest() {
    let column = 0;
    for (let i = 1; i < this.tops.length; i++) {
      if ((this.tops[i] ?? 0) < (this.tops[column] ?? 0)) column = i;
    }
    return column;
  }

  /** Where the next card goes. */
  next(): Point {
    const column = this.shortest();
    return { x: column * (this.grid.columnWidth + this.grid.gap), y: this.tops[column] ?? 0 };
  }

  place(height: number): Point {
    const column = this.shortest();
    const slot = this.next();
    this.tops[column] = slot.y + height + this.grid.gap;
    return slot;
  }

  get height() {
    return Math.max(0, Math.max(...this.tops) - this.grid.gap);
  }
}

/** Positions for cards of the given heights, in order, and the height of the whole grid. */
export function masonry(heights: readonly number[], grid: Grid) {
  const columns = new Columns(grid);
  const slots = heights.map((height) => columns.place(height));
  return { slots, height: columns.height };
}

export type BandInput = {
  /** The cards' heights, in order. */
  heights: readonly number[];
  /** Draw the band's heading above its cards. */
  heading: boolean;
  /** Room the band keeps for its cards however few it has, such as a place to drop into. */
  minHeight?: number;
};

export type BandLayout = {
  /** Where the band starts: its heading, or its first card without one. */
  top: number;
  /** Where its cards start. */
  cards: number;
  height: number;
};

/** A band's heading: the zone header's label height (`.zone-header`, 2.25rem). */
export const HEADING = 36;

/**
 * Bands of masonry stacked down the page. A band with no cards and no heading takes no room.
 * Every card's slot comes back in one list, in band order, so a card keeps its place in it
 * as it moves between bands.
 */
export function bandMasonry(bands: readonly BandInput[], grid: Grid) {
  const slots: Point[] = [];
  const layouts: BandLayout[] = [];
  let y = 0;
  let any = false;
  for (const band of bands) {
    const cards = masonry(band.heights, grid);
    const body = Math.max(cards.height, band.minHeight ?? 0);
    const empty = body === 0 && !band.heading;
    // Bands are a gap apart, as cards are; an empty one takes nothing, not even the gap.
    const top = any ? y + grid.gap : y;
    const cardsTop = top + (band.heading ? HEADING : 0);
    for (const slot of cards.slots) slots.push({ x: slot.x, y: slot.y + cardsTop });
    const height = cardsTop - top + body;
    layouts.push({ top, cards: cardsTop, height });
    if (!empty) {
      y = top + height;
      any = true;
    }
  }
  return { slots, bands: layouts, height: y };
}

/** How much closer another slot must be before a dragged card leaves its own. */
const HYSTERESIS = 16;

/**
 * Where a dragged card should land: the index among the other cards (`heights`, in
 * order) whose slot is nearest the card's centre. The card keeps its current slot while
 * its centre is over it, so the grid does not flicker between two equally close slots.
 * `current` is -1 when the card is not yet placed among them.
 */
export function dropIndex({
  heights,
  height,
  center,
  current,
  ...grid
}: Grid & { heights: readonly number[]; height: number; center: Point; current: number }) {
  const columns = new Columns(grid);
  let best = current;
  let bestDistance = Number.POSITIVE_INFINITY;
  let currentDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= heights.length; index++) {
    const slot = columns.next();
    if (index === current) {
      const inside =
        center.x >= slot.x &&
        center.x <= slot.x + grid.columnWidth &&
        center.y >= slot.y &&
        center.y <= slot.y + height;
      if (inside) return current;
    }
    const distance = Math.hypot(
      center.x - (slot.x + grid.columnWidth / 2),
      center.y - (slot.y + height / 2),
    );
    if (index === current) currentDistance = distance;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
    if (index < heights.length) columns.place(heights[index] ?? 0);
  }
  return bestDistance + HYSTERESIS < currentDistance ? best : Math.max(0, current);
}
