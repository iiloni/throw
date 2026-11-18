import { Plus, Search, SearchX, SlidersHorizontal, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useShell } from '@/components/AppShell/shell';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ProjectIcon } from '@/components/ProjectIcon/ProjectIcon';
import { useTasks } from '@/lib/collections';
import { springs } from '@/lib/motion';
import { useAwaitingSync } from '@/lib/syncStatus';
import {
  descriptionSnippet,
  highlight,
  indexTasks,
  SEARCH_LIMIT,
  type Segment,
  searchProjects,
  searchTasks,
} from '@/lib/taskSearch';
import { cn } from '@/lib/utils';
import { backlogOf, type Dismiss, focusPaletteInput, type PaletteActions } from './actions';
import { ProjectBadge, ProjectOptions } from './ProjectOptions';

export type SearchState = ReturnType<typeof useSearch>;

/**
 * Search's state and keyboard handling, apart from where it is drawn: the desktop palette
 * and the phone's drawer arrange the same field, results and scope list differently. A
 * project board searches that project alone; choosing among projects, and jumping to them,
 * belong to the cross-project board.
 */
export function useSearch({
  actions,
  dismiss,
  onCaptureTitle,
}: {
  actions: PaletteActions;
  dismiss: Dismiss;
  /** Takes a title search has no project for, so capture can ask for one. */
  onCaptureTitle: (title: string) => void;
}) {
  const shell = useShell();
  const { tasks, isLoading } = useTasks();
  const [query, setQuery] = useState('');
  const board = shell.project;
  const [chosenFilter, setProjectFilter] = useState('');
  const projectFilter = board?.id ?? chosenFilter;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const indexed = useMemo(
    () => indexTasks(tasks, shell.projects, actions.statuses, shell.workspace?.id ?? ''),
    [tasks, shell.projects, actions.statuses, shell.workspace?.id],
  );
  const results = useMemo(
    () =>
      searchTasks(indexed, query, {
        projectId: projectFilter,
        currentProjectId: shell.project?.id,
      }),
    [indexed, query, projectFilter, shell.project?.id],
  );
  const projects = useMemo(
    () => (board ? [] : searchProjects(shell.projects, query)),
    [board, shell.projects, query],
  );
  const awaiting = useAwaitingSync(isLoading, indexed.length);
  const scope = board ? undefined : shell.projects.find((p) => p.id === projectFilter);
  const destination = board ?? scope;
  const backlog = backlogOf(actions.statuses, destination?.id);
  const title = query.trim();

  function closeFilters() {
    setFiltersOpen(false);
    focusPaletteInput();
  }
  dismiss.current = () => {
    if (!filtersOpen) return false;
    closeFilters();
    return true;
  };

  function create() {
    if (!title) return;
    if (!destination) {
      onCaptureTitle(title);
      return;
    }
    setError(actions.create(destination.id, title) ?? '');
  }

  const options = [
    ...results.map((row) => ({
      key: row.task.id,
      choose: () => actions.openTask(row.project.id, row.task.id),
    })),
    ...projects.map((project) => ({ key: project.id, choose: () => actions.jump(project) })),
  ];
  if (title) options.push({ key: 'create', choose: create });
  const activeOption = options[Math.min(active, options.length - 1)];
  const activeKey = activeOption?.key;
  useEffect(() => {
    if (!activeKey) return;
    const row = document.getElementById(`${id}-${activeKey}`);
    const box = list.current;
    if (!row || !box) return;
    const offset = row.getBoundingClientRect().top - box.getBoundingClientRect().top;
    if (offset < 0) box.scrollTop += offset - 8;
    else if (offset + row.offsetHeight > box.clientHeight)
      box.scrollTop += offset + row.offsetHeight - box.clientHeight + 8;
  }, [activeKey, id]);

  return {
    id,
    list,
    query,
    title,
    results,
    projects,
    awaiting,
    scope,
    /** Searching one project's board, with no other project to choose. */
    scoped: !!board,
    destination,
    backlog,
    projectFilter,
    filtersOpen,
    error,
    activeKey,
    awaitingStatuses: actions.awaitingStatuses,
    actions,
    create,
    closeFilters,
    toggleFilters: () => (filtersOpen ? closeFilters() : setFiltersOpen(true)),
    chooseScope(value: string) {
      setProjectFilter(value);
      setActive(0);
      closeFilters();
    },
    clearScope() {
      setProjectFilter('');
      setActive(0);
    },
    setQuery(value: string) {
      setQuery(value);
      setActive(0);
      setError('');
      if (list.current) list.current.scrollTop = 0;
    },
    onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((before) =>
          options.length
            ? (before + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
            : 0,
        );
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (event.metaKey || event.ctrlKey) create();
        else activeOption?.choose();
      }
    },
    optionProps(key: string) {
      return {
        id: `${id}-${key}`,
        role: 'option',
        'aria-selected': activeKey === key,
        'data-active': activeKey === key || undefined,
        tabIndex: -1,
        onPointerMove: () => setActive(options.findIndex((option) => option.key === key)),
      };
    },
  };
}

function Highlighted({ segments }: { segments: Segment[] }) {
  return segments.map((segment, index) =>
    segment.match ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
      <mark key={index} className="rounded-sm bg-brand/35 px-0.5 text-inherit">
        {segment.text}
      </mark>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
      <span key={index}>{segment.text}</span>
    ),
  );
}

/** The search input, as Catch's glass dock field. */
export function SearchField({
  search,
  disabled,
  inputRef,
  onClose,
}: {
  search: SearchState;
  disabled?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  /** The dock field closes search from inside itself, as Catch's does. */
  onClose?: () => void;
}) {
  const activeOption = search.activeKey ? `${search.id}-${search.activeKey}` : undefined;
  return (
    <div className="glass relative flex h-[var(--dock-height)] min-w-0 flex-1 items-center gap-2 rounded-[var(--dock-radius)] pr-1.5 pl-4">
      <Search className="size-6 shrink-0" aria-hidden />
      <input
        ref={inputRef}
        data-palette-input
        disabled={disabled}
        type="text"
        inputMode="search"
        role="combobox"
        aria-label={search.scoped ? 'Search tasks' : 'Search tasks and projects'}
        aria-expanded
        aria-autocomplete="list"
        aria-controls={`${search.id}-results`}
        aria-activedescendant={activeOption}
        placeholder="Search tasks"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="search"
        value={search.query}
        onChange={(event) => search.setQuery(event.target.value)}
        onKeyDown={search.onKeyDown}
        className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
      />
      {onClose && (
        <motion.button
          type="button"
          aria-label="Close search"
          onClick={onClose}
          whileTap={{ scale: 0.88 }}
          transition={springs.snappy}
          className="flex size-[3.25rem] shrink-0 items-center justify-center rounded-[calc(var(--dock-radius)-0.375rem)] bg-foreground/[0.08] outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          <X className="size-5" aria-hidden />
        </motion.button>
      )}
    </div>
  );
}

/** Catch's filter button: opens the project scope, with a dot while one applies. */
export function FilterButton({ search }: { search: SearchState }) {
  return (
    <motion.button
      type="button"
      aria-label="Filter by project"
      aria-expanded={search.filtersOpen}
      title={search.scope ? `Filter by project (${search.scope.name})` : 'Filter by project'}
      onPointerDown={(event) => event.preventDefault()}
      onClick={search.toggleFilters}
      whileTap={{ scale: 0.88 }}
      transition={springs.snappy}
      className={cn(
        'glass relative flex size-[var(--dock-height)] shrink-0 items-center justify-center rounded-[var(--dock-radius)] outline-none transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-ring/70',
        search.filtersOpen || search.scope ? 'text-brand-link' : 'text-foreground',
      )}
    >
      <SlidersHorizontal className="size-7" strokeWidth={2.25} aria-hidden />
      {search.scope && (
        <span aria-hidden className="absolute top-3 right-3 size-1.5 rounded-full bg-brand" />
      )}
    </motion.button>
  );
}

/** The project scope list: all projects or one of them. */
export function ScopeOptions({ search }: { search: SearchState }) {
  const shell = useShell();
  return (
    <section aria-label="Search scope" className="flex flex-col">
      <ProjectOptions
        label="Search in"
        searchLabel="Find project to search"
        options={[
          {
            value: '',
            label: 'All projects',
            icon: (
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.07]">
                <Search className="size-4" aria-hidden />
              </span>
            ),
          },
          ...shell.projects.map((project) => ({
            value: project.id,
            label: project.name,
            keywords: project.key ?? '',
            icon: <ProjectBadge color={project.color} icon={project.icon} />,
          })),
        ]}
        value={search.projectFilter}
        onChange={search.chooseScope}
        onDismiss={search.closeFilters}
      />
    </section>
  );
}

/** The scope chip, task cards, project jumps and Create, inside the caller's scroller. */
export function SearchResults({ search }: { search: SearchState }) {
  const reduced = useReducedMotion();
  const { scope, title, results, projects, actions, destination, backlog, query } = search;
  const listMotion = reduced
    ? {}
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, scale: 0.97 },
        transition: springs.smooth,
      };
  return (
    <>
      <AnimatePresence initial={false}>
        {scope && (
          <motion.div
            key="scope"
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduced ? { duration: 0 } : springs.smooth}
          >
            <div className="flex flex-wrap items-center gap-2 pb-4">
              <button
                type="button"
                data-color={scope.color}
                aria-label={`Remove ${scope.name} filter`}
                onPointerDown={(event) => event.preventDefault()}
                onClick={search.clearScope}
                className="glass-badge flex min-h-9 items-center gap-2 rounded-md px-2.5 font-medium text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <ProjectIcon name={scope.icon} className="size-3.5 text-tint-accent" />
                {scope.name}
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div id={`${search.id}-results`} role="listbox" aria-label="Tasks, projects and capture">
        {!title ? (
          <p className="px-1 pb-5 text-muted-foreground text-sm">
            Search titles and descriptions, or go straight to a task with its identifier.
          </p>
        ) : search.awaiting ? (
          <p role="status" className="px-1 pb-5 text-muted-foreground text-sm">
            Loading tasks…
          </p>
        ) : results.length > 0 ? (
          <section aria-label="Tasks" className="pb-5">
            <p role="status" className="px-1 pb-2 text-muted-foreground text-xs">
              {results.length === SEARCH_LIMIT
                ? `First ${SEARCH_LIMIT} tasks`
                : `${results.length} ${results.length === 1 ? 'task' : 'tasks'}`}
            </p>
            <ul className="flex flex-col gap-2">
              <AnimatePresence initial={false} mode="popLayout">
                {results.map((row) => {
                  const snippet = descriptionSnippet(row.task.description, query);
                  return (
                    <motion.li key={row.task.id} layout={!reduced} {...listMotion}>
                      <button
                        type="button"
                        {...search.optionProps(row.task.id)}
                        onClick={() => actions.openTask(row.project.id, row.task.id)}
                        className="flex w-full flex-col gap-1 rounded-2xl border bg-card px-3.5 py-3 text-left text-card-foreground outline-none transition-shadow duration-150 data-active:ring-[3px] data-active:ring-ring/50"
                      >
                        <span className="font-display font-semibold text-[0.9375rem] leading-snug tracking-[-0.01em] [overflow-wrap:anywhere]">
                          {row.task.title ? (
                            <Highlighted segments={highlight(row.task.title, query)} />
                          ) : (
                            'Untitled task'
                          )}
                        </span>
                        {snippet && (
                          <span className="line-clamp-2 text-muted-foreground text-sm">
                            <Highlighted segments={snippet} />
                          </span>
                        )}
                        <span className="mt-1 flex min-w-0 items-center gap-2.5 text-foreground/55 text-xs">
                          <span className="shrink-0 font-medium tabular-nums">
                            {row.identifier ? (
                              <Highlighted segments={highlight(row.identifier, query)} />
                            ) : (
                              'Pending'
                            )}
                          </span>
                          {!search.scoped && (
                            <span
                              data-color={row.project.color}
                              className="flex min-w-0 items-center gap-1 text-tint-accent"
                            >
                              <ProjectIcon name={row.project.icon} className="size-3.5" />
                              <span className="truncate">{row.project.name}</span>
                            </span>
                          )}
                          <span className="flex-1" />
                          <span className="shrink-0 rounded-full bg-foreground/[0.08] px-2 py-0.5 font-medium text-[0.6875rem] text-muted-foreground">
                            {row.status?.name ?? 'No status'}
                          </span>
                        </span>
                      </button>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          </section>
        ) : (
          projects.length === 0 && (
            <div className="pb-6">
              <EmptyState icon={SearchX} title="No matching tasks">
                {scope && !search.scoped
                  ? 'Try fewer words, or search all projects.'
                  : 'Try fewer words, or type an identifier like 12.'}
              </EmptyState>
            </div>
          )
        )}
        {projects.length > 0 && (
          <section aria-label="Projects" className="flex flex-col gap-1 pb-5">
            <h2 className="px-1 font-medium text-muted-foreground text-sm">Projects</h2>
            {projects.map((project) => (
              <button
                type="button"
                key={project.id}
                {...search.optionProps(project.id)}
                onClick={() => actions.jump(project)}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left outline-none transition-colors duration-150 data-active:bg-foreground/[0.07]"
              >
                <ProjectBadge color={project.color} icon={project.icon} className="size-8" />
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                {project.key && (
                  <span className="text-muted-foreground text-xs">{project.key}</span>
                )}
              </button>
            ))}
          </section>
        )}
        {title && (
          <button
            type="button"
            {...search.optionProps('create')}
            disabled={!!destination && !backlog}
            onClick={search.create}
            className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left outline-none transition-colors duration-150 disabled:cursor-default disabled:opacity-50 data-active:bg-foreground/[0.07]"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground">
              <Plus className="size-5" strokeWidth={2.25} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">Create “{title}”</span>
              <span className="block truncate text-muted-foreground text-xs">
                {!destination
                  ? 'Choose a project'
                  : backlog
                    ? `In ${destination.name} · ${backlog.name}`
                    : search.awaitingStatuses
                      ? 'Loading statuses…'
                      : 'Connect to load this project’s backlog'}
              </span>
            </span>
          </button>
        )}
        {search.error && (
          <p role="alert" className="px-1 pt-2 text-destructive text-sm">
            {search.error}
          </p>
        )}
      </div>
    </>
  );
}

/**
 * Search as the phone's drawer shows it at full height: results above, and Catch's glass
 * search field at the bottom, where the dock was, riding just above the keyboard. Choosing
 * a project (on the cross-project board) opens above the field. The drawer owns the surface,
 * its gestures, Back, keyboard insets and focus on open.
 */
export function PhoneSearchContent({
  search,
  inputRef,
  onClose,
}: {
  search: SearchState;
  /** The field the drawer focuses on open, so the keyboard rises with the page. */
  inputRef?: RefObject<HTMLInputElement | null>;
  /** A close button of its own, for a surface without one; the drawer's title row has it. */
  onClose?: () => void;
}) {
  const reduced = useReducedMotion();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={search.list}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pt-2 pb-3"
      >
        {/* Few results sit by the field; more scroll from the best one down. */}
        <div className="mt-auto">
          <SearchResults search={search} />
        </div>
      </div>
      <AnimatePresence initial={false}>
        {search.filtersOpen && (
          <motion.div
            key="filters"
            className="shrink-0 overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduced ? { duration: 0 } : springs.smooth}
          >
            <div className="glass mx-3 mb-3 rounded-[var(--dock-radius)] p-3">
              <ScopeOptions search={search} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Clear of the gesture bar with the keyboard down; just above the keyboard when up. */}
      <div className="flex shrink-0 items-end gap-3 px-3 pt-1 pb-[max(0.5rem,calc(var(--safe-bottom)+0.75rem-var(--keyboard)))]">
        <SearchField search={search} inputRef={inputRef} onClose={onClose} />
        {!search.scoped && <FilterButton search={search} />}
      </div>
    </div>
  );
}
