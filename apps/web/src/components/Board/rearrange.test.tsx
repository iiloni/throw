import { describe, expect, it } from 'vitest';
import { MAX_CHANGES, planRearrangement, type Seen } from './rearrange';

const build = document.createElement('section');
const review = document.createElement('section');
const opened = document.createElement('section');
const lists = new Set<Element>([build, review]);

function seen(key: string, list: Element | null, y: number, extra: Partial<Seen> = {}): Seen {
  return {
    key,
    card: true,
    flow: true,
    list,
    rect: { x: list === review ? 300 : 0, y, width: 280, height: 80 },
    entering: false,
    ...extra,
  };
}

function places(...items: Seen[]) {
  return new Map(items.map((item) => [item.key, item]));
}

const everywhere = { lists, hidden: () => false, shown: () => true };

describe('planRearrangement', () => {
  it('springs a card to its new place in a column, and the neighbours it passes', () => {
    const before = places(seen('a', build, 0), seen('b', build, 92), seen('c', build, 184));
    // c's priority rose above a and b.
    const after = places(seen('c', build, 0), seen('a', build, 92), seen('b', build, 184));
    expect(planRearrangement(before, after, everywhere)).toEqual([
      { kind: 'shift', key: 'c', dx: 0, dy: 184, lead: true },
      { kind: 'shift', key: 'a', dx: 0, dy: -92, lead: false },
      { kind: 'shift', key: 'b', dx: 0, dy: -92, lead: false },
    ]);
  });

  it('flies a card between columns on screen while both columns make way', () => {
    const before = places(seen('a', build, 0), seen('b', build, 92), seen('c', review, 0));
    const after = places(seen('b', build, 0), seen('a', review, 0), seen('c', review, 92));
    const plan = planRearrangement(before, after, everywhere);
    expect(plan).toContainEqual({ kind: 'fly', key: 'a' });
    expect(plan).toContainEqual(expect.objectContaining({ kind: 'shift', key: 'b', dy: 92 }));
    expect(plan).toContainEqual(expect.objectContaining({ kind: 'shift', key: 'c', dy: -92 }));
  });

  it('lets a card go from sight, or arrive into it, when the other end is out of view', () => {
    const before = places(seen('a', build, 0), seen('c', review, 0));
    const after = places(seen('a', review, 0), seen('c', build, 0));
    const shown = (key: string, when: 'before' | 'after') =>
      key === 'a' ? when === 'before' : when === 'after';
    expect(planRearrangement(before, after, { ...everywhere, shown })).toEqual([
      { kind: 'leave', key: 'a' },
      { kind: 'appear', key: 'c' },
    ]);
  });

  it('lets a card go that left the board, and fades in one that arrived from nowhere', () => {
    const before = places(seen('a', build, 0));
    const after = places(seen('b', build, 0));
    expect(planRearrangement(before, after, everywhere)).toEqual([
      { kind: 'appear', key: 'b' },
      { kind: 'leave', key: 'a' },
    ]);
  });

  it('leaves first entries, columns just opened and gallery arrivals to their own motion', () => {
    const after = places(
      seen('entering', build, 0, { entering: true }),
      seen('revealed', opened, 0),
      seen('gallery', build, 0, { flow: false }),
    );
    expect(planRearrangement(new Map(), after, everywhere)).toEqual([]);
  });

  it('leaves a card a task screen opens from or lands in where it rests', () => {
    const before = places(seen('a', build, 0), seen('b', build, 92));
    const after = places(seen('b', build, 0), seen('a', review, 0));
    expect(
      planRearrangement(before, after, { ...everywhere, hidden: (key) => key === 'a' }),
    ).toEqual([{ kind: 'shift', key: 'b', dx: 0, dy: 92, lead: true }]);
  });

  it('only shifts what moves, and never flies or fades what is not a card', () => {
    const header = seen('zone:build:3', build, 0, { card: false });
    const stayed = seen('a', build, 40);
    expect(
      planRearrangement(
        places(header, stayed),
        places({ ...header, list: review, rect: { ...header.rect, y: 20 } }, stayed),
        everywhere,
      ),
    ).toEqual([]);
  });

  it('lets anything past a dozen changes happen at once', () => {
    const before = places(...Array.from({ length: 20 }, (_, i) => seen(`t${i}`, build, i * 92)));
    const plan = planRearrangement(before, new Map(), everywhere);
    expect(plan).toHaveLength(MAX_CHANGES);
  });
});
