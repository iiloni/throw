import { DEFAULT_PRIORITY, type Priority, taskTagColor } from '@throw/shared';
import { ArrowUp } from 'lucide-react';
import { motion } from 'motion/react';
import { type ReactNode, type RefObject, useRef, useState } from 'react';
import { useShell } from '@/components/AppShell/shell';
import type { Project } from '@/components/Board/model';
import type { DrawerCard, DrawerPage } from '@/components/Drawer/Drawer';
import { TagPicker } from '@/components/TagPicker/TagPicker';
import { ControlButtons, panelTitle } from '@/components/TaskDetails/TaskControls';
import { PriorityOptions, StatusOptions } from '@/components/TaskDetails/TaskPickers';
import { useStatuses, useTags } from '@/lib/collections';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { backlogOf, type Dismiss, MAX_TITLE, usePaletteActions } from './actions';
import { PhoneSearchContent, useSearch } from './SearchContent';

/** What quick capture has been told so far. Without a status, it lands in the backlog. */
type Draft = {
  title: string;
  statusId: string | undefined;
  priority: Priority;
  primaryTagId: string | null;
  secondaryTagIds: string[];
};

export type CapturePanel = 'status' | 'priority' | 'tags';

export type PhoneCapture = {
  /** The card above the dock while a task is being written. */
  card: DrawerCard | null;
  /** The dock's face while the card is up: the new task's status, priority and tags. */
  controls: ReactNode;
  /** A picker opened from those controls, under the dock as its tabs. */
  page: DrawerPage | null;
  closePage: () => void;
  open: (statusId?: string, title?: string) => void;
  close: () => void;
};

/**
 * Search and capture on a phone's project board, in its drawer (ADR 0009). Search is a page:
 * results above Catch's glass field, which the drawer focuses so the keyboard rises with it.
 * Capture is Catch's quick note: a card above the dock, while the dock holds the new task's
 * status, priority and tags, whose pickers open beneath it and put the keyboard away. Both
 * stay within the board's project. The drawer owns the surfaces, Escape, Back and focus.
 */
export function usePhonePalette({
  project,
  onSearchPage,
}: {
  /** The board's project, for its priority names. */
  project: Project;
  onSearchPage: (open: boolean) => void;
}): { search: DrawerPage; capture: PhoneCapture } {
  const dismiss: Dismiss = useRef(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const title = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [panel, setPanel] = useState<CapturePanel | null>(null);
  const change = (next: Partial<Draft>) => setDraft((before) => before && { ...before, ...next });
  const close = () => {
    setPanel(null);
    setDraft(null);
  };
  const open = (statusId?: string, seed = '') => {
    setPanel(null);
    setDraft({
      title: seed,
      statusId,
      priority: DEFAULT_PRIORITY,
      primaryTagId: null,
      secondaryTagIds: [],
    });
  };

  return {
    search: {
      key: 'search',
      title: 'Search',
      focus: searchInput,
      dismiss: () => dismiss.current?.() ?? false,
      content: (
        <SearchPage
          inputRef={searchInput}
          dismiss={dismiss}
          onClose={() => onSearchPage(false)}
          // A project board always has somewhere to put a title, so this is a fallback.
          onCaptureTitle={(seed) => {
            onSearchPage(false);
            open(undefined, seed);
          }}
        />
      ),
    },
    capture: {
      card: draft && {
        key: 'capture',
        title: 'New task',
        focus: title,
        onClose: close,
        content: <CaptureCard draft={draft} titleRef={title} onChange={change} onClose={close} />,
      },
      controls: draft && (
        <CaptureControls
          draft={draft}
          project={project}
          panel={panel}
          onPanel={(next) => setPanel(next === panel ? null : next)}
        />
      ),
      page:
        draft && panel
          ? {
              key: `capture-${panel}`,
              title: panelTitle[panel],
              fit: true,
              dock: true,
              content: (
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(var(--safe-bottom)+1rem)]">
                  <CapturePanelContent
                    panel={panel}
                    draft={draft}
                    project={project}
                    onChange={change}
                    onDone={() => setPanel(null)}
                  />
                </div>
              ),
            }
          : null,
      closePage: () => setPanel(null),
      open,
      close,
    },
  };
}

function SearchPage({
  inputRef,
  dismiss,
  onClose,
  onCaptureTitle,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  dismiss: Dismiss;
  onClose: () => void;
  onCaptureTitle: (title: string) => void;
}) {
  const shell = useShell();
  // The drawer returns focus to what opened the page; an opened task takes it from there.
  const actions = usePaletteActions({ onClose, onOpenTask: shell.openTask, onAction: () => {} });
  const search = useSearch({ actions, dismiss, onCaptureTitle });
  return <PhoneSearchContent search={search} inputRef={inputRef} />;
}

/** The statuses and tags of the board's project, as capture offers them. */
function useCaptureOptions(draft: Draft) {
  const projectId = useShell().project?.id;
  const statuses = useStatuses().statuses.filter((row) => row.projectId === projectId);
  const { tags } = useTags(projectId ?? '');
  const status = draft.statusId
    ? statuses.find((row) => row.id === draft.statusId)
    : backlogOf(statuses, projectId);
  return { projectId, statuses, status, tags };
}

/** Catch's quick-note card for a task: its title, where it lands, and create. */
function CaptureCard({
  draft,
  titleRef,
  onChange,
  onClose,
}: {
  draft: Draft;
  titleRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (next: Partial<Draft>) => void;
  onClose: () => void;
}) {
  const shell = useShell();
  const actions = usePaletteActions({ onClose, onOpenTask: shell.openTask, onAction: () => {} });
  const { projectId, status } = useCaptureOptions(draft);
  const [error, setError] = useState('');
  const trimmed = draft.title.trim();
  const tooLong = trimmed.length > MAX_TITLE;
  const canCreate = trimmed.length > 0 && !tooLong && !!status;
  const notice = tooLong
    ? 'Use 500 characters or fewer.'
    : !status
      ? actions.awaitingStatuses
        ? 'Loading statuses…'
        : 'Connect to load this project’s backlog before capturing.'
      : '';

  function create() {
    if (!canCreate) return;
    setError(
      actions.create(projectId, draft.title, {
        statusId: status?.id,
        priority: draft.priority,
        primaryTagId: draft.primaryTagId,
        secondaryTagIds: draft.secondaryTagIds,
      }) ?? '',
    );
  }

  return (
    <>
      <div className="min-h-0 shrink overflow-y-auto overscroll-contain">
        <textarea
          ref={titleRef}
          data-palette-input
          rows={1}
          aria-label="Task title"
          placeholder="Task title"
          autoComplete="off"
          autoCapitalize="sentences"
          enterKeyHint="done"
          value={draft.title}
          onChange={(event) => {
            onChange({ title: event.target.value.replace(/\n/g, ' ') });
            setError('');
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.key !== 'Enter') return;
            event.preventDefault();
            create();
          }}
          className="field-sizing-content block max-h-48 min-h-14 w-full resize-none bg-transparent px-5 pt-4 pb-2 font-display font-semibold text-lg leading-snug tracking-[-0.01em] outline-none placeholder:text-muted-foreground"
        />
      </div>
      {(notice || error) && (
        <p
          role={error || tooLong ? 'alert' : 'status'}
          className={cn(
            'px-5 pb-1 text-sm',
            error || tooLong ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {error || notice}
        </p>
      )}
      <footer className="flex shrink-0 items-center gap-1.5 pt-1 pr-3 pb-3 pl-5">
        <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
          {status?.name}
        </span>
        <motion.button
          type="button"
          aria-label="Create task"
          disabled={!trimmed}
          // Keeps the keyboard up, like Catch's quick-note tools.
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
    </>
  );
}

/** The dock while capturing: an open task's controls, for the task being written. */
function CaptureControls({
  draft,
  project,
  panel,
  onPanel,
}: {
  draft: Draft;
  project: Project;
  panel: CapturePanel | null;
  onPanel: (panel: CapturePanel) => void;
}) {
  const { projectId, status, tags } = useCaptureOptions(draft);
  const chosen = [
    ...tags.filter((tag) => tag.id === draft.primaryTagId),
    ...tags
      .filter((tag) => draft.secondaryTagIds.includes(tag.id) && tag.id !== draft.primaryTagId)
      .sort((a, b) => a.name.localeCompare(b.name)),
  ];
  return (
    <div role="toolbar" aria-label="New task controls">
      <ControlButtons
        status={status}
        priority={draft.priority}
        project={project}
        tags={
          tags.length > 0
            ? {
                names: chosen.map((tag) => tag.name),
                color: taskTagColor(
                  { primaryTagId: draft.primaryTagId, projectId: projectId ?? '' },
                  tags,
                ),
              }
            : null
        }
        // Opening a picker moves focus off the title, which puts the keyboard away.
        onOpen={(next) => {
          if (next !== 'more') onPanel(next);
        }}
        controlProps={(next) => ({ 'aria-expanded': next === panel })}
        tooltips={false}
      />
    </div>
  );
}

function CapturePanelContent({
  panel,
  draft,
  project,
  onChange,
  onDone,
}: {
  panel: CapturePanel;
  draft: Draft;
  project: Project;
  onChange: (next: Partial<Draft>) => void;
  onDone: () => void;
}) {
  const { statuses, status, tags } = useCaptureOptions(draft);
  if (panel === 'status')
    return (
      <StatusOptions
        value={status?.id ?? ''}
        statuses={statuses}
        onChange={(statusId) => {
          onChange({ statusId });
          onDone();
        }}
      />
    );
  if (panel === 'priority')
    return (
      <PriorityOptions
        value={draft.priority}
        project={project}
        onChange={(priority) => {
          onChange({ priority });
          onDone();
        }}
      />
    );
  return (
    <div className="px-5 pt-1 pb-3">
      <TagPicker
        tags={tags}
        primaryTagId={draft.primaryTagId}
        secondaryTagIds={draft.secondaryTagIds}
        onPrimaryChange={(primaryTagId) =>
          onChange({
            primaryTagId,
            secondaryTagIds: draft.secondaryTagIds.filter((id) => id !== primaryTagId),
          })
        }
        onSecondaryChange={(id, present) =>
          onChange({
            secondaryTagIds: present
              ? [...new Set([...draft.secondaryTagIds, id])]
              : draft.secondaryTagIds.filter((other) => other !== id),
          })
        }
      />
    </div>
  );
}
