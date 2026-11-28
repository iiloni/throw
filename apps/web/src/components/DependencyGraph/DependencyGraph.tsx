import {
  CircleCheck,
  CircleDot,
  Columns3,
  Maximize,
  Minus,
  Network,
  Plus,
  Route,
  SlidersHorizontal,
  Unlink,
} from 'lucide-react';
import { AnimatePresence, motion, useMotionValueEvent } from 'motion/react';
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useShell } from '@/components/AppShell/shell';
import { Row, Switch } from '@/components/Board/BoardSettingsPanel';
import { type TaskBlocker, TaskBlockersContext } from '@/components/Board/blockers';
import { OpenTaskPane, useWidth } from '@/components/Board/DesktopBoard';
import { isFiltering, matchingIds } from '@/components/Board/filter';
import { dockButton } from '@/components/Board/PhoneBoard';
import { board, current, update } from '@/components/Board/state';
import { TaskContentContext } from '@/components/Board/taskContent';
import { useTaskSurfaceShown } from '@/components/Board/taskTransition';
import { NarrowedBar } from '@/components/BoardSearch/BoardFilters';
import {
  BoardSearch,
  BoardSearchSidebar,
  SEARCH_SIDEBAR_MIN,
} from '@/components/BoardSearch/BoardSearch';
import { DockFace } from '@/components/Drawer/DockFace';
import type { DrawerPage } from '@/components/Drawer/Drawer';
import { useDrawerSlot } from '@/components/Drawer/DrawerHost';
import { Hint } from '@/components/Hint/Hint';
import { IconButton } from '@/components/IconButton/IconButton';
import { useProjects, useStatuses, useTaskRelations, useTasks } from '@/lib/collections';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { criticalPath, waitingOn } from './analysis';
import { type GraphAnalysis, GraphCanvas } from './GraphCanvas';
import { NODE_HEIGHT, NODE_WIDTH } from './GraphNodeCard';
import { dependencyGraph, externalTasks, type GraphNode } from './graphModel';
import { layoutGraph } from './layout';
import { type GraphHighlight, type GraphSettings, useGraphSettings } from './settings';
import { fitView, type Insets, useViewport, type Viewport, zoomAround } from './viewport';

const noBlockers: ReadonlyMap<string, readonly TaskBlocker[]> = new Map();

/** Where the desktop's floating controls leave the graph room at the top. */
const DESKTOP_INSETS: Insets = { top: 64, right: 0, bottom: 0, left: 0 };
/** The phone's dock floats over the foot of the graph. */
const PHONE_INSETS: Insets = { top: 0, right: 0, bottom: 112, left: 0 };

/**
 * The board's graph: its tasks as the layout lays them out, with the analysis the canvas
 * marks. Everything comes from what the device holds, so it draws the same offline.
 */
function useDependencyGraph(settings: GraphSettings) {
  const state = board.use();
  const data = current(state);
  const blockers = useContext(TaskBlockersContext) ?? noBlockers;
  const { relations } = useTaskRelations();
  const { tasks } = useTasks();
  const { statuses } = useStatuses();
  const { projects } = useProjects();
  // Each task on its own: a subtask is a node of its own, whatever its parent matches.
  const visible = matchingIds(data, state.filter, true);
  const external = useMemo(
    () => externalTasks(tasks, statuses, projects),
    [tasks, statuses, projects],
  );
  const { showClosed, showIsolated } = settings;
  const graph = useMemo(
    () =>
      dependencyGraph({
        data,
        relations,
        blockers,
        visible,
        external,
        toggles: { showClosed, showIsolated },
      }),
    [data, relations, blockers, visible, external, showClosed, showIsolated],
  );
  const layout = useMemo(
    () =>
      layoutGraph(
        graph.nodes.map((node) => node.id),
        graph.edges,
        { nodeWidth: NODE_WIDTH, nodeHeight: NODE_HEIGHT },
      ),
    [graph],
  );
  const analysis = useMemo<GraphAnalysis>(() => {
    const ids = graph.nodes.map((node) => node.id);
    const open = new Set(
      graph.nodes
        .filter((node) => node.state === 'ready' || node.state === 'blocked')
        .map((node) => node.id),
    );
    const isOpen = (id: string) => open.has(id);
    return {
      critical: criticalPath(ids, graph.edges, isOpen),
      waiting: waitingOn(ids, graph.edges, isOpen),
    };
  }, [graph]);
  const hasRelations = useMemo(
    () => relations.some((relation) => relation.kind === 'blocks'),
    [relations],
  );
  return { state, data, graph, layout, analysis, hasRelations };
}

/**
 * The dependency graph of the board on screen: its tasks as nodes and their blocking
 * relations as edges, blocker on the left. It is the board seen another way, inside the same
 * boundary: the same search and filters narrow it, and a node opens the task as a card does,
 * in the desktop pane or the phone's task screen.
 */
export function DependencyGraph({
  phone,
  title,
  syncIndicator,
}: {
  phone: boolean;
  /** The phone's title, which opens the project switcher. */
  title?: ReactNode;
  syncIndicator?: ReactNode;
}) {
  const shell = useShell();
  const [settings, setSettings] = useGraphSettings();
  const model = useDependencyGraph(settings);
  const canvasRef = useRef<HTMLDivElement>(null);
  const viewport = useViewport(canvasRef);
  const { project } = model.data;

  const onOpen = useCallback(
    (node: GraphNode, element: HTMLElement) => {
      haptics.selection();
      if (node.external) {
        shell.openTask(node.projectId, node.id);
        return;
      }
      const open = board.get().openTaskId === node.id;
      update({ openTaskId: open ? null : node.id }, element);
    },
    [shell],
  );

  const label = `Dependency graph of ${project.members ? 'all projects' : project.name}`;
  const canvas = (insets: Insets, overlay: ReactNode) => (
    <GraphCanvas
      canvasRef={canvasRef}
      viewport={viewport}
      nodes={model.graph.nodes}
      edges={model.graph.edges}
      layout={model.layout}
      analysis={model.analysis}
      openTaskId={model.state.openTaskId}
      highlight={settings.highlight}
      insets={insets}
      label={label}
      onOpen={onOpen}
    >
      {overlay}
      {model.graph.nodes.length === 0 && (
        <EmptyGraph
          filtered={isFiltering(model.state.filter)}
          hasRelations={model.hasRelations}
          hiddenClosed={model.graph.hiddenClosed}
          hiddenIsolated={model.graph.hiddenIsolated}
          onShow={(change) => setSettings({ ...settings, ...change })}
        />
      )}
    </GraphCanvas>
  );
  const fit = () => {
    viewport.touched.current = false;
    viewport.go(
      fitView(
        { width: model.layout.width + 32, height: model.layout.height + 32 },
        {
          width: canvasRef.current?.clientWidth ?? 0,
          height: canvasRef.current?.clientHeight ?? 0,
        },
        phone ? PHONE_INSETS : DESKTOP_INSETS,
      ),
    );
  };
  const summary = (
    <GraphSummary
      nodes={model.graph.nodes}
      critical={model.analysis.critical.length}
      hiddenClosed={model.graph.hiddenClosed}
      compact={!phone}
    />
  );

  if (phone)
    return (
      <PhoneGraph
        title={title}
        syncIndicator={syncIndicator}
        summary={summary}
        settings={settings}
        onSettings={setSettings}
        onBoard={() => shell.showView('board')}
        onFit={fit}
      >
        {canvas(PHONE_INSETS, null)}
      </PhoneGraph>
    );
  return (
    <DesktopGraph>
      {canvas(
        DESKTOP_INSETS,
        <div className="absolute inset-x-4 top-4 flex items-start gap-2">
          <div
            data-graph-overlay=""
            className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2"
          >
            {summary}
          </div>
          <div
            data-graph-overlay=""
            className="pointer-events-auto flex shrink-0 items-center gap-2"
          >
            <GraphToggles settings={settings} onChange={setSettings} />
            <ZoomControls viewport={viewport} canvasRef={canvasRef} onFit={fit} />
          </div>
        </div>,
      )}
    </DesktopGraph>
  );
}

/** The desktop frame: the board's search beside or over the graph, the task pane after it. */
function DesktopGraph({ children }: { children: ReactNode }) {
  const [frame, frameWidth] = useWidth();
  const docked = frameWidth >= SEARCH_SIDEBAR_MIN;
  return (
    <div className="flex h-full overflow-hidden">
      <div ref={frame} className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          {docked && <BoardSearchSidebar />}
          <div className="relative flex min-w-0 flex-1">
            {children}
            {!docked && <BoardSearch />}
          </div>
          <OpenTaskPane frameWidth={frameWidth} />
        </div>
      </div>
    </div>
  );
}

const glassGroup =
  'glass flex items-center gap-0.5 rounded-2xl p-1 shadow-[0_1px_3px_oklch(0_0_0/0.08)]';
const groupButton =
  'flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/60';

/** The open work in sight, how it stands, and how long its longest chain runs. */
function GraphSummary({
  nodes,
  critical,
  hiddenClosed,
  compact = false,
}: {
  nodes: readonly GraphNode[];
  critical: number;
  hiddenClosed: number;
  /** Shares its row with the desktop's controls. */
  compact?: boolean;
}) {
  const extra = compact ? 'hidden @5xl/graph:inline' : undefined;
  const ready = nodes.filter((node) => node.state === 'ready').length;
  const blocked = nodes.filter((node) => node.state === 'blocked').length;
  if (nodes.length === 0) return null;
  return (
    <p
      aria-live="polite"
      className={cn(
        compact && cn(glassGroup, 'h-10 px-3.5'),
        'flex min-w-0 items-center gap-3 overflow-hidden whitespace-nowrap text-muted-foreground text-xs tabular-nums',
        !compact && 'px-1',
      )}
    >
      <span className="flex items-center gap-1">
        <span aria-hidden className="size-1.5 rounded-full bg-brand" />
        {ready} ready
      </span>
      <span className="flex items-center gap-1">
        <span aria-hidden className="size-1.5 rounded-full bg-destructive/80" />
        {blocked} blocked
      </span>
      {/* Beside the desktop's controls, the extras wait for room; a phone has its own line. */}
      {critical > 1 && <span className={extra}>Longest chain {critical}</span>}
      {hiddenClosed > 0 && <span className={extra}>{hiddenClosed} closed hidden</span>}
    </p>
  );
}

const TOGGLES: {
  key: 'showClosed' | 'showIsolated' | GraphHighlight;
  label: string;
  hint: string;
  icon: typeof CircleCheck;
}[] = [
  {
    key: 'showClosed',
    label: 'Closed',
    hint: 'Show done and cancelled tasks',
    icon: CircleCheck,
  },
  {
    key: 'showIsolated',
    label: 'Unlinked',
    hint: 'Show tasks with no blocking relation',
    icon: Unlink,
  },
  {
    key: 'critical',
    label: 'Critical path',
    hint: 'Mark the longest chain of open work',
    icon: Route,
  },
  { key: 'ready', label: 'Ready', hint: 'Mark open work nothing blocks', icon: CircleDot },
];

function isOn(settings: GraphSettings, key: (typeof TOGGLES)[number]['key']) {
  if (key === 'showClosed' || key === 'showIsolated') return settings[key];
  return settings.highlight === key;
}

function toggled(settings: GraphSettings, key: (typeof TOGGLES)[number]['key']): GraphSettings {
  if (key === 'showClosed' || key === 'showIsolated') return { ...settings, [key]: !settings[key] };
  return { ...settings, highlight: settings.highlight === key ? 'none' : (key as GraphHighlight) };
}

function GraphToggles({
  settings,
  onChange,
}: {
  settings: GraphSettings;
  onChange: (settings: GraphSettings) => void;
}) {
  return (
    <div role="toolbar" aria-label="Graph display" className={glassGroup}>
      {TOGGLES.map(({ key, label, hint, icon: Icon }) => {
        const on = isOn(settings, key);
        return (
          <Hint key={key} label={hint} side="bottom" describe>
            <button
              type="button"
              aria-pressed={on}
              aria-label={label}
              onClick={() => onChange(toggled(settings, key))}
              className={cn(
                groupButton,
                on
                  ? 'bg-brand/20 font-medium text-brand-link'
                  : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground',
              )}
            >
              <Icon aria-hidden className="size-4" />
              {/* A narrow canvas keeps the icons; the name stays the button's. */}
              <span className="hidden @4xl/graph:inline">{label}</span>
            </button>
          </Hint>
        );
      })}
    </div>
  );
}

function ZoomControls({
  viewport,
  canvasRef,
  onFit,
}: {
  viewport: Viewport;
  canvasRef: RefObject<HTMLDivElement | null>;
  onFit: () => void;
}) {
  const [percent, setPercent] = useState(Math.round(viewport.scale.get() * 100));
  useMotionValueEvent(viewport.scale, 'change', (value) => setPercent(Math.round(value * 100)));
  const zoom = (factor: number | null) => {
    const element = canvasRef.current;
    if (!element) return;
    viewport.touched.current = true;
    const middle = {
      x: element.clientWidth / 2,
      y: (DESKTOP_INSETS.top + element.clientHeight) / 2,
    };
    const view = viewport.get();
    viewport.go(zoomAround(view, factor ?? 1 / view.scale, middle));
  };
  return (
    <div role="toolbar" aria-label="Zoom" className={glassGroup}>
      <IconButton label="Zoom out" className="size-8 rounded-xl" onClick={() => zoom(0.8)}>
        <Minus />
      </IconButton>
      <Hint label="Reset zoom" side="bottom">
        <button
          type="button"
          aria-label={`Zoom ${percent}%, reset to 100%`}
          onClick={() => zoom(null)}
          className={cn(groupButton, 'w-14 justify-center px-0 text-muted-foreground tabular-nums')}
        >
          {percent}%
        </button>
      </Hint>
      <IconButton label="Zoom in" className="size-8 rounded-xl" onClick={() => zoom(1.25)}>
        <Plus />
      </IconButton>
      <IconButton label="Fit to view" className="size-8 rounded-xl" onClick={onFit}>
        <Maximize />
      </IconButton>
    </div>
  );
}

/** What an empty graph says, and the toggles that would fill it. */
function EmptyGraph({
  filtered,
  hasRelations,
  hiddenClosed,
  hiddenIsolated,
  onShow,
}: {
  filtered: boolean;
  hasRelations: boolean;
  hiddenClosed: number;
  hiddenIsolated: number;
  onShow: (change: Partial<GraphSettings>) => void;
}) {
  const title = filtered
    ? 'Nothing here matches'
    : hasRelations
      ? 'No open dependencies here'
      : 'No dependencies yet';
  const text = filtered
    ? 'Change the search or filters to see more of the graph.'
    : 'Mark a task as blocking another from its Links, and the work that waits on it shows here.';
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div
        data-graph-overlay=""
        className="pointer-events-auto flex max-w-sm flex-col items-center gap-2 text-center"
      >
        <Network aria-hidden className="size-8 text-muted-foreground/70" />
        <h2 className="font-display font-semibold text-lg tracking-[-0.01em]">{title}</h2>
        <p className="text-muted-foreground text-sm">{text}</p>
        {(hiddenIsolated > 0 || hiddenClosed > 0) && (
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {hiddenIsolated > 0 && (
              <button
                type="button"
                onClick={() => onShow({ showIsolated: true })}
                className="h-9 rounded-xl bg-foreground/[0.06] px-3 font-medium text-sm outline-none hover:bg-foreground/[0.1] focus-visible:ring-[3px] focus-visible:ring-ring/60"
              >
                Show {hiddenIsolated} unlinked {hiddenIsolated === 1 ? 'task' : 'tasks'}
              </button>
            )}
            {hiddenClosed > 0 && (
              <button
                type="button"
                onClick={() => onShow({ showClosed: true })}
                className="h-9 rounded-xl bg-foreground/[0.06] px-3 font-medium text-sm outline-none hover:bg-foreground/[0.1] focus-visible:ring-[3px] focus-visible:ring-ring/60"
              >
                Show closed
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** The graph's settings as a drawer page on a phone (ADR 0009). */
function GraphOptions({
  settings,
  onChange,
}: {
  settings: GraphSettings;
  onChange: (settings: GraphSettings) => void;
}) {
  return (
    <div className="px-5 pb-[calc(var(--safe-bottom)+1.5rem)]">
      {TOGGLES.map(({ key, label, hint }) => (
        <Row key={key} label={label} hint={hint}>
          <Switch
            label={label}
            checked={isOn(settings, key)}
            onChange={() => onChange(toggled(settings, key))}
          />
        </Row>
      ))}
    </div>
  );
}

/**
 * The graph on a phone: the title and how the work stands above it, and the drawer's dock
 * below, which goes back to the board, opens the graph's settings and fits it to the screen.
 * An open task's screen covers it as on the board, its dock taking the drawer's place.
 */
function PhoneGraph({
  title,
  syncIndicator,
  summary,
  settings,
  onSettings,
  onBoard,
  onFit,
  children,
}: {
  title?: ReactNode;
  syncIndicator?: ReactNode;
  summary: ReactNode;
  settings: GraphSettings;
  onSettings: (settings: GraphSettings) => void;
  onBoard: () => void;
  onFit: () => void;
  children: ReactNode;
}) {
  const state = board.use();
  const task = useContext(TaskContentContext)?.drawer;
  const raised = useTaskSurfaceShown();
  const [options, setOptions] = useState(false);
  const covered = state.openTaskId !== null || options;
  const optionsPage: DrawerPage = {
    key: 'graph-options',
    title: 'Graph',
    fit: true,
    content: <GraphOptions settings={settings} onChange={onSettings} />,
  };
  const dock = (
    <div className="flex items-center gap-2">
      <motion.button
        type="button"
        aria-label="Show the board"
        onClick={() => {
          haptics.toggle();
          onBoard();
        }}
        whileTap={{ scale: 0.88 }}
        transition={springs.snappy}
        className={cn(dockButton, 'bg-foreground/[0.06] text-foreground')}
      >
        <Columns3 aria-hidden className="size-6" />
      </motion.button>
      <motion.button
        type="button"
        onClick={() => {
          haptics.toggle();
          setOptions(true);
        }}
        whileTap={{ scale: 0.97 }}
        transition={springs.snappy}
        className="flex h-[var(--dock-height)] min-w-0 flex-1 items-center gap-3 rounded-[var(--dock-radius)] bg-foreground/[0.06] px-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
      >
        <SlidersHorizontal aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        <span className="truncate font-bold font-display text-lg tracking-[-0.01em]">Graph</span>
      </motion.button>
      <motion.button
        type="button"
        aria-label="Fit to screen"
        onClick={() => {
          haptics.toggle();
          onFit();
        }}
        whileTap={{ scale: 0.88 }}
        transition={springs.snappy}
        className={cn(dockButton, 'bg-foreground/[0.06] text-foreground')}
      >
        <Maximize aria-hidden className="size-6" />
      </motion.button>
    </div>
  );
  useDrawerSlot({
    label: task ? 'Task drawer' : 'Graph drawer',
    face: 'graph',
    origin: 'graph',
    dock: (
      <AnimatePresence initial={false}>
        <DockFace key={task ? 'task' : 'graph'}>{task ? task.dock : dock}</DockFace>
      </AnimatePresence>
    ),
    gesturesDisabled: !!task && !task.page,
    page: task ? task.page : options ? optionsPage : null,
    onClosePage: task ? task.closePage : () => setOptions(false),
    raised: !!task || raised,
  });
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 pt-[var(--safe-top)]" inert={covered}>
        <div className="flex h-14 items-center gap-2 pr-3 pl-5">
          {title}
          <span className="flex-1" />
        </div>
        {syncIndicator && (
          <div className="px-5 text-muted-foreground empty:hidden">{syncIndicator}</div>
        )}
        <div className="px-4 pb-1">{summary}</div>
        <NarrowedBar />
      </header>
      <div className="relative flex min-h-0 flex-1" data-board-cover="" inert={covered}>
        {children}
      </div>
    </div>
  );
}
