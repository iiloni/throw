import { describe, expect, it } from 'vitest';
import { pickCard } from './cardFocus';

const box = (left: number, top: number, width = 100, height = 60) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

// Two columns of cards, a third further off, and a masonry card a little out of line.
const cards = [
  { item: 'a1', box: box(0, 0) },
  { item: 'a2', box: box(0, 80) },
  { item: 'a3', box: box(0, 160) },
  { item: 'b1', box: box(120, 0) },
  { item: 'b2', box: box(120, 200, 100, 120) },
  { item: 'c1', box: box(400, 160) },
];
const from = (id: string) => cards.find((card) => card.item === id)!.box;
const others = (id: string) => cards.filter((card) => card.item !== id);

describe('pickCard', () => {
  it('walks up and down within a column', () => {
    expect(pickCard(from('a2'), others('a2'), 'up')).toBe('a1');
    expect(pickCard(from('a2'), others('a2'), 'down')).toBe('a3');
    expect(pickCard(from('a1'), others('a1'), 'up')).toBeNull();
    expect(pickCard(from('b1'), others('b1'), 'down')).toBe('b2');
  });

  it('crosses to the nearest column, to its card closest in height', () => {
    expect(pickCard(from('a3'), others('a3'), 'right')).toBe('b2');
    expect(pickCard(from('a1'), others('a1'), 'right')).toBe('b1');
    expect(pickCard(from('b2'), others('b2'), 'left')).toBe('a3');
    expect(pickCard(from('b2'), others('b2'), 'right')).toBe('c1');
    expect(pickCard(from('a1'), others('a1'), 'left')).toBeNull();
  });
});
