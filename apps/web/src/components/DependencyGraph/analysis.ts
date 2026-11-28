import { breakCycles, cleanEdges, type LayoutEdge, topologicalOrder } from './layout';

/**
 * The longest chain of open work, blocker first: what has to be done one after the other
 * before the last of it can start, so the order the project cannot go faster than. Closed
 * tasks block nothing and are left out. Ties go to the chain that starts earliest in the
 * given order. A cycle is broken as the layout breaks it.
 */
export function criticalPath(
  ids: readonly string[],
  edges: readonly LayoutEdge[],
  isOpen: (id: string) => boolean,
): string[] {
  const open = ids.filter(isOpen);
  const acyclic = breakCycles(open, cleanEdges(open, edges)).map(({ from, to }) => ({ from, to }));
  const order = topologicalOrder(open, acyclic);
  const rank = new Map(open.map((id, index) => [id, index]));
  const succs = new Map<string, string[]>(open.map((id) => [id, []]));
  for (const edge of acyclic) succs.get(edge.from)!.push(edge.to);
  // The longest chain starting at each node, worked out from the end of the order.
  const length = new Map<string, number>();
  const next = new Map<string, string | null>();
  for (const id of [...order].reverse()) {
    let best: string | null = null;
    for (const after of succs.get(id)!) {
      if (
        best === null ||
        length.get(after)! > length.get(best)! ||
        (length.get(after) === length.get(best) && rank.get(after)! < rank.get(best)!)
      )
        best = after;
    }
    length.set(id, best === null ? 1 : length.get(best)! + 1);
    next.set(id, best);
  }
  let start: string | null = null;
  for (const id of open) {
    if (start === null || length.get(id)! > length.get(start)!) start = id;
  }
  // A path of one task is no chain at all.
  if (start === null || length.get(start)! < 2) return [];
  const path: string[] = [];
  for (let at: string | null = start; at !== null; at = next.get(at) ?? null) path.push(at);
  return path;
}

/** Every node reached from `id` along the edges (`down`) or against them (`up`). */
export function reachable(
  id: string,
  edges: readonly LayoutEdge[],
  direction: 'up' | 'down',
): Set<string> {
  const step = new Map<string, string[]>();
  for (const edge of edges) {
    const [from, to] = direction === 'down' ? [edge.from, edge.to] : [edge.to, edge.from];
    const list = step.get(from);
    if (list) list.push(to);
    else step.set(from, [to]);
  }
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const at = queue.shift()!;
    for (const next of step.get(at) ?? []) {
      if (next === id || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/**
 * For each open task, how many open tasks wait on it, directly or further down: finishing a
 * task with many is what frees the most work, so the graph marks those as bottlenecks.
 */
export function waitingOn(
  ids: readonly string[],
  edges: readonly LayoutEdge[],
  isOpen: (id: string) => boolean,
): Map<string, number> {
  const open = ids.filter(isOpen);
  const inside = cleanEdges(open, edges);
  const counts = new Map<string, number>();
  for (const id of open) counts.set(id, reachable(id, inside, 'down').size);
  return counts;
}

/** The fewest tasks waiting on one before the graph calls it a bottleneck. */
export const BOTTLENECK_AT = 3;
