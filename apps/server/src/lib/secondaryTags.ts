import type { ActivityChange, RefusedField, SecondaryTagChange } from '@throw/shared';

/** Per-tag arrival order, deliberately independent of hierarchy and the primary role. */
export function planSecondaryTags(
  current: ReadonlySet<string>,
  changes: readonly SecondaryTagChange[],
  tags: ReadonlyMap<string, { name: string }>,
) {
  const operations: SecondaryTagChange[] = [];
  const items: ActivityChange[] = [];
  const refused: RefusedField[] = [];
  for (const { tagId, present } of changes) {
    const existing = current.has(tagId);
    const tag = tags.get(tagId);
    items.push({
      field: 'secondaryTags',
      tagId,
      previous: existing ? tagId : null,
      requested: present ? tagId : null,
      previousName: existing ? (tag?.name ?? null) : null,
      requestedName: present ? (tag?.name ?? null) : null,
      applied: !!tag,
      ...(!tag ? { reason: 'invalid' as const } : {}),
    });
    if (!tag) refused.push({ field: 'secondaryTags', tagId, reason: 'invalid' });
    else if (present !== existing) operations.push({ tagId, present });
  }
  return { operations, items, refused };
}
