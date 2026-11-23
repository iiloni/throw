import type { Tag } from '@throw/shared';
import { useId } from 'react';
import { Hint } from '@/components/Hint/Hint';
import { TagIcon } from '@/components/TagIcon/TagIcon';
import { TagTree } from '@/components/TagTree/TagTree';
import { haptics } from '@/lib/haptics';

/**
 * Catch's searchable tree of secondary tags. The primary tag is picked by its color beside
 * it; a tag may hold both roles (data model, "Tags"), so the primary is only marked here.
 */
export function TagPicker({
  tags,
  primaryTagId,
  secondaryTagIds,
  onChange,
}: {
  tags: readonly Tag[];
  primaryTagId: string | null;
  secondaryTagIds: readonly string[];
  onChange: (id: string, present: boolean) => void;
}) {
  const marker = useId();
  return (
    <section aria-label="Secondary tags" className="flex min-h-0 min-w-0 flex-1 flex-col">
      {!tags.length ? (
        <p className="px-1 py-3 text-muted-foreground text-sm">
          No tags yet. Create a tag to organise this project.
        </p>
      ) : (
        <TagTree
          tags={tags}
          searchPosition="bottom"
          className="min-h-0 max-h-[min(20rem,45dvh)] flex-1"
          renderTag={(tag, path) => {
            const label = path.map((item) => item.name).join(' / ');
            const root = path[0] ?? tag;
            return (
              <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl px-2 hover:bg-foreground/5 has-focus-visible:ring-2 has-focus-visible:ring-ring">
                <span
                  data-color={root.color ?? undefined}
                  className={root.color ? 'text-tint-accent' : 'text-muted-foreground'}
                >
                  <TagIcon name={root.icon} className="size-4" />
                </span>
                {/* The tree shows the path; the checkbox is named by it. */}
                <Hint label={label} whenTruncated>
                  <span className="min-w-0 flex-1 truncate text-sm">{tag.name}</span>
                </Hint>
                {tag.id === primaryTagId && (
                  <span id={marker} className="text-muted-foreground text-xs">
                    Primary
                  </span>
                )}
                <input
                  type="checkbox"
                  aria-label={label}
                  aria-describedby={tag.id === primaryTagId ? marker : undefined}
                  checked={secondaryTagIds.includes(tag.id)}
                  onChange={(event) => {
                    haptics.toggle();
                    onChange(tag.id, event.target.checked);
                  }}
                  className="size-4 shrink-0 accent-brand"
                />
              </label>
            );
          }}
        />
      )}
    </section>
  );
}
