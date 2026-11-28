/**
 * A layered (Sugiyama-style) layout for the dependency graph, left to right: work that blocks
 * stands to the left of the work it blocks. Pure and deterministic, so the same tasks and
 * relations always draw the same picture, and a sync that changes nothing moves nothing.
 *
 * 1. Edges that close a cycle are turned round (and drawn as such), so what is left is acyclic.
 * 2. Each node takes the layer after its deepest blocker; a root pulls up beside what it blocks.
 * 3. Edges spanning layers pass through virtual points, one per layer they cross.
 * 4. Barycenter sweeps with adjacent swaps order each layer to cut crossings.
 * 5. Each layer's nodes move toward their neighbours, in order and apart (isotonic regression).
 *
 * Weakly connected components are laid out apart and stacked, largest first; nodes with no
 * edges at all go in a grid beneath them.
 */

export type LayoutEdge = { from: string; to: string };

export type LayoutOptions = {
  nodeWidth: number;
  nodeHeight: number;
  /** Between one layer's nodes and the next layer's. */
  layerGap: number;
  /** Between nodes stacked in a layer. */
  nodeGap: number;
  /** Between stacked components, and above the isolated nodes' grid. */
  componentGap: number;
  /** Columns of the isolated nodes' grid; by default as wide as the widest component. */
  isolatedColumns?: number;
};

export const DEFAULT_LAYOUT: LayoutOptions = {
  nodeWidth: 232,
  nodeHeight: 92,
  layerGap: 88,
  nodeGap: 20,
  componentGap: 56,
};

export type Point = { x: number; y: number };

export type PositionedNode = {
  id: string;
  /** The node's top left corner. */
  x: number;
  y: number;
  layer: number;
  /** The node's place within its layer, top to bottom. */
  order: number;
  /** Its component, in stacking order; isolated nodes have `-1`. */
  component: number;
};

export type RoutedEdge = {
  from: string;
  to: string;
  /** From the blocker's side to the blocked task's, in the edge's own direction. */
  points: Point[];
  /** The edge closes a cycle, so it runs back against the layers. */
  reversed: boolean;
};

export type GraphLayout = {
  nodes: Map<string, PositionedNode>;
  edges: RoutedEdge[];
  width: number;
  height: number;
};

/** Edges once each, between known, distinct nodes, in the order first given. */
export function cleanEdges(ids: readonly string[], edges: readonly LayoutEdge[]): LayoutEdge[] {
  const known = new Set(ids);
  const seen = new Set<string>();
  const result: LayoutEdge[] = [];
  for (const edge of edges) {
    if (edge.from === edge.to || !known.has(edge.from) || !known.has(edge.to)) continue;
    const key = `${edge.from}\n${edge.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(edge);
  }
  return result;
}

/**
 * The edges with those that close a cycle turned round, found by a depth-first walk in the
 * order the nodes and edges are given. A pair of tasks blocking each other keeps one edge
 * forward and one reversed. The result has no cycles.
 */
export function breakCycles(
  ids: readonly string[],
  edges: readonly LayoutEdge[],
): (LayoutEdge & { reversed: boolean })[] {
  const out = new Map<string, number[]>();
  for (const id of ids) out.set(id, []);
  edges.forEach((edge, index) => {
    out.get(edge.from)?.push(index);
  });
  const reversed = new Array<boolean>(edges.length).fill(false);
  const state = new Map<string, 'open' | 'done'>();
  for (const root of ids) {
    if (state.has(root)) continue;
    // An explicit stack, so a long chain of blockers cannot overflow the call stack.
    const stack: { id: string; next: number }[] = [{ id: root, next: 0 }];
    state.set(root, 'open');
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const outgoing = out.get(top.id)!;
      if (top.next >= outgoing.length) {
        state.set(top.id, 'done');
        stack.pop();
        continue;
      }
      const index = outgoing[top.next++]!;
      const target = edges[index]!.to;
      const seen = state.get(target);
      if (seen === 'open') reversed[index] = true;
      else if (seen === undefined) {
        state.set(target, 'open');
        stack.push({ id: target, next: 0 });
      }
    }
  }
  return edges.map((edge, index) =>
    reversed[index]
      ? { from: edge.to, to: edge.from, reversed: true }
      : { from: edge.from, to: edge.to, reversed: false },
  );
}

/** A topological order of an acyclic graph, taking the earliest given node whenever free. */
export function topologicalOrder(ids: readonly string[], edges: readonly LayoutEdge[]): string[] {
  const rank = new Map(ids.map((id, index) => [id, index]));
  const indegree = new Map(ids.map((id) => [id, 0]));
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of edges) {
    out.get(edge.from)!.push(edge.to);
    indegree.set(edge.to, indegree.get(edge.to)! + 1);
  }
  const ready = ids.filter((id) => indegree.get(id) === 0);
  const order: string[] = [];
  while (ready.length > 0) {
    // Few nodes are free at once; keeping the queue sorted keeps the order the given one.
    ready.sort((a, b) => rank.get(a)! - rank.get(b)!);
    const id = ready.shift()!;
    order.push(id);
    for (const next of out.get(id)!) {
      const left = indegree.get(next)! - 1;
      indegree.set(next, left);
      if (left === 0) ready.push(next);
    }
  }
  return order;
}

/**
 * Each node's layer: one past its deepest predecessor, so a layer counts how many steps of
 * blockers stand before it. A root then moves up to just before the nearest node it points
 * to, so a lone blocker sits beside the work it holds up rather than far off at the start.
 */
export function assignLayers(ids: readonly string[], edges: readonly LayoutEdge[]) {
  const order = topologicalOrder(ids, edges);
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  const succs = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of edges) {
    preds.get(edge.to)!.push(edge.from);
    succs.get(edge.from)!.push(edge.to);
  }
  const layer = new Map<string, number>();
  for (const id of order) {
    let at = 0;
    for (const pred of preds.get(id)!) at = Math.max(at, layer.get(pred)! + 1);
    layer.set(id, at);
  }
  for (const id of [...order].reverse()) {
    if (preds.get(id)!.length > 0 || succs.get(id)!.length === 0) continue;
    const nearest = Math.min(...succs.get(id)!.map((next) => layer.get(next)!));
    layer.set(id, Math.max(layer.get(id)!, nearest - 1));
  }
  return layer;
}

/** Weakly connected components with at least one edge, and the nodes with none. */
export function components(ids: readonly string[], edges: readonly LayoutEdge[]) {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Path halving keeps later finds short.
    let at = id;
    while (parent.get(at) !== root) {
      const next = parent.get(at)!;
      parent.set(at, root);
      at = next;
    }
    return root;
  };
  const linked = new Set<string>();
  for (const edge of edges) {
    linked.add(edge.from);
    linked.add(edge.to);
    const a = find(edge.from);
    const b = find(edge.to);
    if (a !== b) parent.set(b, a);
  }
  const groups = new Map<string, string[]>();
  const isolated: string[] = [];
  for (const id of ids) {
    if (!linked.has(id)) {
      isolated.push(id);
      continue;
    }
    const root = find(id);
    const group = groups.get(root);
    if (group) group.push(id);
    else groups.set(root, [id]);
  }
  const rank = new Map(ids.map((id, index) => [id, index]));
  const grouped = [...groups.values()].sort(
    (a, b) => b.length - a.length || rank.get(a[0]!)! - rank.get(b[0]!)!,
  );
  return { components: grouped, isolated };
}

/** How many pairs of edges between two adjacent layers cross, given each node's position. */
export function countCrossings(
  pairs: readonly (readonly [number, number])[],
  lowerSize: number,
): number {
  // Sorted by the upper end, the crossings are the inversions among the lower ends.
  const sorted = [...pairs].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const tree = new Array<number>(lowerSize + 1).fill(0);
  let crossings = 0;
  let seen = 0;
  for (const [, lower] of sorted) {
    let below = 0;
    for (let index = lower + 1; index > 0; index -= index & -index) below += tree[index]!;
    crossings += seen - below;
    for (let index = lower + 1; index <= lowerSize; index += index & -index) tree[index]! += 1;
    seen += 1;
  }
  return crossings;
}

type Virtual = {
  layers: string[][];
  /** Each node's neighbours in the layer before and after. */
  up: Map<string, string[]>;
  down: Map<string, string[]>;
  /** The chain of nodes each acyclic edge passes through, ends included. */
  chains: string[][];
  dummy: Set<string>;
};

function virtualGraph(
  ids: readonly string[],
  edges: readonly LayoutEdge[],
  layer: Map<string, number>,
): Virtual {
  const depth = Math.max(0, ...ids.map((id) => layer.get(id)!)) + 1;
  const layers: string[][] = Array.from({ length: depth }, () => []);
  const up = new Map<string, string[]>();
  const down = new Map<string, string[]>();
  const dummy = new Set<string>();
  const add = (id: string, at: number) => {
    layers[at]!.push(id);
    up.set(id, []);
    down.set(id, []);
  };
  for (const id of ids) add(id, layer.get(id)!);
  const chains = edges.map((edge, index) => {
    const from = layer.get(edge.from)!;
    const to = layer.get(edge.to)!;
    const chain = [edge.from];
    for (let at = from + 1; at < to; at++) {
      const id = `\u0000${index}:${at}`;
      dummy.add(id);
      add(id, at);
      chain.push(id);
    }
    chain.push(edge.to);
    for (let step = 1; step < chain.length; step++) {
      down.get(chain[step - 1]!)!.push(chain[step]!);
      up.get(chain[step]!)!.push(chain[step - 1]!);
    }
    return chain;
  });
  return { layers, up, down, chains, dummy };
}

/**
 * A first order for each layer: a depth-first walk from the roots, so a chain's nodes start
 * level with each other and the sweeps begin from somewhere sensible.
 */
function initialOrder(graph: Virtual, ids: readonly string[]) {
  const visited = new Set<string>();
  const sequence = new Map<string, number>();
  const visit = (root: string) => {
    const stack = [root];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      sequence.set(id, sequence.size);
      const next = graph.down.get(id)!;
      for (let index = next.length - 1; index >= 0; index--) stack.push(next[index]!);
    }
  };
  for (const id of ids) if (graph.up.get(id)!.length === 0) visit(id);
  for (const layer of graph.layers) for (const id of layer) visit(id);
  return graph.layers.map((layer) =>
    [...layer].sort((a, b) => sequence.get(a)! - sequence.get(b)!),
  );
}

function totalCrossings(layers: string[][], down: Map<string, string[]>) {
  let total = 0;
  for (let at = 0; at + 1 < layers.length; at++) {
    const position = new Map(layers[at + 1]!.map((id, index) => [id, index]));
    const pairs: [number, number][] = [];
    layers[at]!.forEach((id, index) => {
      for (const next of down.get(id)!) pairs.push([index, position.get(next)!]);
    });
    total += countCrossings(pairs, layers[at + 1]!.length);
  }
  return total;
}

function barycenterSweep(layers: string[][], graph: Virtual, downward: boolean) {
  const result = layers.map((layer) => [...layer]);
  const range = downward
    ? Array.from({ length: result.length - 1 }, (_, index) => index + 1)
    : Array.from({ length: result.length - 1 }, (_, index) => result.length - 2 - index);
  for (const at of range) {
    const fixed = result[downward ? at - 1 : at + 1]!;
    const position = new Map(fixed.map((id, index) => [id, index]));
    const neighbours = downward ? graph.up : graph.down;
    const keyed = result[at]!.map((id, index) => {
      const around = neighbours.get(id)!;
      const value =
        around.length === 0
          ? index * (fixed.length / Math.max(1, result[at]!.length))
          : around.reduce((sum, other) => sum + position.get(other)!, 0) / around.length;
      return { id, value, index };
    });
    keyed.sort((a, b) => a.value - b.value || a.index - b.index);
    result[at] = keyed.map((entry) => entry.id);
  }
  return result;
}

function crossingsBetween(upper: string[], lower: string[], down: Map<string, string[]>) {
  const position = new Map(lower.map((id, index) => [id, index]));
  const pairs: [number, number][] = [];
  upper.forEach((id, index) => {
    for (const next of down.get(id)!) {
      const at = position.get(next);
      if (at !== undefined) pairs.push([index, at]);
    }
  });
  return countCrossings(pairs, lower.length);
}

/** Swaps neighbours within a layer while that crosses fewer edges on either side. */
function transpose(layers: string[][], graph: Virtual) {
  let improved = true;
  let rounds = 0;
  while (improved && rounds < 8) {
    improved = false;
    rounds += 1;
    for (let at = 0; at < layers.length; at++) {
      const layer = layers[at]!;
      for (let index = 0; index + 1 < layer.length; index++) {
        const local = () =>
          (at > 0 ? crossingsBetween(layers[at - 1]!, layer, graph.down) : 0) +
          (at + 1 < layers.length ? crossingsBetween(layer, layers[at + 1]!, graph.down) : 0);
        const before = local();
        [layer[index], layer[index + 1]] = [layer[index + 1]!, layer[index]!];
        if (local() < before) improved = true;
        else [layer[index], layer[index + 1]] = [layer[index + 1]!, layer[index]!];
      }
    }
  }
}

function orderLayers(graph: Virtual, ids: readonly string[]) {
  let layers = initialOrder(graph, ids);
  let best = layers;
  let fewest = totalCrossings(layers, graph.down);
  for (let round = 0; round < 12 && fewest > 0; round++) {
    layers = barycenterSweep(layers, graph, round % 2 === 0);
    const crossings = totalCrossings(layers, graph.down);
    if (crossings < fewest) {
      fewest = crossings;
      best = layers;
    }
  }
  best = best.map((layer) => [...layer]);
  // Swapping costs a count per pair; on a large graph the sweeps alone are enough.
  if (fewest > 0 && graph.dummy.size + ids.length <= 400) transpose(best, graph);
  return best;
}

/**
 * Positions in order that are each at least `gaps[i]` past the one before, as close as they
 * can be to `desired` (least squares): pool adjacent violators over the shifted targets.
 */
export function placeInOrder(desired: readonly number[], gaps: readonly number[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  desired.forEach((_, index) => {
    if (index > 0) offset += gaps[index - 1]!;
    offsets.push(offset);
  });
  const blocks: { sum: number; count: number }[] = [];
  desired.forEach((value, index) => {
    blocks.push({ sum: value - offsets[index]!, count: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1]!;
      const before = blocks[blocks.length - 2]!;
      if (before.sum / before.count <= last.sum / last.count) break;
      blocks.pop();
      before.sum += last.sum;
      before.count += last.count;
    }
  });
  const result: number[] = [];
  for (const block of blocks) {
    const mean = block.sum / block.count;
    for (let step = 0; step < block.count; step++) result.push(mean + offsets[result.length]!);
  }
  return result;
}

function assignY(layers: string[][], graph: Virtual, options: LayoutOptions) {
  const height = (id: string) => (graph.dummy.has(id) ? 0 : options.nodeHeight);
  const gap = (a: string, b: string) =>
    (height(a) + height(b)) / 2 +
    (graph.dummy.has(a) && graph.dummy.has(b) ? options.nodeGap / 2 : options.nodeGap);
  const gapsOf = (layer: string[]) => layer.slice(1).map((id, index) => gap(layer[index]!, id));
  const y = new Map<string, number>();
  for (const layer of layers) {
    const placed = placeInOrder(
      layer.map(() => 0),
      gapsOf(layer),
    );
    layer.forEach((id, index) => {
      y.set(id, placed[index]!);
    });
  }
  const relax = (at: number, sides: Map<string, string[]>[]) => {
    const layer = layers[at]!;
    const desired = layer.map((id) => {
      const around = sides.flatMap((side) => side.get(id)!);
      if (around.length === 0) return y.get(id)!;
      // The median, which an outlying neighbour does not drag away from the rest.
      const values = around.map((other) => y.get(other)!).sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      return values.length % 2 === 1
        ? values[middle]!
        : (values[middle - 1]! + values[middle]!) / 2;
    });
    const placed = placeInOrder(desired, gapsOf(layer));
    layer.forEach((id, index) => {
      y.set(id, placed[index]!);
    });
  };
  for (let round = 0; round < 6; round++) {
    for (let at = 1; at < layers.length; at++) relax(at, [graph.up]);
    for (let at = layers.length - 2; at >= 0; at--) relax(at, [graph.down]);
  }
  for (let at = 0; at < layers.length; at++) relax(at, [graph.up, graph.down]);
  return y;
}

function layoutComponent(
  ids: string[],
  edges: LayoutEdge[],
  options: LayoutOptions,
  component: number,
) {
  const acyclic = breakCycles(ids, edges);
  const layer = assignLayers(ids, acyclic);
  const graph = virtualGraph(ids, acyclic, layer);
  const layers = orderLayers(graph, ids);
  const center = assignY(layers, graph, options);
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const [id, value] of center) {
    const half = graph.dummy.has(id) ? 0 : options.nodeHeight / 2;
    top = Math.min(top, value - half);
    bottom = Math.max(bottom, value + half);
  }
  const stride = options.nodeWidth + options.layerGap;
  const nodes = new Map<string, PositionedNode>();
  layers.forEach((members, at) => {
    let order = 0;
    for (const id of members) {
      if (graph.dummy.has(id)) continue;
      nodes.set(id, {
        id,
        x: at * stride,
        y: center.get(id)! - top - options.nodeHeight / 2,
        layer: at,
        order: order++,
        component,
      });
    }
  });
  const routed: RoutedEdge[] = acyclic.map((edge, index) => {
    const chain = graph.chains[index]!;
    const points = chain.map((id, step) => {
      const y = center.get(id)! - top;
      const x = layer.get(id) ?? Number(id.slice(id.lastIndexOf(':') + 1));
      const left = x * stride;
      if (step === 0) return { x: left + options.nodeWidth, y };
      if (step === chain.length - 1) return { x: left, y };
      return { x: left + options.nodeWidth / 2, y };
    });
    return edge.reversed
      ? { from: edge.to, to: edge.from, points: points.reverse(), reversed: true }
      : { from: edge.from, to: edge.to, points, reversed: false };
  });
  return {
    nodes,
    edges: routed,
    width: layers.length * stride - options.layerGap,
    height: bottom - top,
    layers: layers.length,
  };
}

/** Lays the graph out; nodes keep the order given wherever nothing else decides it. */
export function layoutGraph(
  ids: readonly string[],
  given: readonly LayoutEdge[],
  partial: Partial<LayoutOptions> = {},
): GraphLayout {
  const options = { ...DEFAULT_LAYOUT, ...partial };
  const unique = [...new Set(ids)];
  const edges = cleanEdges(unique, given);
  const split = components(unique, edges);
  const nodes = new Map<string, PositionedNode>();
  const routed: RoutedEdge[] = [];
  let top = 0;
  let width = 0;
  let widestLayers = 0;
  split.components.forEach((members, index) => {
    const inside = new Set(members);
    const own = edges.filter((edge) => inside.has(edge.from));
    const laid = layoutComponent(members, own, options, index);
    const shift = (point: Point) => ({ x: point.x, y: point.y + top });
    for (const node of laid.nodes.values()) nodes.set(node.id, { ...node, y: node.y + top });
    for (const edge of laid.edges) routed.push({ ...edge, points: edge.points.map(shift) });
    top += laid.height + options.componentGap;
    width = Math.max(width, laid.width);
    widestLayers = Math.max(widestLayers, laid.layers);
  });
  if (split.isolated.length > 0) {
    const columns = Math.max(
      1,
      options.isolatedColumns ??
        Math.max(widestLayers, Math.ceil(Math.sqrt(split.isolated.length * 2))),
    );
    split.isolated.forEach((id, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      nodes.set(id, {
        id,
        x: column * (options.nodeWidth + options.layerGap),
        y: top + row * (options.nodeHeight + options.nodeGap),
        layer: column,
        order: row,
        component: -1,
      });
    });
    const rows = Math.ceil(split.isolated.length / columns);
    const used = Math.min(columns, split.isolated.length);
    width = Math.max(width, used * (options.nodeWidth + options.layerGap) - options.layerGap);
    top += rows * (options.nodeHeight + options.nodeGap) - options.nodeGap + options.componentGap;
  }
  const height = Math.max(0, top - options.componentGap);
  return { nodes, edges: routed, width: Math.max(0, width), height };
}

/**
 * An SVG path through an edge's points: a smooth S between each pair, leaving and entering
 * horizontally, so a chain reads as one flowing line. A reversed edge has its points the
 * other way round, and its curves bulge back accordingly.
 */
export function edgePath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  let path = `M${round(first!.x)},${round(first!.y)}`;
  let previous = first!;
  for (const point of rest) {
    const bend = Math.max(24, Math.abs(point.x - previous.x) / 2);
    const direction = point.x >= previous.x ? 1 : -1;
    path +=
      ` C${round(previous.x + bend * direction)},${round(previous.y)}` +
      ` ${round(point.x - bend * direction)},${round(point.y)}` +
      ` ${round(point.x)},${round(point.y)}`;
    previous = point;
  }
  return path;
}

const round = (value: number) => Math.round(value * 10) / 10;
