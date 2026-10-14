import { expect, it } from 'vitest';
import { planSecondaryTags } from './secondaryTags';

const tags = new Map([
  ['a', { name: 'Product' }],
  ['b', { name: 'Mobile' }],
]);
it('two devices adding different secondary tags both survive, including ancestor/descendant selections', () => {
  const first = planSecondaryTags(new Set(), [{ tagId: 'a', present: true }], tags);
  const second = planSecondaryTags(new Set(['a']), [{ tagId: 'b', present: true }], tags);
  expect(first.operations).toEqual([{ tagId: 'a', present: true }]);
  expect(second.operations).toEqual([{ tagId: 'b', present: true }]);
  expect(second.items).toEqual([
    {
      field: 'secondaryTags',
      tagId: 'b',
      previous: null,
      requested: 'b',
      previousName: null,
      requestedName: 'Mobile',
      applied: true,
    },
  ]);
});
it('records current names on removal, skips already-applied operations and refuses missing tags', () => {
  const plan = planSecondaryTags(
    new Set(['a', 'b']),
    [
      { tagId: 'a', present: false },
      { tagId: 'b', present: true },
      { tagId: 'gone', present: false },
    ],
    tags,
  );
  expect(plan.operations).toEqual([{ tagId: 'a', present: false }]);
  expect(plan.items[0]).toMatchObject({
    previous: 'a',
    previousName: 'Product',
    requested: null,
    requestedName: null,
    applied: true,
  });
  expect(plan.items[2]).toMatchObject({ tagId: 'gone', applied: false, reason: 'invalid' });
  expect(plan.refused).toEqual([{ field: 'secondaryTags', tagId: 'gone', reason: 'invalid' }]);
  expect(planSecondaryTags(new Set(), [{ tagId: 'a', present: false }], tags).operations).toEqual(
    [],
  );
});
