import { Check, ChevronsUpDown, Search } from 'lucide-react';
import {
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Collapse } from '@/components/Collapse/Collapse';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useBackHandler } from '@/lib/backButton';
import { haptics } from '@/lib/haptics';
import { useDesktop } from '@/lib/media';
import { cn } from '@/lib/utils';

export type SelectOption = {
  value: string;
  label: string;
  /** Shown under the label, to tell apart options that share one. */
  detail?: string;
  /** Other words that find the option, such as a tag's full path. */
  keywords?: readonly string[];
  icon?: ReactNode;
  /** Indents the option under the ones before it, while the list is not narrowed. */
  depth?: number;
};

type ListProps = {
  /** Names the list, such as "Parent tag". */
  title: string;
  /** Names the search field, such as "Search tags". */
  searchLabel: string;
  /** Shown when the search matches nothing. */
  emptyText: string;
  options: readonly SelectOption[];
  value: string;
  onChange: (value: string) => void;
};

const plain = (text: string) => text.trim().toLowerCase();

/** How well an option answers a search, best first, or null when it does not. */
function rank(option: SelectOption, wanted: string) {
  const label = plain(option.label);
  const words = [label, ...(option.keywords ?? []).map(plain)];
  if (words.includes(wanted)) return 0;
  if (label.startsWith(wanted)) return 1;
  if (words.some((word) => word.startsWith(wanted))) return 2;
  return words.some((word) => word.includes(wanted)) ? 3 : null;
}

/** The options a search leaves, the closest first. Without one, all of them as given. */
export function searchOptions(options: readonly SelectOption[], query: string) {
  const wanted = plain(query);
  if (!wanted) return [...options];
  return options
    .flatMap((option) => {
      const score = rank(option, wanted);
      return score === null ? [] : [{ option, score }];
    })
    .sort((a, b) => a.score - b.score)
    .map(({ option }) => option);
}

const coarsePointer = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

/**
 * Catch's searchable select: a form field that shows the chosen option and opens a list,
 * narrowed by a search, to change it. It takes the place of a native select, whose menu is
 * the system's own on Android.
 *
 * Desktop hangs the list from the field. A phone opens it in place, under the field, since
 * its forms are already a page of the drawer and nothing stacks over that (ADR 0009).
 */
export function SearchSelect({
  labelId,
  className,
  ...list
}: ListProps & {
  /** The id of the text that names the field, read with the chosen option. */
  labelId: string;
  className?: string;
}) {
  const desktop = useDesktop();
  const valueId = useId();
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Each opening starts a fresh search, centred on the chosen option.
  const [openings, setOpenings] = useState(0);
  const chosen = list.options.find((option) => option.value === list.value);
  const inline = open && !desktop;

  function show(next: boolean) {
    if (next) {
      haptics.toggle();
      setOpenings((count) => count + 1);
    }
    setOpen(next);
  }
  // Closing in place hides the list, so focus inside it would fall to the page.
  function closeInline() {
    const box = document.getElementById(listId);
    const hadFocus = !!box?.contains(document.activeElement);
    setOpen(false);
    if (hadFocus) trigger.current?.focus({ preventScroll: true });
  }
  useBackHandler(inline, closeInline);
  // A phone turned to a desktop width (or back) keeps the list closed rather than moving it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the layout only
  useEffect(() => setOpen(false), [desktop]);

  const field = (
    <button
      ref={trigger}
      type="button"
      aria-haspopup={desktop ? 'dialog' : undefined}
      aria-expanded={open}
      aria-controls={inline ? listId : undefined}
      aria-labelledby={`${labelId} ${valueId}`}
      onClick={desktop ? undefined : () => (open ? closeInline() : show(true))}
      className={cn(
        'flex h-11 w-full min-w-0 items-center gap-2 rounded-xl border border-input bg-background px-3 text-left font-normal text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {chosen?.icon}
      <span id={valueId} className="min-w-0 flex-1 truncate">
        {chosen?.label}
      </span>
      <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );

  if (desktop)
    return (
      <Popover open={open} onOpenChange={show}>
        <PopoverTrigger asChild>{field}</PopoverTrigger>
        <PopoverContent
          data-search-select
          aria-label={list.title}
          align="start"
          sideOffset={6}
          collisionPadding={12}
          // Above the centred dialog that holds the form.
          className="z-[90] flex max-h-[min(26rem,var(--radix-popover-content-available-height))] w-[max(var(--radix-popover-trigger-width),16rem)] max-w-[calc(100vw-1.5rem)] flex-col gap-2 rounded-3xl p-2"
          // React hands a portal's events to its parents in the tree: the form would take
          // this Enter, and the dialog around it this Escape.
          onKeyDown={(event) => event.stopPropagation()}
        >
          <SearchOptions
            key={openings}
            {...list}
            onChange={(value) => {
              list.onChange(value);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    );

  return (
    <>
      {field}
      <Collapse open={inline}>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: takes Escape for the list inside it */}
        <div
          id={listId}
          data-search-select
          className="mt-2 flex flex-col gap-2 rounded-2xl border border-border bg-background/40 p-2"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            // Ahead of the drawer, which would close the whole form.
            event.preventDefault();
            event.stopPropagation();
            closeInline();
          }}
        >
          {openings > 0 && (
            <SearchOptions
              key={openings}
              {...list}
              // Touch keeps the keyboard down until the search is tapped: a list is easier to
              // scroll than to search with the keyboard over half of it.
              autoFocus={!coarsePointer()}
              // Only as tall as a short list needs, as the form scrolls around it.
              fit
              onChange={(value) => {
                list.onChange(value);
                closeInline();
              }}
            />
          )}
        </div>
      </Collapse>
    </>
  );
}

function SearchOptions({
  title,
  searchLabel,
  emptyText,
  options,
  value,
  onChange,
  autoFocus = false,
  fit = false,
}: ListProps & { autoFocus?: boolean; fit?: boolean }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => searchOptions(options, query), [options, query]);
  const searching = plain(query) !== '';
  // The option Enter takes: the chosen one, or the best match once there is a search.
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.value === value),
    ),
  );
  const activeOption = shown[Math.min(active, shown.length - 1)];

  // Opens with the chosen option in the middle of the list rather than at its far end. Moving
  // the list itself keeps the page behind it from scrolling, as scrollIntoView would.
  useLayoutEffect(() => {
    const box = list.current;
    const chosen = box?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (box && chosen) {
      box.scrollTop =
        chosen.offsetTop - box.offsetTop - (box.clientHeight - chosen.offsetHeight) / 2;
    }
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only as the list opens
  useEffect(() => {
    if (autoFocus) search.current?.focus({ preventScroll: true });
  }, []);

  function move(to: number) {
    if (!shown.length) return;
    const next = Math.min(Math.max(to, 0), shown.length - 1);
    setActive(next);
    const box = list.current;
    const row = box?.querySelectorAll('[role="option"]')[next];
    if (!box || !(row instanceof HTMLElement)) return;
    const top = row.offsetTop - box.offsetTop;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (top + row.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = top + row.offsetHeight - box.clientHeight;
    }
  }

  const choose = (option: SelectOption) => {
    haptics.selection();
    onChange(option.value);
  };

  return (
    <>
      <label className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-foreground/[0.06] px-3 focus-within:ring-2 focus-within:ring-ring/70 focus-within:ring-inset">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={search}
          type="search"
          role="combobox"
          aria-label={searchLabel}
          aria-expanded
          aria-controls={`${id}-list`}
          aria-activedescendant={activeOption ? `${id}-${activeOption.value}` : undefined}
          aria-autocomplete="list"
          placeholder="Search"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            if (list.current) list.current.scrollTop = 0;
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') move(active + 1);
            else if (event.key === 'ArrowUp') move(active - 1);
            else if (event.key === 'Home') move(0);
            else if (event.key === 'End') move(shown.length - 1);
            // Also keeps Enter from submitting the form the field sits in.
            else if (event.key === 'Enter') {
              if (activeOption) choose(activeOption);
            } else return;
            event.preventDefault();
          }}
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
      </label>
      <div
        ref={list}
        className={cn(
          'min-h-24 shrink overflow-y-auto overscroll-contain',
          fit ? 'max-h-72' : 'h-72',
        )}
      >
        <div id={`${id}-list`} role="listbox" aria-label={title}>
          {shown.map((option) => {
            const selected = option.value === value;
            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the search field holds focus and takes the keys for the list
              <div
                key={option.value}
                id={`${id}-${option.value}`}
                role="option"
                tabIndex={-1}
                aria-selected={selected}
                data-active={option === activeOption || undefined}
                onClick={() => choose(option)}
                style={{
                  paddingLeft: searching
                    ? undefined
                    : `${0.75 + Math.min(option.depth ?? 0, 8) * 0.75}rem`,
                }}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 text-sm outline-none transition-colors duration-200',
                  selected
                    ? 'glass-chosen'
                    : 'hover:bg-foreground/[0.06] data-active:bg-foreground/[0.06]',
                )}
              >
                {option.icon}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{option.label}</span>
                  {option.detail && (
                    <span
                      className={cn('block truncate text-xs', !selected && 'text-muted-foreground')}
                    >
                      {option.detail}
                    </span>
                  )}
                </span>
                {selected && <Check className="size-4 shrink-0" aria-hidden />}
              </div>
            );
          })}
        </div>
        {shown.length === 0 && (
          <p role="status" className="px-3 py-6 text-center text-muted-foreground text-sm">
            {emptyText}
          </p>
        )}
      </div>
    </>
  );
}
