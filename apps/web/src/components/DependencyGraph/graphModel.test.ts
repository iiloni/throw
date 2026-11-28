import type {
  Project as ProjectRow,
  Status as StatusRow,
  TaskRelation,
  Task as TaskRow,
} from '@throw/shared';
import { describe, expect, it } from 'vitest';
import type { BoardData, Task } from '@/components/Board/model';
import { dependencyGraph, externalTasks, nodeLabel } from './graphModel';

const statuses = [
  { id: 'todo', name: 'To do', category: 'backlog' as const, isDefault: true },
  { id: 'doing', name: 'Doing', category: 'active' as const, isDefault: true },
  { id: 'done', name: 'Done', category: 'done' as const, isDefault: true },
  { id: 'dropped', name: 'Dropped', category: 'cancelled' as const, isDefault: true },
];

function task(id: string, number: number, statusId: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    number,
    title: `Task ${number}`,
    statusId,
    priority: 3,
    size: null,
    position: `a${number}`,
    primaryTagId: null,
    secondaryTagIds: [],
    parentId: null,
    closedAt: statusId === 'done' || statusId === 'dropped' ? 1 : null,
    ...extra,
  };
}

const data = (tasks: Task[]): BoardData => ({
  project: {
    id: 'app',
    key: 'APP',
    name: 'App',
    color: 'teal',
    icon: null,
    statuses,
    tags: [],
    priorityNames: [],
  },
  tasks,
});

const blocks = (sourceTaskId: string, targetTaskId: string) =>
  ({ sourceTaskId, targetTaskId, kind: 'blocks' }) as const;

const none = () => undefined;

const ids = (graph: { nodes: { id: string }[] }) => graph.nodes.map((node) => node.id);

describe('dependencyGraph', () => {
  const board = data([
    task('a', 1, 'doing'),
    task('b', 2, 'todo'),
    task('c', 3, 'doing'),
    task('d', 4, 'done'),
    task('lone', 5, 'doing'),
  ]);
  const relations = [blocks('a', 'b'), blocks('d', 'c'), blocks('a', 'c')];
  // As `blockersByTask` gives them: only open blockers count.
  const blockers = new Map([
    ['b', [{ id: 'a' }]],
    ['c', [{ id: 'a' }]],
  ]);

  it('draws blocks relations as edges from blocker to blocked, with states as cards show them', () => {
    const graph = dependencyGraph({
      data: board,
      relations,
      blockers,
      visible: null,
      external: none,
      toggles: { showClosed: true, showIsolated: false },
    });
    expect(graph.edges).toEqual([
      { from: 'a', to: 'b', settled: false },
      { from: 'd', to: 'c', settled: true },
      { from: 'a', to: 'c', settled: false },
    ]);
    const state = Object.fromEntries(graph.nodes.map((node) => [node.id, node.state]));
    expect(state).toEqual({ a: 'ready', b: 'blocked', c: 'blocked', d: 'done' });
    expect(graph.hiddenIsolated).toBe(1);
    expect(graph.nodes.find((node) => node.id === 'b')).toMatchObject({
      identifier: 'APP-2',
      statusName: 'To do',
      category: 'backlog',
      blockedBy: 1,
      external: false,
      projectId: 'app',
    });
  });

  it('puts board tasks in board order: active work, then the backlog, then closed', () => {
    const graph = dependencyGraph({
      data: board,
      relations,
      blockers,
      visible: null,
      external: none,
      toggles: { showClosed: true, showIsolated: true },
    });
    expect(ids(graph)).toEqual(['a', 'c', 'lone', 'b', 'd']);
  });

  it('hides closed tasks and their edges unless asked', () => {
    const graph = dependencyGraph({
      data: board,
      relations,
      blockers,
      visible: null,
      external: none,
      toggles: { showClosed: false, showIsolated: false },
    });
    expect(ids(graph)).not.toContain('d');
    expect(graph.edges.some((edge) => edge.from === 'd')).toBe(false);
    expect(graph.hiddenClosed).toBe(1);
  });

  it('shows unlinked tasks when asked', () => {
    const graph = dependencyGraph({
      data: board,
      relations,
      blockers,
      visible: null,
      external: none,
      toggles: { showClosed: false, showIsolated: true },
    });
    expect(ids(graph)).toContain('lone');
    expect(graph.hiddenIsolated).toBe(0);
  });

  it('narrows to what the board’s filter leaves, dropping edges to filtered-out tasks', () => {
    const graph = dependencyGraph({
      data: board,
      relations,
      blockers,
      visible: new Set(['a', 'c']),
      external: none,
      toggles: { showClosed: true, showIsolated: false },
    });
    expect(ids(graph)).toEqual(['a', 'c']);
    expect(graph.edges).toEqual([{ from: 'a', to: 'c', settled: false }]);
  });

  it('brings in another project’s task at the end of an edge, but not edges between two others', () => {
    const external = (id: string) =>
      id === 'ops'
        ? {
            id,
            identifier: 'OPS-7',
            title: 'Provision',
            statusName: 'Working',
            category: 'active' as const,
            statusColor: null,
            color: 'orange' as const,
            priority: 3 as const,
            priorityName: 'Normal',
            projectId: 'ops-project',
            projectName: 'Operations',
            parentTitle: null,
          }
        : undefined;
    const graph = dependencyGraph({
      data: board,
      relations: [...relations, blocks('ops', 'a'), blocks('ops', 'elsewhere')],
      blockers: new Map([...blockers, ['a', [{ id: 'ops' }]]]),
      visible: null,
      external,
      toggles: { showClosed: false, showIsolated: false },
    });
    expect(graph.nodes.at(-1)).toMatchObject({ id: 'ops', external: true, state: 'ready' });
    expect(graph.nodes.find((node) => node.id === 'a')?.state).toBe('blocked');
    expect(graph.edges).toContainEqual({ from: 'ops', to: 'a', settled: false });
    expect(graph.edges.some((edge) => edge.to === 'elsewhere')).toBe(false);
  });

  it('ignores other kinds of relation and repeats', () => {
    const graph = dependencyGraph({
      data: board,
      relations: [
        blocks('a', 'b'),
        blocks('a', 'b'),
        { sourceTaskId: 'a', targetTaskId: 'lone', kind: 'relates_to' },
        { sourceTaskId: 'c', targetTaskId: 'lone', kind: 'duplicates' },
      ],
      blockers,
      visible: null,
      external: none,
      toggles: { showClosed: false, showIsolated: false },
    });
    expect(graph.edges).toEqual([{ from: 'a', to: 'b', settled: false }]);
  });
});

describe('externalTasks', () => {
  const project = (id: string, extra: Partial<ProjectRow> = {}) =>
    ({
      id,
      workspaceId: 'w',
      key: 'OPS',
      name: 'Operations',
      color: 'orange',
      icon: null,
      position: 'a0',
      priorityNames: [],
      deletedAt: null,
      ...extra,
    }) as unknown as ProjectRow;
  const row = (id: string, extra: Partial<TaskRow> = {}) =>
    ({
      id,
      projectId: 'ops',
      number: 7,
      title: 'Provision',
      statusId: 's',
      priority: 2,
      parentId: null,
      deletedAt: null,
      ...extra,
    }) as unknown as TaskRow;
  const status = {
    id: 's',
    projectId: 'ops',
    name: 'Working',
    category: 'active',
    color: null,
  } as unknown as StatusRow;

  it('names another project’s task by its own key and project', () => {
    const find = externalTasks([row('t')], [status], [project('ops')]);
    expect(find('t')).toMatchObject({
      identifier: 'OPS-7',
      projectName: 'Operations',
      projectId: 'ops',
      color: 'orange',
      priorityName: 'High',
    });
  });

  it('leaves out trashed tasks and tasks of a trashed project', () => {
    expect(externalTasks([row('t', { deletedAt: 'x' })], [status], [project('ops')])('t')).toBe(
      undefined,
    );
    expect(externalTasks([row('t')], [status], [project('ops', { deletedAt: 'x' })])('t')).toBe(
      undefined,
    );
    expect(externalTasks([], [status], [project('ops')])('t')).toBe(undefined);
  });
});

describe('nodeLabel', () => {
  it('says what the task is and how it stands', () => {
    const [node] = dependencyGraph({
      data: data([task('a', 1, 'doing'), task('b', 2, 'doing')]),
      relations: [blocks('a', 'b') as Pick<TaskRelation, 'sourceTaskId' | 'targetTaskId' | 'kind'>],
      blockers: new Map([['b', [{ id: 'a' }]]]),
      visible: null,
      external: none,
      toggles: { showClosed: false, showIsolated: false },
    }).nodes.filter((item) => item.id === 'b');
    expect(nodeLabel(node!)).toBe('APP-2 Task 2, Doing, blocked by 1 task');
  });
});
