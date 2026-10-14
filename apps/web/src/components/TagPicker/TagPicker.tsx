import type { Tag } from '@throw/shared';
import { useId } from 'react';
import { TagIcon } from '@/components/TagIcon/TagIcon';
import { TagTree } from '@/components/TagTree/TagTree';

/** Catch's searchable tree, with independent primary/secondary roles for Throw tasks. */
export function TagPicker({
  tags,
  primaryTagId,
  secondaryTagIds,
  onPrimaryChange,
  onSecondaryChange,
}: {
  tags: readonly Tag[];
  primaryTagId: string | null;
  secondaryTagIds: readonly string[];
  onPrimaryChange: (id: string | null) => void;
  onSecondaryChange: (id: string, present: boolean) => void;
}) {
  const group = useId();
  return (
    <section aria-label="Choose task tags" className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Primary sets the colour. Secondary tags add context.
        </p>
        <button
          type="button"
          disabled={primaryTagId === null}
          onClick={() => onPrimaryChange(null)}
          className="min-h-11 shrink-0 rounded-xl px-3 text-sm text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          Clear primary
        </button>
      </div>
      {!tags.length ? (
        <p className="py-4 text-sm text-muted-foreground">
          No tags yet. Create a tag to organise this project.
        </p>
      ) : (
        <>
          <div className="mb-2 flex justify-end gap-4 pr-2 text-xs text-muted-foreground">
            <span>Primary</span>
            <span>Secondary</span>
          </div>
          <TagTree
            tags={tags}
            className="max-h-80"
            renderTag={(tag, path) => {
              const label = path.map((item) => item.name).join(' / ');
              const root = path[0] ?? tag;
              return (
                <div className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl px-2 hover:bg-foreground/5">
                  <span
                    data-color={root.color ?? undefined}
                    className={root.color ? 'text-tint-accent' : 'text-muted-foreground'}
                  >
                    <TagIcon name={root.icon} className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm" title={label}>
                    {tag.name}
                  </span>
                  <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg has-focus-visible:ring-2 has-focus-visible:ring-ring">
                    <input
                      type="radio"
                      name={group}
                      aria-label={`Primary: ${label}`}
                      checked={primaryTagId === tag.id}
                      onChange={() => onPrimaryChange(tag.id)}
                      className="size-4 accent-primary"
                    />
                  </label>
                  <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg has-focus-visible:ring-2 has-focus-visible:ring-ring">
                    <input
                      type="checkbox"
                      aria-label={`Secondary: ${label}`}
                      checked={secondaryTagIds.includes(tag.id)}
                      onChange={(event) => onSecondaryChange(tag.id, event.target.checked)}
                      className="size-4 accent-primary"
                    />
                  </label>
                </div>
              );
            }}
          />
        </>
      )}
    </section>
  );
}
