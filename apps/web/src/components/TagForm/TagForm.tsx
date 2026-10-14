import { COLORS, TAG_ICONS, type Tag, tagPath, tagSubtreeIds, tagTree } from '@throw/shared';
import { type FormEvent, useId, useMemo, useRef, useState } from 'react';
import { BottomSheet } from '@/components/BottomSheet/BottomSheet';
import { TAG_ICON_LABELS, TagIcon } from '@/components/TagIcon/TagIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createTag, updateTag } from '@/lib/tags';
import { cn } from '@/lib/utils';

/** Catch's tag editor, adapted to project ownership and Throw's shared sheet. */
export function TagForm({
  projectId,
  tags,
  initial,
  onDone,
}: {
  projectId: string;
  tags: readonly Tag[];
  initial: { tag?: Tag; parentId: string | null };
  onDone: () => void;
}) {
  const nameId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial.tag?.name ?? '');
  const [parentId, setParentId] = useState(initial.parentId);
  const [color, setColor] = useState<Tag['color']>(initial.tag?.color ?? null);
  const [icon, setIcon] = useState<Tag['icon']>(initial.tag?.icon ?? null);
  const [iconSearch, setIconSearch] = useState('');
  const [error, setError] = useState('');
  const parents = useMemo(() => {
    const excluded = initial.tag ? tagSubtreeIds(tags, initial.tag.id) : new Set<string>();
    return tagTree(tags).filter(({ tag }) => !excluded.has(tag.id));
  }, [tags, initial.tag]);
  const usedColors = new Set(
    tags
      .filter((tag) => tag.id !== initial.tag?.id)
      .flatMap((tag) => (tag.color ? [tag.color] : [])),
  );
  function save(event: FormEvent) {
    event.preventDefault();
    try {
      const fields = {
        name,
        parentId,
        color: parentId ? null : color,
        icon: parentId ? null : icon,
      };
      if (initial.tag) updateTag(initial.tag.id, fields);
      else createTag(projectId, fields);
      onDone();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Check the tag details');
    }
  }
  return (
    <BottomSheet
      open
      initialFocusRef={nameRef}
      onOpenChange={(open) => {
        if (!open) onDone();
      }}
      title={initial.tag ? 'Edit tag' : 'New tag'}
    >
      <form onSubmit={save} className="flex min-w-0 flex-col gap-4 pb-2">
        <p className="text-sm text-muted-foreground">
          {parentId
            ? 'Inherits its root’s colour and icon.'
            : 'A primary tag gives its task this root’s colour.'}
        </p>
        <label htmlFor={nameId} className="flex flex-col gap-1.5 text-sm font-medium">
          Name
          <Input
            id={nameId}
            ref={nameRef}
            value={name}
            required
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            className="h-11 rounded-xl"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
          Parent tag
          <select
            aria-label="Parent tag"
            value={parentId ?? ''}
            onChange={(event) => setParentId(event.target.value || null)}
            className="h-11 min-w-0 w-full rounded-xl border border-border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Top level</option>
            {parents.map(({ tag }) => (
              <option key={tag.id} value={tag.id}>
                {tagPath(tags, tag.id)
                  .map((item) => item.name)
                  .join(' / ')}
              </option>
            ))}
          </select>
        </label>
        {!parentId && (
          <>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Colour</legend>
              <div className="grid grid-cols-6 justify-items-center gap-2">
                <button
                  type="button"
                  aria-label="No colour"
                  aria-pressed={color === null}
                  onClick={() => setColor(null)}
                  className={cn(
                    'size-10 rounded-full border text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    color === null && 'ring-2 ring-foreground/40',
                  )}
                >
                  None
                </button>
                {COLORS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    data-color={value}
                    aria-label={
                      value === 'dark-blue'
                        ? 'Indigo'
                        : value.charAt(0).toUpperCase() + value.slice(1)
                    }
                    aria-pressed={color === value}
                    disabled={usedColors.has(value)}
                    title={usedColors.has(value) ? 'Already used by another root' : value}
                    onClick={() => setColor(value)}
                    className={cn(
                      'size-10 rounded-full border border-foreground/10 bg-tint outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-25',
                      color === value && 'ring-2 ring-foreground/50',
                    )}
                  />
                ))}
              </div>
            </fieldset>
            <fieldset className="min-w-0">
              <legend className="mb-2 text-sm font-medium">Icon</legend>
              <Input
                aria-label="Find icons"
                placeholder="Find icons"
                value={iconSearch}
                onChange={(event) => setIconSearch(event.target.value)}
                className="mb-2 h-10 rounded-xl"
              />
              <div className="grid max-h-36 grid-cols-6 gap-1 overflow-y-auto overscroll-contain p-1">
                <button
                  type="button"
                  aria-label="No icon"
                  aria-pressed={icon === null}
                  onClick={() => setIcon(null)}
                  className={cn(
                    'flex h-11 items-center justify-center rounded-xl text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    icon === null && 'bg-accent',
                  )}
                >
                  None
                </button>
                {TAG_ICONS.filter(
                  (value) =>
                    TAG_ICON_LABELS[value].toLowerCase().includes(iconSearch.toLowerCase()) ||
                    value.replaceAll('-', ' ').includes(iconSearch.toLowerCase()),
                ).map((value) => (
                  <button
                    type="button"
                    key={value}
                    aria-label={TAG_ICON_LABELS[value]}
                    aria-pressed={icon === value}
                    title={TAG_ICON_LABELS[value]}
                    onClick={() => setIcon(value)}
                    className={cn(
                      'flex h-11 items-center justify-center rounded-xl outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring',
                      icon === value && 'bg-accent',
                    )}
                  >
                    <TagIcon name={value} className="size-5" />
                  </button>
                ))}
              </div>
            </fieldset>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" className="h-11 rounded-full" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" className="h-11 rounded-full">
            Save tag
          </Button>
        </div>
      </form>
    </BottomSheet>
  );
}
