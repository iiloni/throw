import { describe, expect, it } from 'vitest';
import {
  assignLayers,
  breakCycles,
  cleanEdges,
  components,
  countCrossings,
  DEFAULT_LAYOUT,
  edgePath,
  layoutGraph,
  placeInOrder,
  topologicalOrder,
} from './layout';

const edge = (from: string, to: string) => ({ from, to });
const stride = DEFAULT_LAYOUT.nodeWidth + DEFAULT_LAYOUT.layerGap;

describe('cleanEdges', () => {
  it('drops self-loops, repeats and edges to unknown nodes', () => {
    expect(
      cleanEdges(['a', 'b'], [edge('a', 'b'), edge('a', 'b'), edge('a', 'a'), edge('a', 'z')]),
    ).toEqual([edge('a', 'b')]);
  });
});

describe('breakCycles', () => {
  it('leaves an acyclic graph alone', () => {
    expect(breakCycles(['a', 'b', 'c'], [edge('a', 'b'), edge('b', 'c')])).toEqual([
      { from: 'a', to: 'b', reversed: false },
      { from: 'b', to: 'c', reversed: false },
    ]);
  });

  it('turns round the edge that closes a cycle, so what is left is acyclic', () => {
    const result = breakCycles(['a', 'b', 'c'], [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]);
    expect(result.filter((item) => item.reversed)).toEqual([
      { from: 'a', to: 'c', reversed: true },
    ]);
    const order = topologicalOrder(['a', 'b', 'c'], result);
    expect(order).toHaveLength(3);
  });

  it('keeps one direction of two tasks blocking each other', () => {
    const result = breakCycles(['a', 'b'], [edge('a', 'b'), edge('b', 'a')]);
    expect(result).toEqual([
      { from: 'a', to: 'b', reversed: false },
      { from: 'a', to: 'b', reversed: true },
    ]);
  });

  it('copes with a long chain without overflowing the stack', () => {
    const ids = Array.from({ length: 20_000 }, (_, index) => `n${index}`);
    const edges = ids.slice(1).map((id, index) => edge(ids[index]!, id));
    expect(breakCycles(ids, edges).some((item) => item.reversed)).toBe(false);
  });
});

describe('assignLayers', () => {
  it('puts each node one past its deepest blocker', () => {
    const layers = assignLayers(
      ['a', 'b', 'c', 'd'],
      [edge('a', 'b'), edge('b', 'd'), edge('a', 'c'), edge('c', 'd')],
    );
    expect(Object.fromEntries(layers)).toEqual({ a: 0, b: 1, c: 1, d: 2 });
  });

  it('pulls a lone root up beside the work it blocks', () => {
    const layers = assignLayers(
      ['a', 'b', 'c', 'x'],
      [edge('a', 'b'), edge('b', 'c'), edge('x', 'c')],
    );
    expect(layers.get('x')).toBe(1);
    expect(layers.get('a')).toBe(0);
  });
});

describe('components', () => {
  it('groups linked nodes, largest first, and sets aside the unlinked', () => {
    const result = components(
      ['solo', 'p', 'q', 'a', 'b', 'c'],
      [edge('p', 'q'), edge('a', 'b'), edge('c', 'b')],
    );
    expect(result.components).toEqual([
      ['a', 'b', 'c'],
      ['p', 'q'],
    ]);
    expect(result.isolated).toEqual(['solo']);
  });
});

describe('countCrossings', () => {
  it('counts the pairs of edges that cross between two layers', () => {
    expect(
      countCrossings(
        [
          [0, 0],
          [1, 1],
        ],
        2,
      ),
    ).toBe(0);
    expect(
      countCrossings(
        [
          [0, 1],
          [1, 0],
        ],
        2,
      ),
    ).toBe(1);
    expect(
      countCrossings(
        [
          [0, 2],
          [1, 1],
          [2, 0],
        ],
        3,
      ),
    ).toBe(3);
  });
});

describe('placeInOrder', () => {
  it('keeps positions where they want to be when they are far enough apart', () => {
    expect(placeInOrder([0, 100, 300], [50, 50])).toEqual([0, 100, 300]);
  });

  it('spreads crowded positions evenly around where they wanted to be', () => {
    expect(placeInOrder([100, 100], [50])).toEqual([75, 125]);
  });

  it('never lets them pass each other', () => {
    const placed = placeInOrder([200, 0, 100], [10, 10]);
    expect(placed[1]! - placed[0]!).toBeGreaterThanOrEqual(10 - 1e-9);
    expect(placed[2]! - placed[1]!).toBeGreaterThanOrEqual(10 - 1e-9);
  });
});

describe('layoutGraph', () => {
  it('lays a chain out left to right, level', () => {
    const layout = layoutGraph(['a', 'b', 'c'], [edge('a', 'b'), edge('b', 'c')]);
    const [a, b, c] = ['a', 'b', 'c'].map((id) => layout.nodes.get(id)!);
    expect([a!.x, b!.x, c!.x]).toEqual([0, stride, stride * 2]);
    expect(a!.y).toBe(b!.y);
    expect(b!.y).toBe(c!.y);
    expect(layout.width).toBe(stride * 3 - DEFAULT_LAYOUT.layerGap);
    expect(layout.height).toBe(DEFAULT_LAYOUT.nodeHeight);
  });

  it('routes an edge from the blocker’s right side to the blocked task’s left side', () => {
    const layout = layoutGraph(['a', 'b'], [edge('a', 'b')]);
    const [route] = layout.edges;
    expect(route!.points[0]).toEqual({ x: DEFAULT_LAYOUT.nodeWidth, y: 46 });
    expect(route!.points.at(-1)).toEqual({ x: stride, y: 46 });
  });

  it('passes a long edge through a point in each layer it crosses', () => {
    const layout = layoutGraph(['a', 'b', 'c'], [edge('a', 'b'), edge('b', 'c'), edge('a', 'c')]);
    const long = layout.edges.find((route) => route.from === 'a' && route.to === 'c')!;
    expect(long.points).toHaveLength(3);
    expect(long.points[1]!.x).toBe(stride + DEFAULT_LAYOUT.nodeWidth / 2);
  });

  it('keeps nodes of a layer apart', () => {
    const layout = layoutGraph(
      ['root', 'a', 'b', 'c'],
      [edge('root', 'a'), edge('root', 'b'), edge('root', 'c')],
    );
    const ys = ['a', 'b', 'c'].map((id) => layout.nodes.get(id)!.y).sort((p, q) => p - q);
    for (let index = 1; index < ys.length; index++)
      expect(ys[index]! - ys[index - 1]!).toBeGreaterThanOrEqual(
        DEFAULT_LAYOUT.nodeHeight + DEFAULT_LAYOUT.nodeGap - 1e-6,
      );
    // The root sits level with the middle of what it blocks.
    expect(layout.nodes.get('root')!.y).toBeCloseTo(layout.nodes.get('b')!.y);
  });

  it('orders a layer to undo a crossing the given order would make', () => {
    // a→d, b→c with c listed before d would cross; the layout uncrosses them.
    const layout = layoutGraph(['a', 'b', 'c', 'd'], [edge('a', 'd'), edge('b', 'c')]);
    const above = (p: string, q: string) => layout.nodes.get(p)!.y < layout.nodes.get(q)!.y;
    // Two components: each is a level pair.
    expect(layout.nodes.get('a')!.y).toBe(layout.nodes.get('d')!.y);
    expect(layout.nodes.get('b')!.y).toBe(layout.nodes.get('c')!.y);
    expect(above('a', 'b')).toBe(true);
  });

  it('finds an order with no crossings where one exists', () => {
    const ids = ['r1', 'r2', 'x', 'y'];
    const layout = layoutGraph(ids, [edge('r1', 'y'), edge('r2', 'x'), edge('r1', 'x')]);
    const position = (id: string) => layout.nodes.get(id)!.order;
    const pairs: [number, number][] = [
      [position('r1'), position('y')],
      [position('r2'), position('x')],
      [position('r1'), position('x')],
    ];
    expect(countCrossings(pairs, 2)).toBe(0);
  });

  it('stacks components and puts unlinked tasks in a grid beneath', () => {
    const layout = layoutGraph(
      ['a', 'b', 'p', 'q', 'r', 'solo1', 'solo2'],
      [edge('a', 'b'), edge('p', 'q'), edge('q', 'r')],
    );
    const big = layout.nodes.get('p')!;
    const small = layout.nodes.get('a')!;
    expect(big.component).toBe(0);
    expect(small.component).toBe(1);
    expect(small.y).toBeGreaterThanOrEqual(DEFAULT_LAYOUT.nodeHeight + DEFAULT_LAYOUT.componentGap);
    const solo = layout.nodes.get('solo1')!;
    expect(solo.component).toBe(-1);
    expect(solo.y).toBeGreaterThan(small.y);
    expect(layout.nodes.get('solo2')!.y).toBe(solo.y);
    expect(layout.height).toBe(solo.y + DEFAULT_LAYOUT.nodeHeight);
  });

  it('draws a cycle with its closing edge reversed, still from blocker to blocked', () => {
    const layout = layoutGraph(['a', 'b'], [edge('a', 'b'), edge('b', 'a')]);
    const back = layout.edges.find((route) => route.reversed)!;
    expect(back).toMatchObject({ from: 'b', to: 'a' });
    // It leaves b's left side and ends at a's right side.
    expect(back.points[0]!.x).toBe(stride);
    expect(back.points.at(-1)!.x).toBe(DEFAULT_LAYOUT.nodeWidth);
  });

  it('is deterministic', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const edges = [edge('a', 'c'), edge('b', 'c'), edge('c', 'd'), edge('b', 'e'), edge('e', 'f')];
    const first = layoutGraph(ids, edges);
    const second = layoutGraph(ids, edges);
    expect([...second.nodes.values()]).toEqual([...first.nodes.values()]);
    expect(second.edges).toEqual(first.edges);
  });

  it('draws an empty graph as nothing', () => {
    expect(layoutGraph([], [])).toMatchObject({ width: 0, height: 0, edges: [] });
  });
});

describe('edgePath', () => {
  it('curves smoothly between points, leaving and entering level', () => {
    expect(
      edgePath([
        { x: 0, y: 0 },
        { x: 100, y: 50 },
      ]),
    ).toBe('M0,0 C50,0 50,50 100,50');
  });
});
