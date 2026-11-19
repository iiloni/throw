import { type BadgeTag, TagBadge } from '@/components/TagBadge/TagBadge';
import { cn } from '@/lib/utils';

/** Port of Catch's NoteTags, kept independent of collections for reuse by later screens. */
export function TaskTags({
  tags,
  primaryTagId,
  secondaryTagIds,
  interactive = true,
  region = true,
  className,
}: {
  tags: readonly BadgeTag[];
  primaryTagId: string | null;
  secondaryTagIds: readonly string[];
  interactive?: boolean;
  /** A landmark of its own; off where it repeats, as on every card of a board. */
  region?: boolean;
  className?: string;
}) {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  const primary = primaryTagId ? byId.get(primaryTagId) : undefined;
  const secondary = [...new Set(secondaryTagIds)].flatMap((id) => {
    const tag = byId.get(id);
    return tag && id !== primaryTagId ? [tag] : [];
  });
  if (!primary && !secondary.length) return null;
  const badges = (
    <>
      {primary && <TagBadge tag={primary} tags={tags} primary interactive={interactive} />}
      {secondary.map((tag) => (
        <TagBadge key={tag.id} tag={tag} tags={tags} interactive={interactive} />
      ))}
    </>
  );
  const layout = cn('flex min-w-0 flex-wrap items-center gap-1.5', className);
  return region ? (
    <section aria-label="Task tags" className={layout}>
      {badges}
    </section>
  ) : (
    <div className={layout}>{badges}</div>
  );
}
