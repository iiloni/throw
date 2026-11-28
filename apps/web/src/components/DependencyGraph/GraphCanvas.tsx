import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { entryDelay, useEntryMotion } from '@/lib/entryMotion';
import { springs } from '@/lib/motion';
import { reachable } from './analysis';
import { GraphNodeCard, NODE_HEIGHT, NODE_WIDTH, type NodeEmphasis } from './GraphNodeCard';
import type { GraphEdge, GraphNode } from './graphModel';
import { edgePath, type GraphLayout } from './layout';
import type { GraphHighlight } from './settings';
import { fitView, type Insets, revealRect, type Viewport, zoomAround } from './viewport';

/** Room left around the drawing for arrowheads and the focus ring. */
const PAD = 16;

type EdgeLook = 'normal' | 'chain' | 'critical' | 'dimmed';

/** An element's size, followed as it changes. */
function useSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () =>
      setSize((last) =>
        last.width === element.clientWidth && last.height === element.clientHeight
          ? last
          : { width: element.clientWidth, height: element.clientHeight },
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/**
 * A node's arrival, as a board's cards settle in: once per document, and again each time the
 * graph is switched to through the board cross-fade, sweeping from the first blockers to what
 * they hold up. A node that joins a graph already on screen (a toggle, the filter, sync) pops in
 * on its own instead.
 */
function NodeEntry({
  id,
  layer,
  late,
  children,
}: {
  id: string;
  layer: number;
  late: boolean;
  children: ReactNode;
}) {
  const entry = useEntryMotion(`graph-node:${id}`, true, entryDelay(layer), late);
  return (
    <motion.div className="absolute top-0 left-0" style={entry}>
      {children}
    </motion.div>
  );
}

/** The edges and what floats over the canvas settle in with the nodes. */
function Entry({
  scope,
  delay,
  className,
  children,
}: {
  scope: string;
  delay: number;
  className?: string;
  children: ReactNode;
}) {
  const entry = useEntryMotion(scope, true, delay);
  return (
    <motion.div className={className} style={entry}>
      {children}
    </motion.div>
  );
}

export type GraphAnalysis = {
  critical: readonly string[];
  waiting: ReadonlyMap<string, number>;
};

/**
 * The graph itself: edges drawn under the nodes in one SVG, the nodes as the board's cards,
 * and the whole moved and scaled as one by the viewport. It fits itself to the space until
 * someone moves it, and keeps the open task in sight.
 */
export function GraphCanvas({
  canvasRef,
  viewport,
  nodes,
  edges,
  layout,
  analysis,
  openTaskId,
  highlight,
  insets,
  label,
  onOpen,
  children,
}: {
  canvasRef: RefObject<HTMLDivElement | null>;
  viewport: Viewport;
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  layout: GraphLayout;
  analysis: GraphAnalysis;
  openTaskId: string | null;
  highlight: GraphHighlight;
  insets: Insets;
  label: string;
  onOpen: (node: GraphNode, element: HTMLElement) => void;
  /** What floats over the canvas: the controls, or an empty graph's message. */
  children?: ReactNode;
}) {
  const reduced = useReducedMotion() ?? false;
  const markers = useId().replace(/:/g, '');
  const size = useSize(canvasRef);
  const [pointed, setPointed] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const edgeByKey = useMemo(
    () => new Map(edges.map((edge) => [`${edge.from}\n${edge.to}`, edge])),
    [edges],
  );
  const content = { width: layout.width + PAD * 2, height: layout.height + PAD * 2 };
  // The nodes there as the graph first draws make its entry; later ones pop in on their own.
  // An empty first draw (still loading, or filtered to nothing) leaves the entry to the next.
  const arrived = useRef<ReadonlySet<string>>(new Set());
  if (arrived.current.size === 0) arrived.current = new Set(nodes.map((node) => node.id));

  const rectOf = useCallback(
    (id: string) => {
      const place = layout.nodes.get(id);
      return (
        place && { x: place.x + PAD, y: place.y + PAD, width: NODE_WIDTH, height: NODE_HEIGHT }
      );
    },
    [layout],
  );

  // Fit while untouched: at once when the space changes (a pane sliding open), springing when
  // the graph does. Once moved, a change of space only keeps the open task in sight.
  const fitted = useRef<{ width: number; height: number } | null>(null);
  const insetKey = `${insets.top},${insets.right},${insets.bottom},${insets.left}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the insets are compared by value
  useLayoutEffect(() => {
    if (size.width === 0 || size.height === 0) return;
    const first = fitted.current === null;
    const graphChanged =
      !first &&
      (fitted.current!.width !== content.width || fitted.current!.height !== content.height);
    fitted.current = { width: content.width, height: content.height };
    if (first || !viewport.touched.current) {
      viewport.go(fitView(content, size, insets), first || !graphChanged);
      return;
    }
    const open = openTaskId ? rectOf(openTaskId) : undefined;
    if (open) viewport.go(revealRect(viewport.get(), open, size, insets), !graphChanged);
  }, [size, content.width, content.height, insetKey, viewport]);

  // A task opened from elsewhere (a link, the palette, a relation in the pane) comes into view.
  const lastOpen = useRef(openTaskId);
  useEffect(() => {
    if (openTaskId === lastOpen.current) return;
    lastOpen.current = openTaskId;
    const open = openTaskId ? rectOf(openTaskId) : undefined;
    if (!open || size.width === 0) return;
    viewport.go(revealRect(viewport.get(), open, size, insets));
  }, [openTaskId, rectOf, size, insets, viewport]);

  const active =
    pointed ?? focused ?? (openTaskId && byId.has(openTaskId) ? openTaskId : null) ?? null;
  const chain = useMemo(() => {
    if (!active) return null;
    return { up: reachable(active, edges, 'up'), down: reachable(active, edges, 'down') };
  }, [active, edges]);
  const critical = useMemo(() => new Set(analysis.critical), [analysis.critical]);
  const criticalEdges = useMemo(() => {
    const pairs = new Set<string>();
    for (let index = 1; index < analysis.critical.length; index++)
      pairs.add(`${analysis.critical[index - 1]}\n${analysis.critical[index]}`);
    return pairs;
  }, [analysis.critical]);
  const marking = highlight === 'critical' ? critical.size > 0 : highlight === 'ready';

  const emphasisOf = (node: GraphNode): NodeEmphasis => {
    if (chain && active) {
      if (node.id === active) return 'focus';
      return chain.up.has(node.id) || chain.down.has(node.id) ? 'chain' : 'dimmed';
    }
    if (!marking) return 'normal';
    const marked = highlight === 'critical' ? critical.has(node.id) : node.state === 'ready';
    return marked ? 'marked' : 'dimmed';
  };
  const edgeLook = (edge: GraphEdge): EdgeLook => {
    if (chain && active) {
      const upstream = chain.up.has(edge.from) && (edge.to === active || chain.up.has(edge.to));
      const downstream =
        (edge.from === active || chain.down.has(edge.from)) && chain.down.has(edge.to);
      return upstream || downstream ? 'chain' : 'dimmed';
    }
    if (highlight === 'critical' && critical.size > 0)
      return criticalEdges.has(`${edge.from}\n${edge.to}`) ? 'critical' : 'dimmed';
    if (highlight === 'ready') return byId.get(edge.from)?.state === 'ready' ? 'normal' : 'dimmed';
    return 'normal';
  };

  // Tab order follows the drawing: component by component, layer by layer, top to bottom.
  const ordered = useMemo(
    () =>
      [...nodes].sort((a, b) => {
        const pa = layout.nodes.get(a.id);
        const pb = layout.nodes.get(b.id);
        if (!pa || !pb) return 0;
        const ca = pa.component < 0 ? Number.MAX_SAFE_INTEGER : pa.component;
        const cb = pb.component < 0 ? Number.MAX_SAFE_INTEGER : pb.component;
        return ca - cb || pa.layer - pb.layer || pa.order - pb.order;
      }),
    [nodes, layout],
  );

  const focusNode = useCallback(
    (id: string) => {
      const element = canvasRef.current?.querySelector<HTMLElement>(
        `[data-graph-node="${CSS.escape(id)}"]`,
      );
      if (!element) return;
      element.focus({ preventScroll: true });
      const rect = rectOf(id);
      if (rect) viewport.go(revealRect(viewport.get(), rect, size, insets));
    },
    [canvasRef, rectOf, size, insets, viewport],
  );

  /** Arrows walk the graph: along edges sideways, through the layer up and down. */
  const onNodeKey = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
      const here = layout.nodes.get(id);
      if (!here) return;
      let target: string | undefined;
      const nearest = (candidates: string[]) =>
        candidates
          .map((other) => layout.nodes.get(other))
          .filter((place) => place !== undefined)
          .sort((a, b) => Math.abs(a.y - here.y) - Math.abs(b.y - here.y) || a.order - b.order)[0]
          ?.id;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        const forward = event.key === 'ArrowRight';
        const linked = edges
          .filter((edge) => (forward ? edge.from === id : edge.to === id))
          .map((edge) => (forward ? edge.to : edge.from));
        target =
          nearest(linked) ??
          nearest(
            [...layout.nodes.values()]
              .filter(
                (place) =>
                  place.component === here.component &&
                  place.layer === here.layer + (forward ? 1 : -1),
              )
              .map((place) => place.id),
          );
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const index = ordered.findIndex((node) => node.id === id);
        target = ordered[index + step]?.id;
      } else if (event.key === 'Home') target = ordered[0]?.id;
      else if (event.key === 'End') target = ordered[ordered.length - 1]?.id;
      else return;
      event.preventDefault();
      if (target) focusNode(target);
    },
    [layout, edges, ordered, focusNode],
  );

  /** Zoom keys anywhere on the canvas, about its middle. */
  function onCanvasKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const middle = {
      x: (insets.left + size.width - insets.right) / 2,
      y: (insets.top + size.height - insets.bottom) / 2,
    };
    if (event.key === '+' || event.key === '=') {
      viewport.touched.current = true;
      viewport.go(zoomAround(viewport.get(), 1.25, middle));
    } else if (event.key === '-' || event.key === '_') {
      viewport.touched.current = true;
      viewport.go(zoomAround(viewport.get(), 0.8, middle));
    } else if (event.key === '0') {
      viewport.touched.current = false;
      viewport.go(fitView(content, size, insets));
    } else return;
    event.preventDefault();
  }

  const strokes: Record<EdgeLook, string> = {
    normal: 'var(--muted-foreground)',
    chain: 'var(--foreground)',
    critical: 'var(--priority-high)',
    dimmed: 'var(--muted-foreground)',
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: zoom keys reach it from its nodes
    <div
      ref={canvasRef}
      data-graph-canvas=""
      data-no-pull=""
      onKeyDown={onCanvasKey}
      className="@container/graph relative min-h-0 flex-1 touch-none overflow-hidden"
    >
      <motion.div
        role="group"
        aria-label={label}
        className="absolute top-0 left-0 origin-top-left"
        style={{
          x: viewport.x,
          y: viewport.y,
          scale: viewport.scale,
          width: content.width,
          height: content.height,
        }}
      >
        <Entry
          scope={`graph-edges:${label}`}
          delay={entryDelay(1)}
          className="absolute top-0 left-0"
        >
          <svg
            aria-hidden
            width={content.width}
            height={content.height}
            className="pointer-events-none absolute inset-0 overflow-visible"
          >
            <defs>
              {(['normal', 'chain', 'critical', 'cycle'] as const).map((kind) => (
                <marker
                  key={kind}
                  id={`${markers}-${kind}`}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="9"
                  markerHeight="9"
                  markerUnits="userSpaceOnUse"
                  orient="auto-start-reverse"
                >
                  <path
                    d="M1,1 L9,5 L1,9 z"
                    fill={
                      kind === 'cycle'
                        ? 'var(--destructive)'
                        : strokes[kind === 'normal' ? 'normal' : kind]
                    }
                  />
                </marker>
              ))}
            </defs>
            <g transform={`translate(${PAD} ${PAD})`}>
              {layout.edges.map((routed) => {
                const edge = edgeByKey.get(`${routed.from}\n${routed.to}`);
                if (!edge) return null;
                const look = edgeLook(edge);
                const marker = routed.reversed ? 'cycle' : look === 'dimmed' ? 'normal' : look;
                return (
                  <motion.path
                    key={`${routed.from}-${routed.to}`}
                    data-graph-edge={`${routed.from}>${routed.to}`}
                    data-look={look}
                    initial={false}
                    animate={{
                      d: edgePath(routed.points),
                      opacity: look === 'dimmed' ? 0.18 : look === 'normal' ? 0.6 : 0.95,
                    }}
                    transition={reduced ? { duration: 0 } : springs.smooth}
                    fill="none"
                    stroke={routed.reversed ? 'var(--destructive)' : strokes[look]}
                    strokeWidth={look === 'critical' ? 2.5 : look === 'chain' ? 2 : 1.5}
                    strokeDasharray={routed.reversed ? '6 4' : edge.settled ? '3 4' : undefined}
                    strokeLinecap="round"
                    markerEnd={`url(#${markers}-${marker})`}
                  />
                );
              })}
            </g>
          </svg>
        </Entry>
        <AnimatePresence initial={false}>
          {ordered.map((node) => {
            const place = layout.nodes.get(node.id);
            if (!place) return null;
            return (
              <NodeEntry
                key={node.id}
                id={node.id}
                layer={place.layer}
                late={!arrived.current.has(node.id)}
              >
                <GraphNodeCard
                  node={node}
                  x={place.x + PAD}
                  y={place.y + PAD}
                  open={node.id === openTaskId}
                  emphasis={emphasisOf(node)}
                  critical={highlight === 'critical' && critical.has(node.id)}
                  waiting={analysis.waiting.get(node.id) ?? 0}
                  reduced={reduced}
                  onOpen={onOpen}
                  onPoint={setPointed}
                  onFocusNode={setFocused}
                  onKeyDown={onNodeKey}
                />
              </NodeEntry>
            );
          })}
        </AnimatePresence>
      </motion.div>
      <Entry
        scope={`graph-controls:${label}`}
        delay={0}
        className="pointer-events-none absolute inset-0"
      >
        {children}
      </Entry>
    </div>
  );
}
