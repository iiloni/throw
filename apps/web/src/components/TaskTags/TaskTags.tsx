import { memo } from 'react';
import { Hint } from '@/components/Hint/Hint';
import { type BadgeTag, TagBadge } from '@/components/TagBadge/TagBadge';
import { cn } from '@/lib/utils';

/** How many badges a card shows before counting the rest, so a card stays one quiet row. */
export const CARD_BADGES = 3;

/**
 * Port of Catch's NoteTags, kept independent of collections for reuse by later screens.
 * Memoised, as every card on a board draws one and the board re-renders its cards often.
 */
export const TaskTags = memo(function TaskTags({
  tags,
  primaryTagId,
  secondaryTagIds,
  interactive = true,
  card = false,
  colored = true,
  className,
}: {
  tags: readonly BadgeTag[];
  primaryTagId: string | null;
  secondaryTagIds: readonly string[];
  interactive?: boolean;
  /**
   * On a board card: not a landmark of its own, not interactive, without blur on the opaque
   * card, and at most `CARD_BADGES` badges with a count of the rest.
   */
  card?: boolean;
  /** Off on the workspace board, where tag colors mean different things per project. */
  colored?: boolean;
  className?: string;
}) {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  const primary = primaryTagId ? byId.get(primaryTagId) : undefined;
  const secondary = [...new Set(secondaryTagIds)].flatMap((id) => {
    const tag = byId.get(id);
    return tag && id !== primaryTagId ? [tag] : [];
  });
  if (!primary && !secondary.length) return null;
  const all = [...(primary ? [primary] : []), ...secondary];
  const shown = card ? all.slice(0, CARD_BADGES) : all;
  const hidden = all.length - shown.length;
  const badges = (
    <>
      {shown.map((tag) => (
        <TagBadge
          key={tag.id}
          tag={tag}
          tags={tags}
          primary={tag === primary}
          interactive={interactive && !card}
          colored={colored}
          flat={card}
        />
      ))}
      {hidden > 0 && (
        // The count says how many, the hint which: on screen and to a screen reader.
        <Hint
          label={all
            .slice(shown.length)
            .map((tag) => tag.name)
            .join(', ')}
          describe
        >
          <span className="text-foreground/55 text-xs tabular-nums">+{hidden}</span>
        </Hint>
      )}
    </>
  );
  const layout = cn('flex min-w-0 flex-wrap items-center gap-1.5', className);
  return card ? (
    <div className={layout}>{badges}</div>
  ) : (
    <section aria-label="Task tags" className={layout}>
      {badges}
    </section>
  );
});
