import { sizeLabel, type Tag, taskTagColor } from '@throw/shared';
import { Plus, Search, SearchX, SlidersHorizontal, Tag as TagGlyph, X } from 'lucide-react';
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
import { type ShellState, useShell } from '@/components/AppShell/shell';
import { isFiltering, matchingIds } from '@/components/Board/filter';
import { PriorityGlyph, StatusGlyph } from '@/components/Board/glyphs';
import { DEFAULT_PRIORITY_NAMES } from '@/components/Board/model';
import { secondaryTagsByTask } from '@/components/Board/selection';
import {
  type BoardState,
  board as boardStore,
  current,
  narrowed,
  setFilter,
  shownTasks,
  useBoardSettings,
} from '@/components/Board/state';
import { ActiveFilters, BoardFilters } from '@/components/BoardSearch/BoardFilters';
import { FilterCard, keepFocus } from '@/components/BoardSearch/FilterCard';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { Hint } from '@/components/Hint/Hint';
import { ProjectIcon } from '@/components/ProjectIcon/ProjectIcon';
import { TaskTags } from '@/components/TaskTags/TaskTags';
import { ScrollArea, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import { useAllTags, useAllTaskTags, useTasks } from '@/lib/collections';
import { curves, springs } from '@/lib/motion';
import { useAwaitingSync } from '@/lib/syncStatus';
import {
  descriptionSnippet,
  highlight,
  indexTasks,
  matchedTags,
  SEARCH_LIMIT,
  type Segment,
  searchProjects,
  searchTasks,
  taskTagNames,
} from '@/lib/taskSearch';
import { cn } from '@/lib/utils';
import { backlogOf, type Dismiss, focusPaletteInput, type PaletteActions } from './actions';
import { ProjectBadge, ProjectOptions } from './ProjectOptions';

export type SearchState = ReturnType<typeof useSearch>;

/** The board on screen, when search was opened from one: its filters narrow the results too. */
function useBoardOnScreen(shell: ShellState): BoardState | null {
  const state = boardStore.use();
  const id = shell.crossBoard ? `workspace:${shell.workspace?.id}` : shell.project?.id;
  return shell.board && state.actions !== null && state.projectId === id ? state : null;
}

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
  const [chosenFilter, setChosenFilter] = useState('');
  const onBoard = useBoardOnScreen(shell);
  // On the cross-project board the scope is the board's own, so it narrows the board as well.
  const projectFilter = board?.id ?? (onBoard ? (onBoard.filter.projectId ?? '') : chosenFilter);
  const setProjectFilter = (value: string) =>
    onBoard ? setFilter({ projectId: value || null }) : setChosenFilter(value);
  const boardData = onBoard && current(onBoard);
  const boardFilter = onBoard?.filter;
  // The board's sizes and tags narrow the results as they narrow its cards; the words are
  // the search's own.
  const allowed = useMemo(
    () =>
      boardData && boardFilter ? matchingIds(boardData, { ...boardFilter, query: '' }, true) : null,
    [boardData, boardFilter],
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const { tags } = useAllTags();
  const { taskTags } = useAllTaskTags();
  const tagNames = useMemo(() => taskTagNames(tasks, tags, taskTags), [tasks, tags, taskTags]);
  // What a result card shows, as the board's cards do: each project's tags, and each task's
  // secondary tags.
  const tagsByProject = useMemo(() => {
    const byProject = new Map<string, Tag[]>();
    for (const tag of tags) {
      const list = byProject.get(tag.projectId);
      if (list) list.push(tag);
      else byProject.set(tag.projectId, [tag]);
    }
    return byProject;
  }, [tags]);
  const secondaryTags = useMemo(() => secondaryTagsByTask(taskTags), [taskTags]);
  const indexed = useMemo(
    () => indexTasks(tasks, shell.projects, actions.statuses, shell.workspace?.id ?? '', tagNames),
    [tasks, shell.projects, actions.statuses, shell.workspace?.id, tagNames],
  );
  // With filters and no words, the results are what the board behind now shows, in its order,
  // so choosing a tag shows its cards here rather than only behind the page.
  const browsing =
    !!onBoard && !query.trim() && !!boardFilter && isFiltering({ ...boardFilter, query: '' });
  const results = useMemo(() => {
    if (browsing && onBoard) {
      const byId = new Map(indexed.map((row) => [row.task.id, row]));
      return shownTasks(onBoard)
        .flatMap((task) => byId.get(task.id) ?? [])
        .slice(0, SEARCH_LIMIT);
    }
    return searchTasks(
      allowed ? indexed.filter((row) => allowed.has(row.task.id)) : indexed,
      query,
      {
        projectId: projectFilter,
        currentProjectId: shell.project?.id,
      },
    );
  }, [browsing, onBoard, indexed, allowed, query, projectFilter, shell.project?.id]);
  const projects = useMemo(
    () => (board ? [] : searchProjects(shell.projects, query)),
    [board, shell.projects, query],
  );
  // Projects are jump targets too, until a board narrows search to its own.
  const awaiting = useAwaitingSync(isLoading, indexed.length) || (!board && shell.awaitingProjects);
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

  // Only what is on screen: while tasks load, Enter must not choose a project or Create the
  // list has not shown, when the task being typed may be about to appear. It waits instead.
  const options = awaiting
    ? []
    : [
        ...results.map((row) => ({
          key: row.task.id,
          choose: () => actions.openTask(row.project.id, row.task.id),
        })),
        ...projects.map((project) => ({ key: project.id, choose: () => actions.jump(project) })),
      ];
  if (title && !awaiting) options.push({ key: 'create', choose: create });
  const activeOption = options[Math.min(active, options.length - 1)];
  const activeKey = activeOption?.key;
  const [enterPending, setEnterPending] = useState(false);
  useEffect(() => {
    if (!enterPending || awaiting) return;
    setEnterPending(false);
    activeOption?.choose();
  }, [enterPending, awaiting, activeOption]);
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
    /** Listing the narrowed board, with filters chosen and no words typed. */
    browsing,
    results,
    tagsByProject,
    secondaryTags,
    projects,
    awaiting,
    scope,
    /** Searching one project's board, with no other project to choose. */
    scoped: !!board,
    /** The board search was opened from, whose filters and sort the filter button opens. */
    onBoard,
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
      setEnterPending(false);
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
        else if (awaiting) setEnterPending(true);
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

/** Search matches marked in text, as search results show them. */
export function Highlighted({ segments }: { segments: Segment[] }) {
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

/**
 * Catch's filter button. Over a board it opens the board's filters and sort; elsewhere, the
 * project scope. A dot shows while either applies.
 */
export function FilterButton({ search }: { search: SearchState }) {
  const label = search.onBoard ? 'Filter and sort' : 'Filter by project';
  const active = search.onBoard ? narrowed(search.onBoard) : !!search.scope;
  return (
    // The label stays the action; the hint adds the project it is scoped to.
    <Hint
      label={search.scope && !search.onBoard ? `${label} (${search.scope.name})` : label}
      describe={!!search.scope && !search.onBoard}
    >
      <motion.button
        type="button"
        aria-label={label}
        aria-expanded={search.filtersOpen}
        onPointerDown={(event) => event.preventDefault()}
        onClick={search.toggleFilters}
        whileTap={{ scale: 0.88 }}
        transition={springs.snappy}
        className={cn(
          'glass relative flex size-[var(--dock-height)] shrink-0 items-center justify-center rounded-[var(--dock-radius)] outline-none transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-ring/70',
          search.filtersOpen || active ? 'text-brand-link' : 'text-foreground',
        )}
      >
        <SlidersHorizontal className="size-7" strokeWidth={2.25} aria-hidden />
        {active && (
          <span aria-hidden className="absolute top-3 right-3 size-1.5 rounded-full bg-brand" />
        )}
      </motion.button>
    </Hint>
  );
}

/** What the filter button opens: the board's filters over a board, else the project scope. */
export function FilterOptions({ search }: { search: SearchState }) {
  return search.onBoard ? <BoardFilters /> : <ScopeOptions search={search} />;
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
const NO_TAGS: readonly Tag[] = [];
const NO_IDS: readonly string[] = [];

/**
 * A task found, drawn as its board card is: tinted by its primary tag's root, with its tags,
 * status, size and priority. Across projects it is tinted by its project and its tags go
 * uncolored, as on the cross-project board. The words searched for are highlighted.
 */
function ResultCard({ search, row }: { search: SearchState; row: SearchState['results'][number] }) {
  const [settings] = useBoardSettings();
  const { task, project, status } = row;
  const { query } = search;
  const tags = search.tagsByProject.get(project.id) ?? NO_TAGS;
  const color = search.scoped ? taskTagColor(task, tags) : project.color;
  const snippet = descriptionSnippet(task.description, query);
  const secondaryTagIds = search.secondaryTags.get(task.id) ?? NO_IDS;
  // A tag the search matched shows on its badge; one above the card's tags (Home, for a card
  // tagged Garden under it) is named beside the identifier instead, so the card says why.
  const badges = new Set(
    tags
      .filter((tag) => tag.id === task.primaryTagId || secondaryTagIds.includes(tag.id))
      .map((tag) => tag.name),
  );
  const ancestors = matchedTags(row.tags, query).filter((name) => !badges.has(name));
  return (
    <button
      type="button"
      {...search.optionProps(task.id)}
      onClick={() => search.actions.openTask(project.id, task.id)}
      data-color={color ?? undefined}
      className={cn(
        'flex w-full flex-col rounded-2xl border px-4 pt-3.5 pb-3 text-left text-card-foreground outline-none',
        'shadow-[0_1px_2px_oklch(0_0_0/0.06)] transition-shadow duration-150 data-active:ring-[3px] data-active:ring-ring/50',
        color ? 'border-transparent bg-tint' : 'border-border bg-card',
      )}
    >
      <span className="line-clamp-4 font-medium text-[0.9375rem] leading-snug [overflow-wrap:anywhere] max-md:text-base">
        {task.title ? <Highlighted segments={highlight(task.title, query)} /> : 'Untitled task'}
      </span>
      {snippet && (
        <span className="mt-1 line-clamp-2 text-muted-foreground text-sm">
          <Highlighted segments={snippet} />
        </span>
      )}
      <TaskTags
        tags={tags}
        primaryTagId={task.primaryTagId}
        secondaryTagIds={secondaryTagIds}
        card
        colored={search.scoped}
        className="mt-2.5"
      />
      <span className="mt-3 flex min-h-5 w-full min-w-0 items-center gap-2.5 text-foreground/55 text-xs max-md:text-[0.8125rem]">
        <span className="shrink-0 font-medium tabular-nums">
          {row.identifier ? <Highlighted segments={highlight(row.identifier, query)} /> : 'Pending'}
        </span>
        {!search.scoped && (
          <span data-color={project.color} className="flex min-w-0 items-center gap-1">
            <ProjectIcon name={project.icon} className="size-3.5 shrink-0 text-tint-accent" />
            <span className="truncate">{project.name}</span>
          </span>
        )}
        {ancestors.map((name) => (
          <span key={name} className="flex min-w-0 items-center gap-1">
            <TagGlyph className="size-3 shrink-0" aria-label="Tag" />
            <span className="truncate">
              <Highlighted segments={highlight(name, query)} />
            </span>
          </span>
        ))}
        <span className="flex-1" />
        <span className="flex min-w-0 items-center gap-1">
          {status && (
            <StatusGlyph category={status.category} color={status.color} className="size-3" />
          )}
          <span className="truncate">{status?.name ?? 'No status'}</span>
        </span>
        {settings.cardSize && task.size !== null && (
          <span className="shrink-0 rounded-md bg-foreground/[0.06] px-1.5 font-medium">
            <span className="sr-only">Size </span>
            {sizeLabel(task.size)}
          </span>
        )}
        {settings.cardPriority && task.closedAt === null && (
          <PriorityGlyph
            priority={task.priority}
            name={
              project.priorityNames[task.priority - 1] || DEFAULT_PRIORITY_NAMES[task.priority - 1]!
            }
          />
        )}
      </span>
    </button>
  );
}

/**
 * How many of the first results move as Catch's do. A change of words scrolls the list back to
 * its best match, so these are the cards in view; the rest change in place, out of sight.
 */
const MOVING_RESULTS = 10;

/**
 * The results as Catch's search lists them: a card rises in, a card leaving shrinks away, and
 * the rest slide to their new places. Only the cards in view move, and they are measured only
 * when the order changes: a layout animation measures every card on each render, and the
 * active card follows the pointer, so moving every card cost more than the cards in view.
 */
function ResultList({ search }: { search: SearchState }) {
  const reduced = useReducedMotion();
  const { results } = search;
  const order = results.map((row) => row.task.id).join(' ');
  return (
    // Positioned, so a card leaving is held in place as the others close the gap.
    <ul className="relative flex flex-col gap-2">
      <AnimatePresence initial={false} mode="popLayout">
        {results.map((row, index) => {
          const moving = !reduced && index < MOVING_RESULTS;
          return (
            <motion.li
              key={row.task.id}
              layout={moving && 'position'}
              layoutDependency={order}
              initial={moving ? { opacity: 0, y: 8 } : false}
              animate={{ opacity: 1, y: 0 }}
              exit={moving ? { opacity: 0, scale: 0.97 } : undefined}
              transition={springs.smooth}
            >
              <ResultCard search={search} row={row} />
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}

export function SearchResults({ search }: { search: SearchState }) {
  const { scope, title, results, projects, actions, destination, backlog } = search;
  return (
    <>
      {search.onBoard && (
        // Removing a chip leaves the keyboard as it was, as the filter card does.
        <div {...keepFocus}>
          <ActiveFilters state={search.onBoard} className="pb-4 empty:hidden" />
        </div>
      )}
      {/* In place, fading in on the chip itself (a fading parent would cut its blur off from
          what is behind it): growing its height would re-lay out every result each frame. */}
      {scope && !search.onBoard && (
        <div className="flex flex-wrap items-center gap-2 pb-4">
          <motion.button
            key={scope.id}
            type="button"
            data-color={scope.color}
            aria-label={`Remove ${scope.name} filter`}
            onPointerDown={(event) => event.preventDefault()}
            onClick={search.clearScope}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={curves.fade}
            className="glass-badge flex min-h-9 items-center gap-2 rounded-md px-2.5 font-medium text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <ProjectIcon name={scope.icon} className="size-3.5 text-tint-accent" />
            {scope.name}
            <X className="size-3.5" aria-hidden />
          </motion.button>
        </div>
      )}
      <div id={`${search.id}-results`} role="listbox" aria-label="Tasks, projects and capture">
        {!title && !search.browsing ? (
          <p className="px-1 pb-5 text-muted-foreground text-sm">
            Search titles, descriptions and tags, or go straight to a task with its identifier.
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
              {search.browsing && ' on the board'}
            </p>
            <ResultList search={search} />
          </section>
        ) : (
          projects.length === 0 && (
            <div className="pb-6">
              <EmptyState icon={SearchX} title="No matching tasks">
                {search.browsing
                  ? 'Nothing on the board matches these filters.'
                  : scope && !search.scoped
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
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* A size container, so the filter card can fit the room above the field however the
          keyboard leaves it. */}
      <div className="relative flex min-h-0 flex-1 flex-col [container-type:size]">
        <ScrollArea edges className="flex-1 [--scrollbar-inset:0.5rem]">
          <ScrollAreaViewport ref={search.list}>
            {/* Few results sit by the field; more scroll from the best one down. The drawer is
                glass already: chips drawn on it skip a blur of their own, which every frame of
                the results moving would have redrawn. */}
            <div className="mt-auto px-4 pt-2 pb-3 [&_.glass-badge]:[backdrop-filter:none]">
              <SearchResults search={search} />
            </div>
          </ScrollAreaViewport>
          <ScrollBar />
        </ScrollArea>
        {/* As in Catch, the filter card covers the results rather than pushing them away. */}
        <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-col justify-end">
          <AnimatePresence initial={false}>
            {search.filtersOpen && (
              // The board's filter sections fit what is left above their tabs.
              <FilterCard
                key="filters"
                solid
                className="flex max-h-[calc(100cqh-1.5rem)] flex-col overflow-hidden rounded-[var(--dock-radius)] shadow-[0_10px_30px_-10px_var(--glass-shadow)] [--board-filter-view-max:min(24rem,calc(100cqh-6.75rem))]"
              >
                <ScrollArea
                  edges
                  className="flex min-h-0 flex-1 flex-col [--scrollbar-inset:0.75rem]"
                >
                  <ScrollAreaViewport className="h-auto w-full min-h-0 flex-1">
                    <div className="p-3">
                      <FilterOptions search={search} />
                    </div>
                  </ScrollAreaViewport>
                  <ScrollBar />
                </ScrollArea>
              </FilterCard>
            )}
          </AnimatePresence>
        </div>
      </div>
      {/* Clear of the gesture bar with the keyboard down; just above the keyboard when up. */}
      <div className="flex shrink-0 items-end gap-3 px-3 pt-1 pb-[max(0.5rem,calc(var(--safe-bottom)+0.75rem-var(--keyboard)))]">
        <SearchField search={search} inputRef={inputRef} onClose={onClose} />
        {(!search.scoped || search.onBoard) && <FilterButton search={search} />}
      </div>
    </div>
  );
}
