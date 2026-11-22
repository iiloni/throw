import { Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  type KeyboardEvent,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ShellContext } from '@/components/AppShell/shell';
import { bestMatch, chosenFilters } from '@/components/Board/filter';
import { identifier, isClosed, statusById } from '@/components/Board/model';
import {
  board,
  clearFilters,
  closeSearch,
  createTask as createBoardTask,
  current,
  narrowed,
  setFilter,
  update,
  visibleIds,
} from '@/components/Board/state';
import { Hint } from '@/components/Hint/Hint';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { createTask } from '@/lib/tasks';
import { cn } from '@/lib/utils';
import { ActiveFilters, BoardFilters, hasChips } from './BoardFilters';

/** Room the open bar takes at the foot of the board, so a column's last card can scroll clear. */
export const SEARCH_SPACE = 'var(--board-search-space, 0.25rem)';

/**
 * Catch's search, over a live board: a glass field and filter button floating at the foot of
 * the board, beside (never over) an open task. It is not a dialog. What is typed and chosen
 * narrows the board in place, so a card that matches can be opened, dragged or carried while
 * the search stays open. Enter opens the best match; Ctrl/⌘Enter captures the words as a task.
 * Escape closes the filter panel, then clears the search, then closes the bar.
 */
export function BoardSearch() {
  const state = board.use();
  const reduced = useReducedMotion();
  const root = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);
  const searching = state.searching;
  const [panel, setPanel] = useState(false);
  const capture = useCapture();

  // Whatever had focus when the bar opened gets it back when it closes.
  useLayoutEffect(() => {
    if (!searching) return;
    const active = document.activeElement;
    opener.current = active && !root.current?.contains(active) ? active : null;
  }, [searching]);
  useEffect(() => {
    if (!searching) setPanel(false);
  }, [searching]);
  // As in Catch, the panel goes when the board is used: a press anywhere outside the bar.
  useEffect(() => {
    if (!panel) return;
    function away(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setPanel(false);
    }
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [panel]);

  // The columns pad their ends by the bar's height, so nothing is left beneath it for good.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the bar mounts and unmounts with `searching`
  useLayoutEffect(() => {
    const element = root.current;
    // On the root, so the selection bar, which floats from the window, can rise above it too.
    const host = document.documentElement;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      host.style.setProperty('--board-search-space', `${element.offsetHeight + 12}px`);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      host.style.removeProperty('--board-search-space');
    };
  }, [searching]);

  function dismiss() {
    closeSearch();
    const back = opener.current;
    if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
    else document.querySelector<HTMLElement>('#main-content')?.focus({ preventScroll: true });
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    if (panel) {
      setPanel(false);
      root.current?.querySelector<HTMLElement>('[data-board-filter-trigger]')?.focus();
    } else if (narrowed(board.get())) clearFilters();
    else dismiss();
  }

  return (
    <AnimatePresence>
      {searching && (
        <motion.div
          key="search"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-6 pb-[max(1.25rem,calc(var(--safe-bottom)+0.75rem))]"
          initial={{ opacity: 0, y: reduced ? 0 : 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduced ? 0 : 16 }}
          transition={reduced ? { duration: 0 } : springs.smooth}
        >
          <search
            ref={root}
            aria-label="Search the board"
            onKeyDown={onKeyDown}
            className="flex w-full max-w-xl flex-col items-stretch"
          >
            <FilterPanel open={panel} />
            <Chips />
            {capture.error && (
              <p
                role="alert"
                className="glass pointer-events-auto mb-3 rounded-[1.25rem] px-4 py-2.5 text-destructive text-sm"
              >
                {capture.error}
              </p>
            )}
            <div className="pointer-events-auto flex items-end gap-3">
              <SearchField onClose={dismiss} onCapture={capture.create} />
              <FilterButton open={panel} onToggle={() => setPanel(!panel)} />
              <CreateButton onCapture={capture.create} />
            </div>
          </search>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Catch's filter panel: glass rising above the field. */
function FilterPanel({ open }: { open: boolean }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="filters"
          className="pointer-events-auto shrink-0 overflow-hidden"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={reduced ? { duration: 0 } : springs.smooth}
        >
          <section
            id="board-filter-panel"
            aria-label="Filters and sort"
            className="glass-thick mb-3 max-h-[min(34rem,calc(100dvh-var(--dock-height)-9rem))] overflow-y-auto overscroll-contain rounded-[var(--dock-radius)] p-3"
          >
            <BoardFilters />
          </section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The chips of what narrows the board, on their own glass above the field. */
function Chips() {
  const state = board.use();
  const reduced = useReducedMotion();
  const shown = hasChips(state);
  return (
    <AnimatePresence initial={false}>
      {shown && (
        <motion.div
          key="chips"
          className="pointer-events-auto shrink-0 overflow-hidden"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={reduced ? { duration: 0 } : springs.smooth}
        >
          <div className="glass mb-3 rounded-[1.25rem] px-2.5 py-2">
            <ActiveFilters state={state} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SearchField({ onClose, onCapture }: { onClose: () => void; onCapture: () => void }) {
  const state = board.use();
  const data = current(state);
  const { filter } = state;
  const visible = visibleIds(state);
  const words = filter.query.trim();
  const best = useMemo(
    () =>
      words
        ? bestMatch(data, filter, (task) => {
            const status = statusById(data.project, task.statusId);
            return status ? isClosed(status.category) : false;
          })
        : undefined,
    [data, filter, words],
  );
  const count = visible?.size ?? 0;
  const summary = !visible
    ? ''
    : count === 0
      ? 'No matching tasks'
      : `${count} matching${best ? `. Enter opens ${identifier(data.project, best) ?? best.title}` : ''}`;

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) return onCapture();
    if (!best) return;
    update({ openTaskId: best.id });
    // The open task takes focus, as choosing a result did; the search stays as it was.
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>('[aria-label="Task"] [aria-label="Task navigation"] button')
        ?.focus({ preventScroll: true }),
    );
  }

  return (
    <div className="glass relative flex h-[var(--dock-height)] min-w-0 flex-1 items-center gap-2 rounded-[var(--dock-radius)] pr-1.5 pl-4">
      <Search className="size-6 shrink-0" aria-hidden />
      <input
        data-board-search-input=""
        type="search"
        aria-label="Search tasks"
        aria-describedby="board-search-summary"
        aria-keyshortcuts="Enter Control+Enter Meta+Enter Escape"
        placeholder="Search this board"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="search"
        value={filter.query}
        onChange={(event) => setFilter({ query: event.target.value })}
        onKeyDown={onKeyDown}
        className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      <span
        id="board-search-summary"
        aria-live="polite"
        className={cn('shrink-0 text-muted-foreground text-xs tabular-nums', !visible && 'sr-only')}
      >
        <span aria-hidden>{visible ? (count === 0 ? 'None' : `${count} matching`) : ''}</span>
        <span className="sr-only">{summary}</span>
      </span>
      <Hint label="Close search">
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
      </Hint>
    </div>
  );
}

/** Catch's filter button, with a count of what is chosen while anything is. */
function FilterButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const state = board.use();
  const chosen = chosenFilters(state.filter) + Number(state.sort !== 'priority');
  const label = 'Filter and sort';
  return (
    <Hint label={chosen ? `${label} (${chosen} active)` : label} describe={chosen > 0}>
      <motion.button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls="board-filter-panel"
        data-board-filter-trigger=""
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          haptics.toggle();
          onToggle();
        }}
        whileTap={{ scale: 0.88 }}
        transition={springs.snappy}
        className={cn(
          'glass relative flex size-[var(--dock-height)] shrink-0 items-center justify-center rounded-[var(--dock-radius)] outline-none transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-ring/70',
          open || chosen ? 'text-brand-link' : 'text-foreground',
        )}
      >
        <SlidersHorizontal className="size-7" strokeWidth={2.25} aria-hidden />
        {chosen > 0 && (
          <span
            aria-hidden
            className="absolute top-2 right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 font-semibold text-[0.625rem] text-brand-foreground tabular-nums"
          >
            {chosen}
          </span>
        )}
      </motion.button>
    </Hint>
  );
}

/**
 * Quick capture from the bar. A project board captures into its own backlog; the workspace
 * board captures into the project its search is scoped to, and otherwise hands the words to
 * the capture window, which asks for the project.
 */
function useCapture() {
  // The prototype board has no shell, and captures as its own create button does.
  const shell = useContext(ShellContext);
  const [error, setError] = useState('');
  const state = board.use();
  const { project } = current(state);
  const words = state.filter.query.trim();
  const [shownFor, setShownFor] = useState(words);
  if (shownFor !== words) {
    setShownFor(words);
    setError('');
  }
  function create() {
    setError('');
    if (!state.actions || !shell) {
      createBoardTask();
      return;
    }
    const projectId = project.members ? state.filter.projectId : project.id;
    if (!projectId) {
      shell.openPalette('capture', words);
      return;
    }
    if (!words) {
      if (!project.members) createBoardTask();
      else shell.openPalette('capture');
      return;
    }
    try {
      const id = createTask(projectId, { title: words });
      haptics.success();
      setFilter({ query: '' });
      update({ openTaskId: id, backlogFilter: null });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the task. Try again.');
    }
  }
  return { create, error };
}

function CreateButton({ onCapture }: { onCapture: () => void }) {
  const state = board.use();
  const words = state.filter.query.trim();
  const label = words ? `Create “${words}”` : 'New task';
  return (
    <Hint label={`${label} (Ctrl/⌘Enter)`}>
      <motion.button
        type="button"
        aria-label={label}
        aria-keyshortcuts="Control+Enter Meta+Enter"
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          haptics.toggle();
          onCapture();
        }}
        whileTap={{ scale: 0.88 }}
        transition={springs.snappy}
        className="flex size-[var(--dock-height)] shrink-0 items-center justify-center rounded-[var(--dock-radius)] bg-brand text-brand-foreground shadow-[0_2px_6px_-2px_color-mix(in_oklab,var(--brand)_45%,transparent),inset_0_1px_0_rgb(255_255_255/0.35)] outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
      >
        <Plus className="size-7" strokeWidth={2.25} aria-hidden />
      </motion.button>
    </Hint>
  );
}
