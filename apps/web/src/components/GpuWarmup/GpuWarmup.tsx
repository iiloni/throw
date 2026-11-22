import {
  ChevronLeft,
  ChevronRight,
  Flag,
  type LucideIcon,
  MessageSquare,
  Palette,
  Plus,
  Search,
  Tag,
  Trash2,
} from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';
import { PriorityIcon, StatusGlyph } from '@/components/Board/glyphs';
import { DescriptionPreview } from '@/components/DescriptionEditor/DescriptionPreview';

/** After the page is up and its entry animations are over. */
const START_MS = 1200;
/** How long each sample stays: several frames, so it is certain to be drawn. */
const STAGE_MS = 250;

type Stage = 'waiting' | 'task' | 'dock' | 'done';

/**
 * Draws a sample of what an opening task shows, all but invisibly, a moment after the app
 * starts. Catch's `GpuWarmup`, with Throw's task screen and drawer.
 *
 * Why: a phone's GPU builds a pipeline the first time each kind of thing is drawn (text,
 * glass, icons, tinted rounded boxes, ...). The first task opened after a launch draws many
 * kinds for the first time, partly while it grows out of its card, which drops frames in that
 * one transition. Drawn here first, they are built while nothing moves.
 *
 * How: the samples sit in a full-screen box at 1% opacity. The browser skips what cannot be
 * seen (no opacity, hidden, off screen or clipped away), so they have to be faintly there;
 * at 1% they change no pixel by more than a few levels in 255. The task and the dock go in
 * turns, which spreads the one slow frame this costs over two.
 *
 * Keeping it useful: a pipeline goes with a kind of drawing, not with its content, so one of
 * each is enough and the text is filler. When a task or its dock gains something that looks
 * new, add one here. Nothing breaks if it is left out or if a browser stops needing this:
 * the first open only goes back to building pipelines as it draws. To check, trace the
 * Android WebView during a first open and count `VulkanCreateGraphicsPipelines`.
 *
 * It names nothing a person or a test could find: no roles, labels or `data-` hooks.
 */
export function GpuWarmup({ skip = false }: { skip?: boolean }) {
  const [stage, setStage] = useState<Stage>('waiting');

  useEffect(() => {
    if (stage === 'done') return;
    const timer = setTimeout(
      () => setStage(stage === 'waiting' ? 'task' : stage === 'task' ? 'dock' : 'done'),
      stage === 'waiting' ? START_MS : STAGE_MS,
    );
    return () => clearTimeout(timer);
  }, [stage]);

  // A task that is already open has drawn all of this itself.
  if (skip || stage === 'waiting' || stage === 'done') return null;
  return (
    <div
      aria-hidden
      inert
      className="pointer-events-none fixed inset-0 z-[1] opacity-[0.01]"
      style={SAMPLE_TINT}
    >
      {stage === 'task' ? <TaskSample /> : <DockSample />}
    </div>
  );
}

/**
 * A task's and a tag's tint come from `data-color`, which would be a hook a test could find,
 * so the tint is set here: with none, the surface and the badge would draw the plain card.
 */
const SAMPLE_TINT = {
  '--tint': 'oklch(0.925 0.06 25)',
  '--tint-accent': 'oklch(0.5 0.12 25)',
} as CSSProperties;

const icon = (Icon: LucideIcon) => (
  <span className="flex size-10 items-center justify-center">
    <Icon className="size-5" />
  </span>
);

const text = (value: string, styles: Record<string, boolean> = {}) => ({
  type: 'text',
  text: value,
  styles,
});
const block = (type: string, content: unknown[], props: Record<string, unknown> = {}) => ({
  type,
  props,
  content,
  children: [],
});

/** One of each block and inline style a description's stand-in draws. */
const SAMPLE_DESCRIPTION = [
  block('heading', [text('Aa Bb Cc')], { level: 3 }),
  block('paragraph', [
    text('Aa Bb Cc 123 '),
    text('Aa', { bold: true }),
    text(' Bb', { italic: true }),
    text(' Cc', { underline: true }),
    text(' Dd', { strike: true }),
    text(' Ee', { code: true }),
    { type: 'link', href: 'https://example.com', content: [text(' Ff Gg')] },
  ]),
  block('bulletListItem', [text('Aa Bb')]),
  block('numberedListItem', [text('Aa Bb')]),
  block('checkListItem', [text('Aa Bb')], { checked: true }),
  block('quote', [text('Aa Bb')]),
  block('codeBlock', [text('const a = 1;')], { language: 'javascript' }),
  block('divider', []),
];

/**
 * The open task: its tinted rounded surface with the card's edge, glass toolbars, title and
 * description, a tag badge, a subtask row and the comments/history tabs.
 */
function TaskSample() {
  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden rounded-3xl bg-[var(--tint,var(--card))] text-card-foreground shadow-[0_1px_2px_oklch(0_0_0/0.06)]">
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] border border-border" />
      <div className="flex items-start justify-between gap-3 px-3 pt-[calc(var(--safe-top)+0.75rem)]">
        <div className="glass flex min-w-0 items-center rounded-full p-1">
          {icon(ChevronLeft)}
          <span className="flex items-center gap-1 pr-4 text-muted-foreground text-sm tabular-nums">
            AA-1
            <ChevronRight className="size-3" />
            AA-2
          </span>
        </div>
        <div className="glass flex rounded-full p-1">
          <span className="text-destructive">{icon(Trash2)}</span>
        </div>
      </div>
      <div className="px-8 pt-4">
        <p className="mb-1 text-foreground/60 text-sm">Aa Bb</p>
        <p className="font-display font-semibold text-[1.75rem] leading-[1.15] tracking-[-0.02em]">
          Aa Bb Cc
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-1.5">
          <span className="glass-badge relative inline-flex max-w-full items-center gap-1 overflow-hidden rounded-md border-tint-accent/30 px-2.5 py-1 font-medium text-xs [--badge-glass:color-mix(in_oklab,var(--tint)_70%,transparent)]">
            <Tag className="size-3.5 shrink-0" />
            Aa
          </span>
          <span className="glass-badge relative inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium text-xs">
            Bb
          </span>
        </div>
        <div className="mt-6 text-foreground/85">
          <DescriptionPreview document={SAMPLE_DESCRIPTION} />
        </div>
        <p className="mt-8 mb-2 font-semibold text-foreground/60 text-xs uppercase tracking-[0.06em]">
          Aa
        </p>
        <div className="flex min-h-10 items-center gap-2.5 rounded-xl bg-foreground/[0.06] px-2 text-sm">
          <StatusGlyph category="active" className="size-4" />
          <span className="min-w-0 flex-1 truncate">Aa Bb</span>
          <span className="text-foreground/50 text-xs">AA-3</span>
        </div>
        <div className="relative mt-8 grid grid-cols-2 gap-1 rounded-xl bg-foreground/5 p-1">
          <span className="absolute inset-y-1 left-1 w-[calc((100%-0.75rem)/2)] rounded-lg bg-foreground/8 shadow-[inset_0_1px_0_var(--glass-highlight)]" />
          <span className="relative flex min-h-11 items-center justify-center font-medium text-sm">
            Aa
          </span>
          <span className="relative flex min-h-11 items-center justify-center font-medium text-sm">
            Bb
          </span>
        </div>
      </div>
    </div>
  );
}

const dockButton = (content: ReactNode) => (
  <span className="flex items-center justify-center text-foreground/80 [&_svg]:size-6">
    {content}
  </span>
);

/** The phone's drawer under a task: its thick glass sheet, the dock's controls and a button. */
function DockSample() {
  return (
    <div className="absolute inset-x-0 bottom-0 mx-auto max-w-md">
      <div className="glass-thick relative rounded-t-[1.75rem] px-3 pt-3 pb-[calc(var(--safe-bottom)+0.5rem)] shadow-[0_-8px_24px_-12px_oklch(0_0_0/0.25)]">
        <div className="flex h-[var(--dock-height)] items-center gap-2 pl-2">
          <span className="flex-1 truncate font-bold font-display text-xl tracking-[-0.01em]">
            Aa Bb
          </span>
          {icon(Search)}
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-2xl bg-card px-3 py-2 text-sm shadow-[0_1px_2px_oklch(0_0_0/0.06)]">
          <StatusGlyph category="done" className="size-4" />
          <span className="flex-1 truncate">Aa Bb Cc</span>
        </div>
      </div>
      <div className="absolute inset-x-3 bottom-[var(--dock-bottom)] flex items-center gap-2">
        <div className="glass grid h-[var(--dock-height)] flex-1 auto-cols-fr grid-flow-col gap-1 rounded-[var(--dock-radius)] p-1">
          {dockButton(<StatusGlyph category="backlog" />)}
          {dockButton(<PriorityIcon priority={1} />)}
          {dockButton(<Flag />)}
          {dockButton(<Palette className="text-tint-accent" />)}
          {dockButton(<Tag />)}
          {dockButton(<MessageSquare />)}
        </div>
        <div className="glass flex rounded-[var(--dock-radius)] p-1">
          <span className="flex size-[calc(var(--dock-height)-0.5rem)] items-center justify-center">
            <Plus className="size-6" />
          </span>
        </div>
      </div>
    </div>
  );
}
