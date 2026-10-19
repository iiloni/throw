import { Check, Search } from 'lucide-react';
import { type ReactNode, useId, useMemo, useRef, useState } from 'react';
import { ProjectIcon } from '@/components/ProjectIcon/ProjectIcon';
import { normalizeSearch } from '@/lib/taskSearch';
import { cn } from '@/lib/utils';

export type ProjectOption = {
  value: string;
  label: string;
  /** Words that also find it, such as a project's key. */
  keywords?: string;
  icon: ReactNode;
};

/** Catch's searchable option list (SearchSelect), held inline in the palette's surfaces. */
export function ProjectOptions({
  label,
  searchLabel,
  options,
  value,
  onChange,
  onDismiss,
}: {
  label: string;
  searchLabel: string;
  options: readonly ProjectOption[];
  value: string;
  onChange: (value: string) => void;
  onDismiss: () => void;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => {
    const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
    return options.filter((option) =>
      words.every((word) =>
        normalizeSearch(`${option.label} ${option.keywords ?? ''}`).includes(word),
      ),
    );
  }, [options, query]);
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.value === value),
    ),
  );
  const activeOption = shown[Math.min(active, shown.length - 1)];

  function move(to: number) {
    if (!shown.length) return;
    const next = Math.min(Math.max(to, 0), shown.length - 1);
    setActive(next);
    const box = list.current;
    const row = box?.querySelectorAll('[role="option"]')[next];
    if (!box || !(row instanceof HTMLElement)) return;
    const top = row.offsetTop - box.offsetTop;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (top + row.offsetHeight > box.scrollTop + box.clientHeight)
      box.scrollTop = top + row.offsetHeight - box.clientHeight;
  }

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <label className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-foreground/[0.06] px-3 focus-within:ring-2 focus-within:ring-ring/70 focus-within:ring-inset">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          // biome-ignore lint/a11y/noAutofocus: the list opens to be searched
          autoFocus
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
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'ArrowDown') move(active + 1);
            else if (event.key === 'ArrowUp') move(active - 1);
            else if (event.key === 'Enter') {
              if (activeOption) onChange(activeOption.value);
            } else if (event.key === 'Escape') onDismiss();
            else return;
            event.preventDefault();
            event.stopPropagation();
          }}
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
      </label>
      <div ref={list} className="max-h-60 min-h-0 overflow-y-auto overscroll-contain">
        <div id={`${id}-list`} role="listbox" aria-label={label}>
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
                // Keeps the keyboard up while the choice lands.
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => onChange(option.value)}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl px-3 py-1.5 text-sm outline-none transition-colors duration-200',
                  selected
                    ? 'glass-chosen'
                    : 'hover:bg-foreground/[0.06] data-active:bg-foreground/[0.06]',
                )}
              >
                {option.icon}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {selected && <Check className="size-4 shrink-0" aria-hidden />}
              </div>
            );
          })}
        </div>
        {shown.length === 0 && (
          <p role="status" className="px-3 py-6 text-center text-muted-foreground text-sm">
            No matching projects
          </p>
        )}
      </div>
    </div>
  );
}

/** A project's icon on its own color, as the rail shows it. */
export function ProjectBadge({
  color,
  icon,
  className,
}: {
  color: string;
  icon: string | null;
  className?: string;
}) {
  return (
    <span
      data-color={color}
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-lg bg-tint text-tint-accent',
        className,
      )}
    >
      <ProjectIcon name={icon} className="size-4" />
    </span>
  );
}
