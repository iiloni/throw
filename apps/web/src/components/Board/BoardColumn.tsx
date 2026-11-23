import type { Color } from '@throw/shared';
import { ChevronsRightLeft } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { Hint } from '@/components/Hint/Hint';
import { entryDelay, useEntryMotion } from '@/lib/entryMotion';
import { cn } from '@/lib/utils';
import { drag, makingWay } from './drag';
import { StatusGlyph } from './glyphs';
import type { Category } from './model';
import { useBoardSettings } from './state';

/** Catch's deck: the content swapped in by folding fades in once the column has mostly resized. */
const CONTENT_FADE = { duration: 0.25, delay: 0.15, ease: 'easeOut' } as const;

type Props = {
  color?: Color | null;
  /** The status id, or the category target on the workspace board, that a strip sends to. */
  columnId: string;
  name: string;
  category: Category;
  count: number;
  collapsed: boolean;
  onToggle: (collapsed: boolean) => void;
  /** Its place across the board, for the diagonal wave a strip enters in. */
  index: number;
  /** The open column's size. A strip is always `w-16`. */
  className: string;
  /**
   * The open column. `revealed` is true when it was opened in this document rather than shown
   * from the start: its cards then fade in with it and skip their entry (ADR 0013).
   */
  children: (revealed: boolean) => ReactNode;
};

/**
 * A desktop column that folds to a strip and opens again, as a column of Catch's deck does.
 * The root keeps its surface and size through both states and springs between widths; only
 * what is inside is swapped, and fades in once the column has mostly resized, so no card is
 * seen squeezed into a strip's width. The status stripe stays on the root through both states.
 *
 * A strip shows no cards, so a held card is sent to it (ADR 0008): it takes the card at its
 * column's default place without opening or moving under the pointer.
 */
export function BoardColumn({
  color,
  columnId,
  name,
  category,
  count,
  collapsed,
  onToggle,
  index,
  className,
  children,
}: Props) {
  const [settings] = useBoardSettings();
  const reduced = useReducedMotion();
  const [was, setWas] = useState(collapsed);
  const [toggled, setToggled] = useState(false);
  if (collapsed !== was) {
    setWas(collapsed);
    setToggled(true);
  }
  // The control that folded or opened the column goes as it does; focus moves to the one that
  // takes its place, so a keyboard keeps its place on the board.
  const root = useRef<HTMLElement>(null);
  const refocus = useRef(false);
  useLayoutEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    root.current
      ?.querySelector<HTMLElement>('[data-column-toggle]')
      ?.focus({ preventScroll: true });
  });
  return (
    <section
      ref={root}
      onClickCapture={(event) => {
        const control =
          event.target instanceof Element && event.target.closest('[data-column-toggle]');
        refocus.current = Boolean(control) && document.activeElement === control;
      }}
      // Folded, the strip is all there is of the column; open, the column names itself.
      aria-label={collapsed ? name : undefined}
      data-column={columnId}
      data-column-color={color ?? undefined}
      data-collapsed={collapsed ? '' : undefined}
      data-surface={settings.surfaces ? '' : undefined}
      className={cn(
        // Folds and opens on the transition in styles.css (`.board-column[data-column]`).
        'board-column group/column relative mt-[calc(var(--safe-top)+1.25rem)] mb-6 flex min-h-0 shrink-0 flex-col rounded-3xl',
        collapsed ? 'min-w-16 max-w-16 grow-0 basis-16' : className,
      )}
    >
      {color && (
        <span
          aria-hidden
          data-column-stripe=""
          className="pointer-events-none absolute inset-x-3 top-1 h-1 rounded-full bg-[var(--column-accent)]"
        />
      )}
      <motion.div
        key={collapsed ? 'collapsed' : 'open'}
        className="flex min-h-0 flex-1 flex-col"
        initial={toggled && !reduced ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={reduced ? { duration: 0 } : CONTENT_FADE}
      >
        {collapsed ? (
          <ColumnStrip
            columnId={columnId}
            name={name}
            category={category}
            count={count}
            index={index}
            revealed={toggled}
            onExpand={() => onToggle(false)}
          />
        ) : (
          children(toggled)
        )}
      </motion.div>
    </section>
  );
}

/**
 * A folded column: its status rotated as Catch's deck draws it, with its glyph and count. The
 * whole strip opens it, and under a held card it is the status's dropzone.
 */
function ColumnStrip({
  columnId,
  name,
  category,
  count,
  index,
  revealed,
  onExpand,
}: {
  columnId: string;
  name: string;
  category: Category;
  count: number;
  index: number;
  /** Folded in this document: it fades in with the column and skips its entry. */
  revealed: boolean;
  onExpand: () => void;
}) {
  const held = drag.use();
  const over =
    makingWay(held) && held.target?.kind === 'status' && held.target.statusId === columnId;
  const entry = useEntryMotion(`column:${columnId}`, true, entryDelay(index), revealed);
  return (
    <motion.div className="flex min-h-0 flex-1 flex-col" style={entry}>
      <Hint label={`Expand ${name} column`} side="bottom">
        <button
          type="button"
          aria-label={`Expand ${name} column`}
          aria-expanded={false}
          data-column-toggle=""
          data-drop-status={columnId}
          data-status-home={columnId}
          data-over={over ? '' : undefined}
          onClick={onExpand}
          className={cn(
            'board-column flex min-h-0 flex-1 flex-col items-center gap-3 rounded-3xl pt-[1.1875rem] pb-4 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60',
            over && 'text-foreground',
          )}
        >
          <StatusGlyph
            category={category}
            className="size-4 text-[color:var(--column-accent,currentColor)]"
          />
          <span className="min-h-0 truncate font-display font-semibold text-base text-[color:var(--column-label,var(--foreground))] tracking-[-0.01em] [writing-mode:vertical-rl]">
            {name}
          </span>
          <span className="rounded-full bg-foreground/[0.07] px-1.5 py-0.5 text-xs tabular-nums">
            {count}
          </span>
        </button>
      </Hint>
    </motion.div>
  );
}

/**
 * The open column's header, which folds it, as Catch's deck does: the whole header is the
 * control, so it needs no hover to find on a mouse and is a large target on a touch screen.
 * While a card is held it is only a header.
 */
export function ColumnHeader({
  name,
  count,
  category,
  onCollapse,
}: {
  name: string;
  count: number;
  /** Shown beside the name on category columns and colored status columns. */
  category?: Category;
  onCollapse: () => void;
}) {
  const held = drag.use();
  const holding = makingWay(held);
  return (
    <div className="flex h-14 shrink-0 items-center px-2.5">
      <h2 className="min-w-0 flex-1">
        <Hint label={`Collapse ${name} column`} side="bottom" disabled={holding}>
          <button
            type="button"
            aria-label={`Collapse ${name} column`}
            aria-expanded
            data-column-toggle=""
            onClick={onCollapse}
            className={cn(
              'group/header flex h-11 w-full items-center gap-2.5 rounded-2xl pr-2 pl-2.5 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/60',
              !holding && 'hover:bg-foreground/[0.04]',
            )}
          >
            {category && (
              <StatusGlyph
                category={category}
                className="size-4 text-[color:var(--column-accent,var(--muted-foreground))]"
              />
            )}
            <span className="truncate font-display font-semibold text-lg text-[color:var(--column-label,currentColor)] tracking-[-0.01em]">
              {name}
            </span>
            <span className="rounded-full bg-foreground/[0.07] px-2 py-0.5 text-muted-foreground text-xs tabular-nums">
              {count}
            </span>
            <span className="flex-1" />
            <ChevronsRightLeft
              aria-hidden
              className={cn(
                'size-4 shrink-0 text-muted-foreground transition-opacity group-hover/header:text-foreground',
                holding && 'opacity-0',
              )}
            />
          </button>
        </Hint>
      </h2>
    </div>
  );
}
