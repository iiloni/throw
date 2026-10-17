import { ArrowUp, ChevronsUpDown, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { useShell } from '@/components/AppShell/shell';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import {
  backlogOf,
  type Dismiss,
  focusPaletteInput,
  MAX_TITLE,
  type PaletteActions,
} from './actions';
import { ProjectBadge, ProjectOptions } from './ProjectOptions';

/**
 * Catch's quick note for a task: the title, a project chip that opens a searchable list in
 * place, the backlog status it lands in and create. The surface around it (the desktop
 * window or the phone's drawer) owns its chrome, gestures, Back and focus on open.
 */
export function CaptureContent({
  actions,
  seed,
  dismiss,
  disabled,
  onClose,
}: {
  actions: PaletteActions;
  /** A title handed over from search, which opens on the project list when none is current. */
  seed: string;
  dismiss: Dismiss;
  disabled?: boolean;
  /** Shows a header with a close button, for the drawer; the desktop window has none. */
  onClose?: () => void;
}) {
  const shell = useShell();
  const reduced = useReducedMotion();
  const [title, setTitle] = useState(seed);
  const [projectId, setProjectId] = useState(shell.project?.id ?? '');
  const [choosing, setChoosing] = useState(!!seed && !shell.project);
  const [error, setError] = useState('');
  const chosen = shell.projects.find((p) => p.id === projectId);
  const backlog = backlogOf(actions.statuses, chosen?.id);
  const trimmed = title.trim();
  const tooLong = trimmed.length > MAX_TITLE;
  const canCreate = trimmed.length > 0 && !tooLong && !!backlog;
  const notice = tooLong
    ? 'Use 500 characters or fewer.'
    : chosen && !backlog
      ? actions.awaitingStatuses
        ? 'Loading statuses…'
        : 'Connect to load this project’s backlog before capturing.'
      : '';

  function closePicker() {
    setChoosing(false);
    focusPaletteInput();
  }
  dismiss.current = () => {
    if (!choosing) return false;
    closePicker();
    return true;
  };

  function create() {
    if (!canCreate) {
      if (!chosen && trimmed) setChoosing(true);
      return;
    }
    setError(actions.create(chosen?.id, title) ?? '');
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {onClose && (
        <header className="flex shrink-0 items-center gap-2 py-2 pr-3 pl-5">
          <h2 className="min-w-0 flex-1 font-display font-semibold text-base">New task</h2>
          <motion.button
            type="button"
            aria-label="Close new task"
            onClick={onClose}
            whileTap={{ scale: 0.88 }}
            transition={springs.snappy}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.06] outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
          >
            <X className="size-5" aria-hidden />
          </motion.button>
        </header>
      )}
      <div className="min-h-0 shrink overflow-y-auto overscroll-contain">
        <textarea
          data-palette-input
          disabled={disabled}
          rows={1}
          aria-label="Task title"
          placeholder="Task title"
          autoComplete="off"
          autoCapitalize="sentences"
          enterKeyHint="done"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value.replace(/\n/g, ' '));
            setError('');
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.key !== 'Enter') return;
            event.preventDefault();
            create();
          }}
          className="field-sizing-content block max-h-48 min-h-14 w-full resize-none bg-transparent px-5 pt-4 pb-3 font-display font-semibold text-lg leading-snug tracking-[-0.01em] outline-none placeholder:text-muted-foreground md:pt-5"
        />
      </div>
      <AnimatePresence initial={false}>
        {choosing && (
          <motion.div
            key="projects"
            className="shrink-0 overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduced ? { duration: 0 } : springs.smooth}
          >
            <div className="px-3 pb-2">
              <ProjectOptions
                label="Capture in"
                searchLabel="Find capture project"
                options={shell.projects.map((project) => ({
                  value: project.id,
                  label: project.name,
                  keywords: project.key ?? '',
                  icon: <ProjectBadge color={project.color} icon={project.icon} />,
                }))}
                value={projectId}
                onChange={(value) => {
                  setProjectId(value);
                  setError('');
                  closePicker();
                }}
                onDismiss={closePicker}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {(notice || error) && (
        <p
          role={error || tooLong ? 'alert' : 'status'}
          className={cn(
            'px-5 pb-2 text-sm',
            error || tooLong ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {error || notice}
        </p>
      )}
      <footer className="flex shrink-0 items-center gap-1.5 px-3 pt-1 pb-3">
        <motion.button
          type="button"
          aria-label="Choose capture project"
          aria-expanded={choosing}
          // Keeps the keyboard up, like Catch's quick-note tools.
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => (choosing ? closePicker() : setChoosing(true))}
          whileTap={{ scale: 0.94 }}
          transition={springs.snappy}
          className="flex h-9 min-w-0 items-center gap-2 rounded-xl bg-foreground/[0.07] pr-2 pl-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          {chosen ? (
            <ProjectBadge color={chosen.color} icon={chosen.icon} />
          ) : (
            <span className="size-7 shrink-0" />
          )}
          <span className="min-w-0 truncate font-medium">{chosen?.name ?? 'Choose project'}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </motion.button>
        {backlog && (
          <span className="min-w-0 truncate px-1.5 text-muted-foreground text-xs">
            {backlog.name}
          </span>
        )}
        <span className="flex-1" />
        <motion.button
          type="button"
          aria-label="Create task"
          disabled={!trimmed}
          onPointerDown={(event) => event.preventDefault()}
          onClick={create}
          whileTap={{ scale: 0.88 }}
          transition={springs.snappy}
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/70',
            canCreate
              ? 'bg-brand text-brand-foreground shadow-[0_6px_16px_-6px_color-mix(in_oklab,var(--brand)_60%,transparent),inset_0_1px_0_rgb(255_255_255/0.45)]'
              : 'bg-foreground/[0.07] text-muted-foreground',
          )}
        >
          <ArrowUp className="size-5" strokeWidth={2.25} aria-hidden />
        </motion.button>
      </footer>
    </div>
  );
}
