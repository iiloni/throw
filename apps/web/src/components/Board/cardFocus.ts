export type CardDirection = 'up' | 'down' | 'left' | 'right';

type Box = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;

export const ARROW_DIRECTIONS: Record<string, CardDirection> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/** Columns this close to the nearest one count as it, so a ragged gallery reads as columns. */
const SAME_COLUMN = 24;

const middle = (box: Box) => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });

/**
 * The card an arrow goes to from `from`, by where cards are drawn rather than how lists are
 * built, so it walks columns, rails and a gallery's masonry alike. Up and down stay in the
 * column, to the nearest card that way; left and right go to the nearest column that way, to
 * its card closest in height.
 */
export function pickCard<T>(
  from: Box,
  cards: ReadonlyArray<{ item: T; box: Box }>,
  direction: CardDirection,
): T | null {
  const start = middle(from);
  if (direction === 'up' || direction === 'down') {
    const width = from.right - from.left;
    let best: { item: T; distance: number } | null = null;
    for (const { item, box } of cards) {
      const overlap = Math.min(box.right, from.right) - Math.max(box.left, from.left);
      if (overlap < Math.min(width, box.right - box.left) / 2) continue;
      const centre = middle(box).y;
      const distance = direction === 'up' ? start.y - centre : centre - start.y;
      if (distance <= 0) continue;
      if (!best || distance < best.distance) best = { item, distance };
    }
    return best?.item ?? null;
  }
  const beside = cards.flatMap(({ item, box }) => {
    const centre = middle(box);
    const gap = direction === 'left' ? from.left - box.right : box.left - from.right;
    const across = direction === 'left' ? centre.x < from.left : centre.x > from.right;
    return across ? [{ item, gap: Math.max(gap, 0), height: Math.abs(centre.y - start.y) }] : [];
  });
  if (beside.length === 0) return null;
  const nearest = Math.min(...beside.map((card) => card.gap));
  const column = beside.filter((card) => card.gap <= nearest + SAME_COLUMN);
  column.sort((a, b) => a.height - b.height);
  return column[0]!.item;
}

/** The task cards a keyboard can reach now: drawn, and not under a covering screen. */
function reachableCards(except: HTMLElement) {
  return [
    ...document.querySelectorAll<HTMLElement>('[data-card-id][aria-roledescription="Task card"]'),
  ].flatMap((card) => {
    if (card === except || card.hasAttribute('data-overlay') || card.tabIndex < 0) return [];
    if (card.closest('[inert], [aria-hidden="true"]')) return [];
    const box = card.getBoundingClientRect();
    return box.width > 0 && box.height > 0 ? [{ item: card, box }] : [];
  });
}

/** Moves focus from a card to the next one an arrow points to; false when there is none. */
export function focusNextCard(from: HTMLElement, direction: CardDirection) {
  const target = pickCard(from.getBoundingClientRect(), reachableCards(from), direction);
  if (!target) return false;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  return true;
}
