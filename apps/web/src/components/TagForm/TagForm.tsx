import { COLORS, TAG_ICONS, type Tag, tagPath, tagSubtreeIds, tagTree } from '@throw/shared';
import { Slash, X } from 'lucide-react';
import { type FormEvent, type RefObject, useId, useMemo, useState } from 'react';
import { colorName } from '@/components/ColorPicker/ColorPicker';
import { Hint } from '@/components/Hint/Hint';
import { SearchSelect, type SelectOption } from '@/components/SearchSelect/SearchSelect';
import { Swatch } from '@/components/Swatch/Swatch';
import { TAG_ICON_LABELS, TagIcon } from '@/components/TagIcon/TagIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { haptics } from '@/lib/haptics';
import { createTag, updateTag } from '@/lib/tags';
import { cn } from '@/lib/utils';

type TagEditorProps = {
  projectId: string;
  tags: readonly Tag[];
  /** A new tag may start with a color, such as one no root holds yet. */
  initial: { tag?: Tag; parentId: string | null; color?: Tag['color'] };
  onDone: () => void;
  /** Called with a new tag's id, so the picker that asked for it can assign it. */
  onCreated?: (id: string) => void;
};

/**
 * Catch's tag editor, adapted to project ownership. It is content only, with no gestures or
 * Back handling, so the drawer or a dialog can host it.
 */
export function TagEditor({
  projectId,
  tags,
  initial,
  onDone,
  onCreated,
  nameRef,
}: TagEditorProps & { nameRef?: RefObject<HTMLInputElement | null> }) {
  const nameId = useId();
  const parentLabelId = useId();
  const [name, setName] = useState(initial.tag?.name ?? '');
  const [parentId, setParentId] = useState(initial.parentId);
  const [color, setColor] = useState<Tag['color']>(
    initial.tag ? initial.tag.color : (initial.color ?? null),
  );
  const [icon, setIcon] = useState<Tag['icon']>(initial.tag?.icon ?? null);
  const [iconSearch, setIconSearch] = useState('');
  const [error, setError] = useState('');
  // A tag cannot go under itself or its own branch.
  const parents = useMemo(() => {
    const excluded = initial.tag ? tagSubtreeIds(tags, initial.tag.id) : new Set<string>();
    const options: SelectOption[] = [{ value: '', label: 'Top level' }];
    for (const { tag, depth } of tagTree(tags)) {
      if (excluded.has(tag.id)) continue;
      const path = tagPath(tags, tag.id);
      const root = path[0] ?? tag;
      options.push({
        value: tag.id,
        label: tag.name,
        detail:
          path
            .slice(0, -1)
            .map((ancestor) => ancestor.name)
            .join(' / ') || undefined,
        keywords: [path.map((ancestor) => ancestor.name).join(' / ')],
        depth,
        icon: (
          <span
            data-color={root.color ?? undefined}
            className={root.color ? 'text-tint-accent' : 'text-muted-foreground'}
          >
            <TagIcon name={root.icon} className="size-4 shrink-0" />
          </span>
        ),
      });
    }
    return options;
  }, [tags, initial.tag]);
  // Only roots hold a color, so each taken color has one owner, shown on its swatch.
  const colorOwners = new Map(
    tags.flatMap((tag) =>
      tag.id !== initial.tag?.id && tag.color ? [[tag.color, tag] as const] : [],
    ),
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
      else {
        const id = createTag(projectId, fields);
        onCreated?.(id);
      }
      haptics.success();
      onDone();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Check the tag details');
    }
  }
  return (
    <form onSubmit={save} className="flex min-w-0 flex-col gap-4 pb-2">
      <p className="text-sm text-muted-foreground">
        {parentId
          ? 'Inherits its root’s color and icon.'
          : 'A primary tag gives its task this root’s color.'}
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
      <div className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
        <span id={parentLabelId}>Parent tag</span>
        <SearchSelect
          labelId={parentLabelId}
          title="Parent tag"
          searchLabel="Search tags"
          emptyText="No tag matches."
          options={parents}
          value={parentId ?? ''}
          onChange={(value) => setParentId(value || null)}
        />
      </div>
      {!parentId && (
        <>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Color</legend>
            <div className="grid grid-cols-6 justify-items-center gap-2">
              <Swatch label="No color" pressed={color === null} onClick={() => setColor(null)}>
                <Slash className="size-4" aria-hidden />
              </Swatch>
              {COLORS.map((value) => {
                const owner = colorOwners.get(value);
                return (
                  <Swatch
                    key={value}
                    color={value}
                    label={colorName(value)}
                    hint={
                      owner
                        ? `${colorName(value)}: already used by ${owner.name}`
                        : colorName(value)
                    }
                    pressed={color === value}
                    unavailable={!!owner}
                    onClick={() => setColor(value)}
                  >
                    {owner && <TagIcon name={owner.icon} className="size-5 text-foreground" />}
                  </Swatch>
                );
              })}
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
              <Hint label="No icon">
                <button
                  type="button"
                  aria-label="No icon"
                  aria-pressed={icon === null}
                  onClick={() => setIcon(null)}
                  className={cn(
                    'flex h-11 items-center justify-center rounded-xl outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring',
                    icon === null && 'bg-accent',
                  )}
                >
                  <X className="size-4" aria-hidden />
                </button>
              </Hint>
              {TAG_ICONS.filter(
                (value) =>
                  TAG_ICON_LABELS[value].toLowerCase().includes(iconSearch.toLowerCase()) ||
                  value.replaceAll('-', ' ').includes(iconSearch.toLowerCase()),
              ).map((value) => (
                <Hint key={value} label={TAG_ICON_LABELS[value]}>
                  <button
                    type="button"
                    aria-label={TAG_ICON_LABELS[value]}
                    aria-pressed={icon === value}
                    onClick={() => setIcon(value)}
                    className={cn(
                      'flex h-11 items-center justify-center rounded-xl outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring',
                      icon === value && 'bg-accent',
                    )}
                  >
                    <TagIcon name={value} className="size-5" />
                  </button>
                </Hint>
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
  );
}
