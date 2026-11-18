import type { Tag } from '@throw/shared';
import { TagBadge } from '@/components/TagBadge/TagBadge';

/** Port of Catch's NoteTags, kept independent of collections for reuse by later screens. */
export function TaskTags({
  tags,
  primaryTagId,
  secondaryTagIds,
  interactive = true,
}: {
  tags: readonly Tag[];
  primaryTagId: string | null;
  secondaryTagIds: readonly string[];
  interactive?: boolean;
}) {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  const primary = primaryTagId ? byId.get(primaryTagId) : undefined;
  const secondary = [...new Set(secondaryTagIds)].flatMap((id) => {
    const tag = byId.get(id);
    return tag && id !== primaryTagId ? [tag] : [];
  });
  if (!primary && !secondary.length) return null;
  return (
    <section aria-label="Task tags" className="flex min-w-0 flex-wrap items-center gap-1.5">
      {primary && <TagBadge tag={primary} tags={tags} primary interactive={interactive} />}
      {secondary.map((tag) => (
        <TagBadge key={tag.id} tag={tag} tags={tags} interactive={interactive} />
      ))}
    </section>
  );
}
