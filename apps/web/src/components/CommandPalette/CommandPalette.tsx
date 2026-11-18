import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import { Dialog } from 'radix-ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useBackHandler } from '@/lib/backButton';
import { useMedia } from '@/lib/media';
import { springs } from '@/lib/motion';
import { type Dismiss, focusPaletteInput, type PaletteActions, usePaletteActions } from './actions';
import { CaptureContent } from './CaptureContent';
import {
  FilterButton,
  PhoneSearchContent,
  ScopeOptions,
  SearchField,
  SearchResults,
  type SearchState,
  useSearch,
} from './SearchContent';

export type PaletteMode = 'search' | 'capture';

type Props = {
  mode: PaletteMode | null;
  onClose: () => void;
  onOpenTask: (projectId: string, taskId: string, created?: boolean) => void;
  /** Search hands a title it cannot place to capture, which can choose a project. */
  onModeChange?: (mode: PaletteMode) => void;
};

type Destination = 'opener' | 'task' | 'project';

/**
 * Catch's search and quick note, for tasks. The content (`SearchContent`, `CaptureContent`)
 * is drawn by a surface: on desktop a dock-shaped search field with result cards above it,
 * or a card-colored capture window; on a phone, the drawer (ADR 0009). One dialog holds
 * whichever is open, takes Escape and Back, and returns focus to what opened it.
 */
export function CommandPalette({ mode, onClose, onOpenTask, onModeChange }: Props) {
  const opener = useRef<HTMLElement | null>(null);
  const returnFocus = useRef<Destination>('opener');
  const dismiss: Dismiss = useRef(null);
  const [seed, setSeed] = useState('');
  useBackHandler(mode !== null, () => {
    if (!dismiss.current?.()) onClose();
  });
  useEffect(() => {
    if (mode === null) setSeed('');
  }, [mode]);
  // Noted before any child effect can move focus into the palette.
  const open = mode !== null;
  useLayoutEffect(() => {
    if (!open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    returnFocus.current = 'opener';
  }, [open]);

  return (
    <Dialog.Root
      open={mode !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AnimatePresence>
        {mode && (
          <Dialog.Portal forceMount>
            <Dialog.Content
              forceMount
              aria-describedby={undefined}
              className="fixed inset-0 z-[70] outline-none"
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                focusPaletteInput();
              }}
              onEscapeKeyDown={(event) => {
                if (dismiss.current?.()) event.preventDefault();
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (returnFocus.current === 'opener' && opener.current?.isConnected)
                  opener.current.focus({ preventScroll: true });
                else if (returnFocus.current === 'task')
                  document
                    .querySelector<HTMLElement>(
                      '[aria-label="Task"] [aria-label="Task navigation"] button',
                    )
                    ?.focus({ preventScroll: true });
              }}
            >
              <Surfaces
                mode={mode}
                seed={seed}
                dismiss={dismiss}
                onClose={onClose}
                onOpenTask={onOpenTask}
                onAction={(destination) => {
                  returnFocus.current = destination;
                }}
                onCaptureTitle={(title) => {
                  setSeed(title);
                  onModeChange?.('capture');
                }}
              />
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

type SurfaceProps = {
  mode: PaletteMode;
  seed: string;
  dismiss: Dismiss;
  onClose: () => void;
  onOpenTask: Props['onOpenTask'];
  onAction: (destination: 'task' | 'project') => void;
  onCaptureTitle: (title: string) => void;
};

function Surfaces(props: SurfaceProps) {
  const desktop = useMedia('(min-width: 768px)');
  const actions = usePaletteActions(props);
  const shown = useRef(props.mode);
  // Switching from search to capture moves focus to the new input, unless the capture
  // content opened on its project list, which focuses its own search.
  useEffect(() => {
    if (shown.current === props.mode) return;
    shown.current = props.mode;
    const focused = document.activeElement;
    if (!(focused instanceof HTMLInputElement && focused.type === 'search')) focusPaletteInput();
  }, [props.mode]);

  const inner = { ...props, actions };
  if (!desktop) return <PhoneSurface key={props.mode} {...inner} />;
  return (
    <AnimatePresence mode="popLayout">
      {props.mode === 'search' ? (
        <DesktopSearch key="search" {...inner} />
      ) : (
        <DesktopCapture key="capture" {...inner} />
      )}
    </AnimatePresence>
  );
}

type InnerProps = SurfaceProps & { actions: PaletteActions };

function DesktopSearch({ dismiss, onClose, onCaptureTitle, actions }: InnerProps) {
  const present = useIsPresent();
  const reduced = useReducedMotion();
  const search = useSearch({ actions, dismiss, onCaptureTitle });
  const fade = reduced ? { duration: 0 } : { duration: 0.2 };
  return (
    <motion.div className="absolute inset-0" exit={{ opacity: 0 }} transition={fade}>
      <Dialog.Title className="sr-only">Search</Dialog.Title>
      <motion.div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black/25"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={fade}
      />
      <div className="pointer-events-none relative mx-auto flex h-full w-full max-w-xl flex-col justify-end px-3 pt-[12vh] pb-8">
        <motion.div
          ref={search.list}
          className="glass-thick pointer-events-auto mb-3 max-h-[min(62dvh,38rem)] min-h-0 flex-[0_1_auto] overflow-y-auto overscroll-contain rounded-[28px] p-3"
          initial={{ opacity: 0, y: reduced ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduced ? { duration: 0 } : { ...springs.smooth, delay: 0.05 }}
        >
          <SearchResults search={search} />
        </motion.div>
        <ScopePanel search={search} />
        <motion.div
          className="pointer-events-auto flex shrink-0 items-end gap-3"
          initial={{ opacity: 0, y: reduced ? 0 : 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduced ? { duration: 0 } : springs.smooth}
        >
          <SearchField search={search} disabled={!present} onClose={onClose} />
          {!search.scoped && <FilterButton search={search} />}
        </motion.div>
      </div>
    </motion.div>
  );
}

/** Catch's filter panel: glass rising above the field. */
function ScopePanel({ search }: { search: SearchState }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {search.filtersOpen && (
        <motion.div
          key="filters"
          className="pointer-events-auto shrink-0 overflow-hidden"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={reduced ? { duration: 0 } : springs.smooth}
        >
          <div className="glass mb-3 rounded-[var(--dock-radius)] p-3">
            <ScopeOptions search={search} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DesktopCapture({ seed, dismiss, onClose, actions }: InnerProps) {
  const present = useIsPresent();
  const reduced = useReducedMotion();
  const hidden = reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -8 };
  return (
    <motion.div className="absolute inset-0" exit={{ opacity: 1 }}>
      <Dialog.Title className="sr-only">New task</Dialog.Title>
      <motion.div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black/25"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduced ? 0 : 0.25 }}
      />
      <motion.section
        aria-label="New task"
        initial={hidden}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ ...hidden, transition: reduced ? { duration: 0 } : springs.smooth }}
        transition={reduced ? { duration: 0 } : springs.bouncy}
        style={{ transformOrigin: 'center top' }}
        className="absolute inset-x-3 top-[18vh] mx-auto flex max-h-[70dvh] max-w-lg flex-col overflow-hidden rounded-[28px] bg-card text-card-foreground shadow-[0_24px_60px_-12px_oklch(0_0_0/0.45)]"
      >
        <CaptureContent actions={actions} seed={seed} dismiss={dismiss} disabled={!present} />
      </motion.section>
    </motion.div>
  );
}

/**
 * Interim phone surface where no drawer is mounted (the cross-project board, settings). On a
 * project board, search and capture live in its drawer (`PhonePalette`); this goes once the
 * drawer moves to the shell. Kept deliberately plain.
 */
function PhoneSurface({ mode, seed, dismiss, onClose, onCaptureTitle, actions }: InnerProps) {
  return (
    <div className="absolute inset-0">
      <Dialog.Title className="sr-only">{mode === 'search' ? 'Search' : 'New task'}</Dialog.Title>
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-black/25" />
      <section
        aria-label={mode === 'search' ? 'Search' : 'New task'}
        className="glass-thick absolute inset-x-0 top-[calc(var(--safe-top)+0.5rem)] bottom-[var(--keyboard)] mx-auto flex w-full max-w-md flex-col overflow-hidden rounded-t-[1.75rem] pr-[var(--safe-right)] pl-[var(--safe-left)]"
      >
        {mode === 'search' ? (
          <PhoneSearch
            actions={actions}
            dismiss={dismiss}
            onClose={onClose}
            onCaptureTitle={onCaptureTitle}
          />
        ) : (
          <CaptureContent actions={actions} seed={seed} dismiss={dismiss} onClose={onClose} />
        )}
      </section>
    </div>
  );
}

function PhoneSearch({
  actions,
  dismiss,
  onClose,
  onCaptureTitle,
}: Pick<InnerProps, 'actions' | 'dismiss' | 'onClose' | 'onCaptureTitle'>) {
  const search = useSearch({ actions, dismiss, onCaptureTitle });
  return <PhoneSearchContent search={search} onClose={onClose} />;
}
