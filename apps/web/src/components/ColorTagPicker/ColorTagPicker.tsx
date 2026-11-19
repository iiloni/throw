import { COLORS, type Tag, tagPath } from '@throw/shared';
import { Check, ChevronLeft, ChevronRight, Slash } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { type ReactNode, useMemo, useRef, useState } from 'react';
import { AnimatedHeight } from '@/components/AnimatedHeight/AnimatedHeight';
import { colorName } from '@/components/ColorPicker/ColorPicker';
import { TagBadge } from '@/components/TagBadge/TagBadge';
import { TagIcon } from '@/components/TagIcon/TagIcon';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

/** The open branch: the swatches, the roots without a colour, or a tag's children. */
type Branch = null | 'uncolored' | string;

/**
 * Picks a task's primary tag by its colour, as Catch's colour picker does: each top-level tag
 * with a colour is a swatch. Picking one makes it primary and, when it has children, opens
 * them to pick a more specific one; leaving keeps what was picked. Top-level tags without a
 * colour sit one step away. A task has no colour of its own, so a colour no tag holds is not
 * offered.
 */
export function ColorTagPicker({
  tags,
  primaryTagId,
  onChange,
  className,
}: {
  tags: readonly Tag[];
  primaryTagId: string | null;
  onChange: (id: string | null) => void;
  className?: string;
}) {
  const [branch, setBranch] = useState<Branch>(null);
  const [direction, setDirection] = useState(1);
  const reducedMotion = useReducedMotion();
  const selected = tags.find((tag) => tag.id === primaryTagId);
  const selectedPath = useMemo(
    () => (primaryTagId ? tagPath(tags, primaryTagId).map((tag) => tag.id) : []),
    [tags, primaryTagId],
  );
  const selectedRoot = selected && tags.find((tag) => tag.id === selectedPath[0]);
  const current = tags.find((tag) => tag.id === branch);
  const parents = useMemo(() => new Set(tags.map((tag) => tag.parentId)), [tags]);
  const hasChildren = (id: string) => parents.has(id);
  // Moving between views replaces the focused control, so focus follows into the new view.
  const refocus = useRef(false);
  // A colour belongs to at most one top-level tag (`tagWriteIssue`).
  const roots = COLORS.flatMap((color) => {
    const root = tags.find((tag) => tag.parentId === null && tag.color === color);
    return root ? [{ root, color }] : [];
  });
  const uncolored = tags.some((tag) => tag.parentId === null && tag.color === null);
  const children = tags
    .filter((tag) =>
      branch === 'uncolored'
        ? tag.parentId === null && tag.color === null
        : tag.parentId === branch,
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  function open(next: Branch, travel: number) {
    refocus.current = true;
    setDirection(travel);
    setBranch(next);
  }
  /**
   * As in Catch, a tag is primary once picked, and one with children then opens them to pick
   * a more specific one. The primary or one of its ancestors only opens: picking it again
   * would replace a more specific primary with a broader one.
   */
  function select(tag: Tag) {
    if (!selectedPath.includes(tag.id)) {
      haptics.selection();
      onChange(tag.id);
    }
    if (hasChildren(tag.id)) open(tag.id, 1);
  }
  const slide = {
    enter: (travel: number) => ({ x: reducedMotion ? 0 : travel * 32, opacity: 0 }),
    visible: { x: 0, opacity: 1 },
    leave: (travel: number) => ({ x: reducedMotion ? 0 : -travel * 32, opacity: 0 }),
  };
  const view = (key: string, children: ReactNode, viewClassName?: string) => (
    <motion.div
      key={key}
      custom={direction}
      variants={slide}
      initial="enter"
      animate="visible"
      exit="leave"
      transition={{ duration: reducedMotion ? 0 : 0.16 }}
      className={viewClassName}
      ref={(element: HTMLDivElement | null) => {
        if (!element || !refocus.current) return;
        refocus.current = false;
        const target =
          element.querySelector<HTMLElement>('button[aria-pressed="true"]') ??
          element.querySelector<HTMLElement>('button');
        target?.focus({ preventScroll: true });
      }}
    >
      {children}
    </motion.div>
  );
  const badge = (
    <div className="flex min-h-7 min-w-0 justify-center">
      {selected && <TagBadge tag={selected} tags={tags} primary interactive={false} morph />}
    </div>
  );

  return (
    <fieldset className={cn('min-w-0 overflow-hidden', className)}>
      <legend className="sr-only">Primary tag</legend>
      <AnimatedHeight anchor="top">
        <AnimatePresence initial={false} mode="wait" custom={direction}>
          {branch === null
            ? view(
                'colors',
                <>
                  <div className="px-3 pt-2">{badge}</div>
                  <div className="grid grid-cols-6 justify-items-center gap-2 p-3">
                    <Swatch
                      label="No colour tag"
                      pressed={primaryTagId === null}
                      onClick={() => {
                        if (primaryTagId === null) return;
                        haptics.selection();
                        onChange(null);
                      }}
                    >
                      <Slash className="size-4" aria-hidden />
                    </Swatch>
                    {roots.map(({ root, color }) => (
                      <Swatch
                        key={root.id}
                        color={color}
                        label={`${colorName(color)}: ${root.name}`}
                        pressed={selectedRoot?.id === root.id}
                        onClick={() => select(root)}
                      >
                        <TagIcon name={root.icon} className="size-4" />
                      </Swatch>
                    ))}
                  </div>
                  {uncolored && (
                    <div className="px-3 pb-1">
                      <button
                        type="button"
                        onClick={() => open('uncolored', 1)}
                        className="flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-sm outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Tags without a colour
                        <ChevronRight className="size-4" aria-hidden />
                      </button>
                    </div>
                  )}
                </>,
              )
            : view(
                'tags',
                <>
                  <div className="mb-2 grid grid-cols-[4.5rem_minmax(0,1fr)_4.5rem] items-center border-foreground/10 border-b pb-2">
                    <button
                      type="button"
                      aria-label={current ? `Back from ${current.name}` : 'Back to colours'}
                      onClick={() =>
                        open(
                          current
                            ? (current.parentId ?? (current.color ? null : 'uncolored'))
                            : null,
                          -1,
                        )
                      }
                      className="flex min-h-11 items-center gap-1 justify-self-start rounded-xl px-2 text-muted-foreground text-sm outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ChevronLeft className="size-4 shrink-0" aria-hidden />
                      <span>Back</span>
                    </button>
                    {badge}
                  </div>
                  <AnimatePresence initial={false} mode="wait" custom={direction}>
                    {view(
                      branch,
                      children.map((tag) => {
                        const chosen = tag.id === primaryTagId;
                        const path = tagPath(tags, tag.id);
                        return (
                          <button
                            type="button"
                            key={tag.id}
                            aria-pressed={chosen}
                            aria-label={path.map((item) => item.name).join(' / ')}
                            onClick={() => select(tag)}
                            className={cn(
                              'flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring',
                              chosen && 'bg-foreground/[0.08] font-medium',
                            )}
                          >
                            <TagIcon name={path[0]?.icon} className="size-4 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                            {chosen && <Check className="size-4 shrink-0" aria-hidden />}
                            {hasChildren(tag.id) && (
                              <ChevronRight className="size-4 shrink-0" aria-hidden />
                            )}
                          </button>
                        );
                      }),
                    )}
                  </AnimatePresence>
                </>,
                'px-3',
              )}
        </AnimatePresence>
      </AnimatedHeight>
    </fieldset>
  );
}

function Swatch({
  color,
  label,
  pressed,
  onClick,
  children,
}: {
  color?: Tag['color'];
  label: string;
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.button
      type="button"
      data-color={color ?? undefined}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      whileTap={reduced ? undefined : { scale: 0.85 }}
      transition={springs.snappy}
      onClick={onClick}
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-full border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        color ? 'bg-tint text-tint-accent' : 'bg-card text-muted-foreground',
        pressed ? 'border-foreground/70 ring-2 ring-foreground/15' : 'border-foreground/10',
      )}
    >
      {children}
    </motion.button>
  );
}
