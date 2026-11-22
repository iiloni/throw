import { comparePositions } from '@throw/shared';
import { expect, test } from 'vitest';
import { compareStructurePositions, planSiblingAppend, planSiblingMove } from './structureOrder';

const a = { id: 'a', position: 'a0' };
const b = { id: 'b', position: 'a1' };
const c = { id: 'c', position: 'a2' };

test('fractional placement updates only the moved sibling between distinct bounds', () => {
  const changes = planSiblingMove([a, b, c], c.id, { side: 'after', neighborId: a.id });
  expect(changes).toEqual([{ id: c.id, position: 'a0V' }]);
  expect(planSiblingMove([a, b, c], c.id, { side: 'after', neighborId: c.id })).toBeNull();
  expect(planSiblingMove([a, b, c], c.id, { side: 'after', neighborId: 'foreign' })).toBeNull();
});

test('reindexing places items exactly when app writers produced equal or legacy positions', () => {
  const tied = { ...b, position: a.position };
  const changes = planSiblingMove([a, tied, c], c.id, { side: 'before', neighborId: tied.id });
  const rows = [a, tied, c].map((row) => changes!.find(({ id }) => row.id === id) ?? row);
  expect(rows.sort(compareStructurePositions).map(({ id }) => id)).toEqual(['a', 'c', 'b']);
  const legacy = { id: 'legacy', position: 'zzz' };
  const appended = planSiblingAppend([a, legacy]);
  expect(appended.reindex).toContainEqual({ id: legacy.id, position: 'a1' });
  expect(appended.position).toBe('a2');
});

test('moving among alphabetical tags gives them positions in the requested order', () => {
  const siblings = [a, b, c].map(({ id }) => ({ id, position: null }));
  const changes = planSiblingMove(siblings, c.id, { side: 'before', neighborId: a.id })!;
  expect(
    changes
      .sort((left, right) => comparePositions(left.position, right.position))
      .map(({ id }) => id),
  ).toEqual(['c', 'a', 'b']);
});
