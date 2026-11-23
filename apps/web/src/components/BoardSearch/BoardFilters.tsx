import { SIZES, type Size, sizeLabel, type Tag as TagRow } from '@throw/shared';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Check,
  ChevronRight,
  Folder,
  type LucideIcon,
  Ruler,
  Search,
  Tags,
  X,
} from 'lucide-react';
import { AnimatePresence, animate, motion, useIsPresent, useReducedMotion } from 'motion/react';
import {
  forwardRef,
  type ReactNode,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { z } from 'zod';
import {
  type BoardFilter,
  type BoardSort,
  type FacetCounts,
  facetCounts,
  isFiltering,
  type SortDirection,
  type SortField,
  sortOrder,
  type TagMatch,
} from '@/components/Board/filter';
import type { Project } from '@/components/Board/model';
import {
  type BoardState,
  board,
  clearFilters,
  current,
  narrowed,
  setFilter,
  setSort,
} from '@/components/Board/state';
import { ProjectIcon } from '@/components/ProjectIcon/ProjectIcon';
import { SegmentedTabs } from '@/components/SegmentedTabs/SegmentedTabs';
import { TagBadge } from '@/components/TagBadge/TagBadge';
import { TagIcon } from '@/components/TagIcon/TagIcon';
import { TagTree } from '@/components/TagTree/TagTree';
import { ScrollArea, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { usePersistentState } from '@/lib/storage';
import { indexTagTree } from '@/lib/tagTreeIndex';
import { cn } from '@/lib/utils';

type SortChoice = 'priority' | SortField;
const SORT_FIELDS: { value: SortChoice; label: string }[] = [
  { value: 'priority', label: 'Priority' },
  { value: 'size', label: 'Size' },
  { value: 'created', label: 'Added' },
  { value: 'updated', label: 'Updated' },
];

/** Each field's directions, the one a field starts with first. */
const DIRECTIONS: Record<SortField, { value: SortDirection; label: string }[]> = {
  size: [
    { value: 'asc', label: 'Smallest' },
    { value: 'desc', label: 'Largest' },
  ],
  created: [
    { value: 'desc', label: 'Newest' },
    { value: 'asc', label: 'Oldest' },
  ],
  updated: [
    { value: 'desc', label: 'Most recent' },
    { value: 'asc', label: 'Least recent' },
  ],
};

export const SORT_NAMES: Record<Exclude<BoardSort, 'priority'>, string> = {
  'size-asc': 'Smallest first',
  'size-desc': 'Largest first',
  'created-desc': 'Newest first',
  'created-asc': 'Oldest first',
  'updated-desc': 'Recently updated first',
  'updated-asc': 'Least recently updated first',
};

const chipBase =
  'flex h-9 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring';
/** A toggle chip, filled while it is chosen. */
function chip(pressed: boolean) {
  return cn(
    chipBase,
    pressed
      ? 'bg-foreground text-background'
      : 'bg-foreground/[0.06] text-foreground/80 hover:bg-foreground/[0.1]',
  );
}

/**
 * The board's tags as the tag tree draws them. The board keeps a lighter tag than the synced
 * row; the tree only reads its place in the hierarchy, name, icon and color.
 */
function treeTags(project: Project): TagRow[] {
  return project.tags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    parentId: tag.parentId,
    icon: tag.icon ?? null,
    color: tag.color ?? null,
    workspaceId: '',
    projectId: project.id,
    position: 'position' in tag && typeof tag.position === 'string' ? tag.position : null,
  }));
}

const filterTabSchema = z.enum(['group', 'size', 'sort']);
/** The card's sections: `group` is a project board's tags, or the workspace board's projects. */
type FilterTab = z.infer<typeof filterTabSchema>;
const TAB_ORDER: FilterTab[] = ['group', 'size', 'sort'];

/** A tab's icon, with a dot while what it holds narrows or orders the board. */
function TabIcon({ icon: Icon, active }: { icon: LucideIcon; active: boolean }) {
  return (
    <span className="relative">
      <Icon className="size-4" aria-hidden />
      {active && (
        <span aria-hidden className="absolute -top-0.5 -right-1 size-1.5 rounded-full bg-brand" />
      )}
    </span>
  );
}

function toggleSizeFilter(filter: BoardFilter, size: Size) {
  haptics.selection();
  setFilter({
    sizes: filter.sizes.includes(size)
      ? filter.sizes.filter((value) => value !== size)
      : [...filter.sizes, size].sort(),
  });
}

function toggleTagFilter(filter: BoardFilter, id: string) {
  haptics.selection();
  setFilter({
    untagged: false,
    tagIds: filter.tagIds.includes(id)
      ? filter.tagIds.filter((value) => value !== id)
      : [...filter.tagIds, id],
  });
}

function SortControls({ sort }: { sort: BoardSort }) {
  const order = sortOrder(sort);
  const reduced = useReducedMotion();
  return (
    <div className="flex flex-col">
      <Choice
        label="Sort cards by"
        value={order?.field ?? 'priority'}
        options={SORT_FIELDS}
        onChange={(field) => {
          haptics.selection();
          setSort(field === 'priority' ? 'priority' : `${field}-${DIRECTIONS[field][0]!.value}`);
        }}
      />
      <AnimatePresence initial={false}>
        {order && (
          <motion.div
            key="direction"
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduced ? { duration: 0 } : springs.pane}
          >
            {/* One row for every field, so its pill slides to the new default. */}
            <Choice
              className="mt-1.5"
              label="Order"
              value={order.direction}
              options={DIRECTIONS[order.field]}
              onChange={(direction) => {
                haptics.selection();
                setSort(`${order.field}-${direction}`);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SizeControls({ filter, counts }: { filter: BoardFilter; counts: FacetCounts }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SIZES.map((size) => (
        <button
          key={size}
          type="button"
          aria-label={`Size ${sizeLabel(size)}, ${counts.sizes.get(size) ?? 0} tasks`}
          aria-pressed={filter.sizes.includes(size)}
          onClick={() => toggleSizeFilter(filter, size)}
          className={chip(filter.sizes.includes(size))}
        >
          {sizeLabel(size)}
          <span className="text-xs tabular-nums opacity-60">{counts.sizes.get(size) ?? 0}</span>
        </button>
      ))}
      <button
        type="button"
        aria-label={`Unsized, ${counts.sizes.get(null) ?? 0} tasks`}
        aria-pressed={filter.unsized}
        onClick={() => {
          haptics.selection();
          setFilter({ unsized: !filter.unsized });
        }}
        className={chip(filter.unsized)}
      >
        Unsized
        <span className="text-xs tabular-nums opacity-60">{counts.sizes.get(null) ?? 0}</span>
      </button>
    </div>
  );
}

function ProjectControls({
  members,
  projectId,
  counts,
}: {
  members: readonly Project[];
  projectId: string | null;
  /** Shown on the inline sidebar, where each project chip shows how many cards it leaves. */
  counts?: ReadonlyMap<string, number>;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {members.map((member) => {
        const on = projectId === member.id;
        return (
          <button
            key={member.id}
            type="button"
            data-color={member.color}
            aria-pressed={on}
            onClick={() => {
              haptics.selection();
              setFilter({ projectId: on ? null : member.id });
            }}
            className={cn(
              counts
                ? cn(
                    chipBase,
                    on
                      ? 'bg-tint text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--tint-accent)_45%,transparent)]'
                      : 'bg-foreground/[0.06] text-foreground/80 hover:bg-foreground/[0.1]',
                  )
                : chip(on),
              'max-w-full',
            )}
          >
            <ProjectIcon name={member.icon} className="size-4 shrink-0 text-tint-accent" />
            <span className="truncate">{member.name}</span>
            {counts && (
              <span className="text-xs tabular-nums opacity-60">{counts.get(member.id) ?? 0}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * What narrows and orders the board, one section at a time over Catch's tabs at the foot of
 * the card: a project board's tags or the workspace board's projects, sizes, and the sort. Each
 * choice applies to the board at once. Drawn in the desktop search's filter card and in the
 * phone's search page alike; the open section is remembered on the device.
 */
export function BoardFilters({ className }: { className?: string }) {
  const state = board.use();
  const data = current(state);
  const { project } = data;
  const { filter } = state;
  const workspace = project.members !== undefined;
  const counts = useMemo(
    () => facetCounts(data, filter, state.subtasksAsCards),
    [data, filter, state.subtasksAsCards],
  );
  const tags = useMemo(() => treeTags(project), [project]);
  const selected = new Set(filter.tagIds);
  const ids = useId();
  const [tab, setTab] = usePersistentState('throw-board-filter-tab', filterTabSchema, 'group');
  const [direction, setDirection] = useState(1);
  function selectTab(next: FilterTab | null) {
    if (!next || next === tab) return;
    haptics.selection();
    setDirection(TAB_ORDER.indexOf(next) > TAB_ORDER.indexOf(tab) ? 1 : -1);
    setTab(next);
  }
  const tabId = (value: FilterTab) => `${ids}-${value}-tab`;
  const viewId = (value: FilterTab) => `${ids}-${value}`;
  return (
    <div className={cn('flex min-h-0 flex-col gap-2', className)}>
      <FilterTabContents tab={tab}>
        <AnimatePresence initial={false} custom={direction}>
          <FilterTabView
            key={tab}
            id={viewId(tab)}
            scroll={tab !== 'group' || workspace}
            labelledBy={tabId(tab)}
            direction={direction}
          >
            {tab === 'sort' && <SortControls sort={state.sort} />}
            {tab === 'size' && <SizeControls filter={filter} counts={counts} />}
            {tab === 'group' && workspace && (
              <ProjectControls members={project.members ?? []} projectId={filter.projectId} />
            )}
            {tab === 'group' && !workspace && (
              <div className="flex flex-col">
                {tags.length > 0 ? (
                  <TagTree
                    tags={tags}
                    searchPosition="bottom"
                    searchAccessory={(focused) => (
                      <AnimatePresence initial={false}>
                        {filter.tagIds.length > 1 && !focused && (
                          <TagMatchControl
                            match={filter.match}
                            onChange={(match) => setFilter({ match })}
                          />
                        )}
                      </AnimatePresence>
                    )}
                    // The tree scrolls; its search and Untagged stay put below it.
                    className="max-h-[clamp(6rem,calc(var(--board-filter-view-max,24rem)-6.5rem),20rem)]"
                    renderTag={(tag, path) => (
                      <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl px-2 hover:bg-foreground/5">
                        <span
                          data-color={path[0]?.color ?? undefined}
                          className={path[0]?.color ? 'text-tint-accent' : 'text-muted-foreground'}
                        >
                          <TagIcon name={path[0]?.icon} className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm">{tag.name}</span>
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {counts.tags.get(tag.id) ?? 0}
                        </span>
                        <input
                          type="checkbox"
                          aria-label={path.map((item) => item.name).join(' / ')}
                          checked={selected.has(tag.id)}
                          onChange={() => toggleTagFilter(filter, tag.id)}
                          className="size-4 shrink-0 accent-brand"
                        />
                      </label>
                    )}
                  />
                ) : (
                  <p className="px-1 py-2 text-muted-foreground text-sm">
                    This project has no tags yet.
                  </p>
                )}
                <label className="mt-1 flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-xl px-2 text-sm hover:bg-foreground/5">
                  <Tags className="size-4 text-muted-foreground" aria-hidden />
                  <span className="flex-1">Untagged</span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {counts.untagged}
                  </span>
                  <input
                    type="checkbox"
                    checked={filter.untagged}
                    onChange={() => {
                      haptics.selection();
                      setFilter({ tagIds: [], untagged: !filter.untagged });
                    }}
                    className="size-4 accent-brand"
                  />
                </label>
              </div>
            )}
          </FilterTabView>
        </AnimatePresence>
      </FilterTabContents>
      <SegmentedTabs<FilterTab>
        label="Filter type"
        value={tab}
        onValueChange={selectTab}
        options={[
          {
            value: 'group',
            id: tabId('group'),
            controls: viewId('group'),
            label: workspace ? 'Projects' : 'Tags',
            icon: (
              <TabIcon
                icon={workspace ? Folder : Tags}
                active={
                  workspace
                    ? filter.projectId !== null
                    : filter.tagIds.length > 0 || filter.untagged
                }
              />
            ),
          },
          {
            value: 'size',
            id: tabId('size'),
            controls: viewId('size'),
            label: 'Size',
            icon: <TabIcon icon={Ruler} active={filter.sizes.length > 0 || filter.unsized} />,
          },
          {
            value: 'sort',
            id: tabId('sort'),
            controls: viewId('sort'),
            label: 'Sort',
            icon: <TabIcon icon={ArrowUpNarrowWide} active={state.sort !== 'priority'} />,
          },
        ]}
      />
    </div>
  );
}

/**
 * Catch's filter tab surface: it springs between the sections' heights as the tab changes,
 * and otherwise follows its content (a tag tree opening a branch) without animating.
 */
function FilterTabContents({ children, tab }: { children: ReactNode; tab: FilterTab }) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previousHeight = useRef(0);
  const reducedMotion = useReducedMotion();
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => {
      previousHeight.current = content.offsetHeight;
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a tab change is the resize trigger
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    const content = contentRef.current;
    if (!surface || !content) return;
    const from = surface.style.height
      ? surface.getBoundingClientRect().height
      : previousHeight.current;
    const to = content.offsetHeight;
    previousHeight.current = to;
    if (!from || from === to || reducedMotion) {
      surface.style.removeProperty('height');
      return;
    }
    let cancelled = false;
    // No bounce: the surface clips, so dipping below the new height would cut off the top.
    const animation = animate(surface, { height: [from, to] }, springs.pane);
    void animation.then(() => {
      if (!cancelled) surface.style.removeProperty('height');
    });
    return () => {
      cancelled = true;
      animation.stop();
    };
  }, [tab, reducedMotion]);
  return (
    <div ref={surfaceRef} className="flex min-h-0 flex-col justify-end overflow-hidden">
      <div ref={contentRef} className="relative shrink-0">
        {children}
      </div>
    </div>
  );
}

/** One section, sliding in from the side of its tab while the last one slides out. */
function FilterTabView({
  children,
  id,
  labelledBy,
  direction,
  scroll,
}: {
  children: ReactNode;
  id: string;
  labelledBy: string;
  direction: number;
  /** Whether the section scrolls as a whole; the tags section scrolls only its tree. */
  scroll: boolean;
}) {
  const isPresent = useIsPresent();
  const reducedMotion = useReducedMotion();
  return (
    <motion.section
      id={id}
      role="tabpanel"
      aria-labelledby={labelledBy}
      inert={!isPresent}
      aria-hidden={!isPresent}
      custom={direction}
      variants={{
        enter: (travel: number) => ({ x: reducedMotion ? 0 : travel * 40, opacity: 0 }),
        shown: { x: 0, opacity: 1 },
        leave: (travel: number) => ({ x: reducedMotion ? 0 : -travel * 40, opacity: 0 }),
      }}
      initial="enter"
      animate="shown"
      exit="leave"
      transition={reducedMotion ? { duration: 0 } : springs.smooth}
      className={cn(
        'flex max-h-[var(--board-filter-view-max,24rem)] flex-col overflow-hidden',
        !isPresent && 'absolute inset-x-0 bottom-0',
      )}
    >
      {scroll ? (
        <ScrollArea edges className="flex min-h-0 flex-1 flex-col [--scrollbar-inset:0.25rem]">
          <ScrollAreaViewport className="h-auto w-full min-h-0 flex-1">
            {children}
          </ScrollAreaViewport>
          <ScrollBar />
        </ScrollArea>
      ) : (
        children
      )}
    </motion.section>
  );
}

/**
 * A few mutually exclusive choices, with Catch's pill sliding under the chosen one. The pill
 * springs its own offset rather than a shared layout animation, so it stays put while the card
 * around it moves or resizes.
 */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  return (
    <fieldset className={cn('relative flex rounded-xl bg-foreground/[0.05] p-1', className)}>
      <legend className="sr-only">{label}</legend>
      <motion.span
        aria-hidden
        className="pointer-events-none absolute top-1 bottom-1 left-1 rounded-lg bg-background shadow-sm"
        style={{ width: `calc((100% - 0.5rem) / ${options.length})` }}
        initial={false}
        animate={{ x: `${index * 100}%` }}
        transition={reduced ? { duration: 0 } : springs.snappy}
      />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => value !== option.value && onChange(option.value)}
          className="relative flex h-9 min-w-0 flex-1 items-center justify-center rounded-lg px-2 font-medium text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <span className="truncate">{option.label}</span>
        </button>
      ))}
    </fieldset>
  );
}

/** Catch's All / Any toggle, beside the tag search or in the sidebar's Tags heading once more than one tag is chosen. */
function TagMatchControl({
  match,
  onChange,
  compact = false,
}: {
  match: TagMatch;
  onChange: (match: TagMatch) => void;
  compact?: boolean;
}) {
  const isPresent = useIsPresent();
  const reduced = useReducedMotion();
  return (
    <motion.div
      inert={!isPresent}
      aria-hidden={!isPresent}
      className="shrink-0 overflow-hidden"
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 'auto', opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={reduced ? { duration: 0 } : springs.smooth}
    >
      <fieldset className={cn('flex items-center justify-end', compact ? 'h-7' : 'ml-2 h-11 w-26')}>
        <legend className="sr-only">Match tags</legend>
        <div
          className={cn(
            'relative flex',
            compact ? 'rounded-lg bg-foreground/[0.06] p-0.5' : 'px-1',
          )}
        >
          {!compact && (
            <span
              aria-hidden
              className="absolute inset-x-0 inset-y-0.5 rounded-xl bg-foreground/5"
            />
          )}
          {/* Its own offset, as in Choice, so it stays put while the card moves. */}
          <motion.span
            aria-hidden
            className={cn(
              'pointer-events-none absolute',
              compact
                ? 'inset-y-0.5 left-0.5 w-10 rounded-md bg-background shadow-sm'
                : 'inset-y-1 left-1 w-12 rounded-lg bg-foreground/[0.08] shadow-[inset_0_1px_0_var(--glass-highlight)]',
            )}
            initial={false}
            animate={{ x: match === 'all' ? '100%' : '0%' }}
            transition={reduced ? { duration: 0 } : springs.snappy}
          />
          {(['any', 'all'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-label={value === 'any' ? 'Any tag' : 'All tags'}
              aria-pressed={match === value}
              onPointerDown={compact ? undefined : (event) => event.preventDefault()}
              onClick={() => {
                haptics.selection();
                onChange(value);
              }}
              className={cn(
                'relative flex items-center justify-center font-medium text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                compact ? 'h-6 w-10 rounded-md' : 'h-11 w-12 rounded-lg px-2',
              )}
            >
              <span className="relative">{value === 'any' ? 'Any' : 'All'}</span>
            </button>
          ))}
        </div>
      </fieldset>
    </motion.div>
  );
}

const badge =
  'glass-badge flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

/**
 * What narrows the board, each chip removing itself, and Clear all. The size sort shows here
 * too, so a temporary order is never forgotten. Empty when the board shows everything as it is.
 */
export function ActiveFilters({
  state,
  query = false,
  onClear = clearFilters,
  clear = true,
  className,
}: {
  state: BoardState;
  /** Show the search words as a chip too, where the field holding them is out of sight. */
  query?: boolean;
  onClear?: () => void;
  /** Whether Clear all ends the chips; a bar that pins its own leaves it out. */
  clear?: boolean;
  className?: string;
}) {
  const { project } = current(state);
  const { filter, sort } = state;
  const scope = project.members?.find((member) => member.id === filter.projectId);
  const words = filter.query.trim();
  function removeTag(id: string) {
    haptics.selection();
    setFilter({ tagIds: filter.tagIds.filter((value) => value !== id) });
  }
  return (
    <fieldset
      aria-label="Active filters"
      className={cn('flex min-w-0 flex-wrap items-center gap-2', className)}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {query && words && (
          <FilterChip key="query">
            <button
              type="button"
              aria-label={`Remove search “${words}”`}
              onClick={() => setFilter({ query: '' })}
              className={badge}
            >
              “{words}”
              <X className="size-3.5" aria-hidden />
            </button>
          </FilterChip>
        )}
        {sort !== 'priority' && (
          <FilterChip key="sort">
            <button
              type="button"
              aria-label={`Sorted ${SORT_NAMES[sort].toLowerCase()}. Sort by priority`}
              onClick={() => setSort('priority')}
              className={cn(badge, 'border-brand/40 text-brand-link')}
            >
              {sort.endsWith('-asc') ? (
                <ArrowUpNarrowWide className="size-3.5" aria-hidden />
              ) : (
                <ArrowDownWideNarrow className="size-3.5" aria-hidden />
              )}
              {SORT_NAMES[sort]}
              <X className="size-3.5" aria-hidden />
            </button>
          </FilterChip>
        )}
        {scope && (
          <FilterChip key="project">
            <button
              type="button"
              data-color={scope.color}
              aria-label={`Remove ${scope.name} filter`}
              onClick={() => setFilter({ projectId: null })}
              className={badge}
            >
              <ProjectIcon name={scope.icon} className="size-3.5 text-tint-accent" />
              {scope.name}
              <X className="size-3.5" aria-hidden />
            </button>
          </FilterChip>
        )}
        {filter.tagIds.length > 1 && (
          <FilterChip key="match">
            <span className="px-0.5 text-muted-foreground text-xs">
              {filter.match === 'all' ? 'All of' : 'Any of'}
            </span>
          </FilterChip>
        )}
        {filter.tagIds.map((id) => {
          const tag = project.tags.find((item) => item.id === id);
          return (
            <FilterChip key={`tag:${id}`}>
              {tag ? (
                <TagBadge tag={tag} tags={project.tags} onRemove={() => removeTag(id)} />
              ) : (
                <button
                  type="button"
                  aria-label="Remove unavailable tag filter"
                  onClick={() => removeTag(id)}
                  className={badge}
                >
                  Unavailable tag
                  <X className="size-3.5" aria-hidden />
                </button>
              )}
            </FilterChip>
          );
        })}
        {filter.untagged && (
          <FilterChip key="untagged">
            <button
              type="button"
              aria-label="Remove Untagged filter"
              onClick={() => setFilter({ untagged: false })}
              className={badge}
            >
              Untagged
              <X className="size-3.5" aria-hidden />
            </button>
          </FilterChip>
        )}
        {filter.sizes.map((size) => (
          <FilterChip key={`size:${size}`}>
            <button
              type="button"
              aria-label={`Remove size ${sizeLabel(size)} filter`}
              onClick={() => setFilter({ sizes: filter.sizes.filter((value) => value !== size) })}
              className={badge}
            >
              <Ruler className="size-3.5" aria-hidden />
              {sizeLabel(size)}
              <X className="size-3.5" aria-hidden />
            </button>
          </FilterChip>
        ))}
        {filter.unsized && (
          <FilterChip key="unsized">
            <button
              type="button"
              aria-label="Remove Unsized filter"
              onClick={() => setFilter({ unsized: false })}
              className={badge}
            >
              <Ruler className="size-3.5" aria-hidden />
              Unsized
              <X className="size-3.5" aria-hidden />
            </button>
          </FilterChip>
        )}
        {clear && (narrowed(state) || (query && isFiltering(filter))) && (
          <FilterChip key="clear">
            <ClearAll onClear={onClear} />
          </FilterChip>
        )}
      </AnimatePresence>
    </fieldset>
  );
}

function ClearAll({ onClear = clearFilters }: { onClear?: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        haptics.selection();
        onClear();
      }}
      className="flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-md px-2 font-medium text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      Clear all
    </button>
  );
}

/** Show a quiet Find tags input in the inline sidebar once a project has this many tags. */
const INLINE_TAG_SEARCH_MIN = 9;

/** One quiet section of the docked sidebar's inline filter and sort controls. */
function FilterSection({
  title,
  accessory,
  children,
}: {
  title: string;
  accessory?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex min-h-7 items-center justify-between gap-2 px-1">
        <h2 id={headingId} className="font-medium text-muted-foreground text-xs tracking-[0.01em]">
          {title}
        </h2>
        {accessory}
      </div>
      {children}
    </section>
  );
}

/**
 * Full inline sort and filter controls for the docked desktop search sidebar: Sort, Size, and
 * Tags (or Projects on the cross-project board) flow inside the sidebar's single scroller so
 * nothing is hidden behind tabs or a popup card. Structured as independent sections so future
 * filters (such as task relations) slot in cleanly.
 */
export function SidebarFilters({ className }: { className?: string }) {
  const state = board.use();
  const data = current(state);
  const { project } = data;
  const { filter } = state;
  const workspace = project.members !== undefined;
  const counts = useMemo(
    () => facetCounts(data, filter, state.subtasksAsCards),
    [data, filter, state.subtasksAsCards],
  );
  const tags = useMemo(() => treeTags(project), [project]);
  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <FilterSection title="Sort">
        <SortControls sort={state.sort} />
      </FilterSection>
      <FilterSection title="Size">
        <SizeControls filter={filter} counts={counts} />
      </FilterSection>
      {workspace
        ? (project.members?.length ?? 0) > 0 && (
            <FilterSection title="Projects">
              <ProjectControls
                members={project.members ?? []}
                projectId={filter.projectId}
                counts={counts.projects}
              />
            </FilterSection>
          )
        : tags.length > 0 && <InlineTagsSection tags={tags} filter={filter} counts={counts} />}
    </div>
  );
}

/**
 * Calm inline tag tree for the docked desktop sidebar: full-width toggle pills with root color
 * accents, collapsible hierarchy, Any/All matching in the section heading, and Untagged at the
 * end. Flows inside the sidebar's own scroller rather than trapping scroll in a nested viewport.
 */
function InlineTagsSection({
  tags,
  filter,
  counts,
}: {
  tags: readonly TagRow[];
  filter: BoardFilter;
  counts: FacetCounts;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState('');
  const reduced = useReducedMotion();
  const query = search.trim().toLowerCase();
  const index = useMemo(() => indexTagTree(tags), [tags]);
  const hasHierarchy = useMemo(() => tags.some((tag) => tag.parentId !== null), [tags]);
  const selected = useMemo(() => new Set(filter.tagIds), [filter.tagIds]);
  const rows = index.visibleRows(query, collapsed);
  const visibleIds = new Set(rows.map(({ tag }) => tag.id));
  const showSearch = tags.length >= INLINE_TAG_SEARCH_MIN;

  return (
    <FilterSection
      title="Tags"
      accessory={
        <AnimatePresence initial={false}>
          {filter.tagIds.length > 1 && (
            <TagMatchControl
              compact
              match={filter.match}
              onChange={(match) => setFilter({ match })}
            />
          )}
        </AnimatePresence>
      }
    >
      {showSearch && (
        <div className="relative flex items-center">
          <Search
            className="pointer-events-none absolute left-3 size-3.5 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            aria-label="Find tags"
            placeholder="Find tags"
            autoComplete="off"
            spellCheck={false}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || !search) return;
              event.preventDefault();
              event.stopPropagation();
              setSearch('');
            }}
            className="h-9 w-full rounded-xl border border-foreground/[0.08] bg-foreground/[0.04] pr-8 pl-8.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
          />
          {search && (
            <button
              type="button"
              aria-label="Clear tag search"
              onClick={() => setSearch('')}
              className="absolute right-1.5 flex size-6 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      )}
      <div className="flex flex-col gap-0.5">
        <AnimatePresence initial={false}>
          {rows.map(({ tag, depth }) => {
            const path = index.pathFor(tag.id);
            const hasChildren = index.hasChildren(tag.id);
            const expanded = !!query || !collapsed.has(tag.id);
            const on = selected.has(tag.id);
            const rootColor = path[0]?.color ?? null;
            const count = counts.tags.get(tag.id) ?? 0;
            const pathLabel = path.map((item) => item.name).join(' / ');
            return (
              <InlineTagRow key={tag.id} reduced={!!reduced}>
                <div
                  className="relative flex items-center gap-0.5"
                  style={hasHierarchy ? { paddingLeft: `${Math.min(depth, 6) * 14}px` } : undefined}
                >
                  {hasHierarchy && (
                    <span aria-hidden className="pointer-events-none absolute inset-0">
                      {path
                        .slice(0, Math.min(path.length - 1, 6))
                        .map((ancestor, level) =>
                          visibleIds.has(ancestor.id) ? (
                            <span
                              key={ancestor.id}
                              className="absolute inset-y-0 border-foreground/12 border-l"
                              style={{ left: `${13 + level * 14}px` }}
                            />
                          ) : null,
                        )}
                    </span>
                  )}
                  {hasHierarchy &&
                    (hasChildren ? (
                      <button
                        type="button"
                        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${tag.name}`}
                        aria-expanded={expanded}
                        disabled={!!query}
                        onClick={() =>
                          setCollapsed((current) => {
                            const next = new Set(current);
                            if (next.has(tag.id)) next.delete(tag.id);
                            else next.add(tag.id);
                            return next;
                          })
                        }
                        className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                      >
                        <motion.span
                          className="flex size-3.5 items-center justify-center"
                          initial={false}
                          animate={{ rotate: expanded ? 90 : 0 }}
                          transition={reduced ? { duration: 0 } : springs.snappy}
                        >
                          <ChevronRight className="size-3.5" />
                        </motion.span>
                      </button>
                    ) : (
                      <span className="w-7 shrink-0" aria-hidden />
                    ))}
                  <button
                    type="button"
                    data-color={rootColor ?? undefined}
                    aria-label={`${pathLabel}, ${count} ${count === 1 ? 'task' : 'tasks'}`}
                    aria-pressed={on}
                    onClick={() => toggleTagFilter(filter, tag.id)}
                    className={cn(
                      'flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                      on
                        ? rootColor
                          ? 'bg-tint font-medium text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--tint-accent)_40%,transparent)]'
                          : 'bg-foreground font-medium text-background'
                        : 'text-foreground/85 hover:bg-foreground/[0.06]',
                    )}
                  >
                    <TagIcon
                      name={path[0]?.icon}
                      className={cn(
                        'size-4 shrink-0',
                        on && !rootColor
                          ? 'text-background/80'
                          : rootColor
                            ? 'text-tint-accent'
                            : 'text-muted-foreground',
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                    <span
                      className={cn(
                        'shrink-0 text-xs tabular-nums',
                        on
                          ? rootColor
                            ? 'text-foreground/70'
                            : 'text-background/70'
                          : 'text-muted-foreground',
                      )}
                    >
                      {count}
                    </span>
                    {on && (
                      <Check
                        className={cn(
                          'size-3.5 shrink-0',
                          rootColor ? 'text-tint-accent' : 'text-background/85',
                        )}
                        aria-hidden
                      />
                    )}
                  </button>
                </div>
              </InlineTagRow>
            );
          })}
          {rows.length === 0 && (
            <InlineTagRow key="empty" reduced={!!reduced}>
              <p className="px-2.5 py-2 text-muted-foreground text-xs">No matching tags</p>
            </InlineTagRow>
          )}
        </AnimatePresence>
        <div className={cn('mt-1 flex items-center gap-0.5', hasHierarchy && 'pl-7')}>
          <button
            type="button"
            aria-label={`Untagged, ${counts.untagged} ${counts.untagged === 1 ? 'task' : 'tasks'}`}
            aria-pressed={filter.untagged}
            onClick={() => {
              haptics.selection();
              setFilter({ tagIds: [], untagged: !filter.untagged });
            }}
            className={cn(
              'flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
              filter.untagged
                ? 'bg-foreground font-medium text-background'
                : 'text-foreground/85 hover:bg-foreground/[0.06]',
            )}
          >
            <Tags
              className={cn(
                'size-4 shrink-0',
                filter.untagged ? 'text-background/80' : 'text-muted-foreground',
              )}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">Untagged</span>
            <span
              className={cn(
                'shrink-0 text-xs tabular-nums',
                filter.untagged ? 'text-background/70' : 'text-muted-foreground',
              )}
            >
              {counts.untagged}
            </span>
            {filter.untagged && (
              <Check className="size-3.5 shrink-0 text-background/85" aria-hidden />
            )}
          </button>
        </div>
      </div>
    </FilterSection>
  );
}

function InlineTagRow({ children, reduced }: { children: ReactNode; reduced: boolean }) {
  const isPresent = useIsPresent();
  return (
    <motion.div
      className="overflow-hidden"
      inert={!isPresent}
      aria-hidden={!isPresent}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={
        reduced ? { duration: 0 } : { height: springs.smooth, opacity: { duration: 0.16 } }
      }
    >
      {children}
    </motion.div>
  );
}

/** Whether `ActiveFilters` has anything to show beyond the query. */
export function hasChips(state: BoardState) {
  return state.sort !== 'priority' || isFiltering({ ...state.filter, query: '' });
}

const FilterChip = forwardRef<HTMLSpanElement, { children: ReactNode }>(function FilterChip(
  { children },
  ref,
) {
  const isPresent = useIsPresent();
  const reduced = useReducedMotion();
  return (
    <motion.span
      ref={ref}
      layout={reduced ? false : 'position'}
      inert={!isPresent}
      aria-hidden={!isPresent || undefined}
      className="inline-flex max-w-full shrink-0 whitespace-nowrap"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={reduced ? { duration: 0 } : springs.smooth}
    >
      {children}
    </motion.span>
  );
});

/**
 * On a phone, the board's own reminder that it is narrowed: the chips under the column track,
 * with Clear all one tap away, for as long as anything narrows it.
 */
export function NarrowedBar() {
  const state = board.use();
  const reduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {(narrowed(state) || isFiltering(state.filter)) && (
        <motion.div
          key="narrowed"
          className="overflow-hidden"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={reduced ? { duration: 0 } : springs.smooth}
        >
          {/* The chips scroll; Clear all stays in reach at the end. */}
          <div className="flex items-center gap-1 pr-3 pb-2">
            <ActiveFilters
              state={state}
              query
              clear={false}
              className="flex-1 flex-nowrap overflow-x-auto pl-5 [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] [scrollbar-width:none]"
            />
            <ClearAll />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
