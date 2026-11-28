import {
  type Color,
  isTaskTrashed,
  type Project as ProjectRow,
  type Status as StatusRow,
  type TaskRelation,
  type Task as TaskRow,
  taskIdentifier,
} from '@throw/shared';
import type { TaskBlocker } from '@/components/Board/blockers';
import {
  type BoardData,
  type Category,
  compareTasks,
  identifier,
  isClosed,
  type Priority,
  priorityName,
  projectOf,
  statusById,
  type Task,
  taskColor,
} from '@/components/Board/model';

/**
 * How a task stands in the graph. Ready and blocked follow the board's blocked mark exactly
 * (`blockersByTask`): blocked while any open, untrashed task blocks it, wherever that task is.
 */
export type NodeState = 'ready' | 'blocked' | 'done' | 'cancelled';

export type GraphNode = {
  id: string;
  identifier: string;
  title: string;
  statusName: string;
  category: Category;
  statusColor: Color | null;
  /** The card's accent: its primary tag's root, or on the workspace board its project's. */
  color: Color | null;
  priority: Priority;
  priorityName: string;
  state: NodeState;
  /** Open tasks blocking it, as its card's blocked mark counts them. */
  blockedBy: number;
  /** Not on this board: another project's task at the end of one of this board's edges. */
  external: boolean;
  /** The project the task belongs to, where opening it goes. */
  projectId: string;
  projectName: string | null;
  parentTitle: string | null;
};

export type GraphEdge = {
  /** The blocker. */
  from: string;
  /** The task it blocks. */
  to: string;
  /** The blocker is closed, so the edge no longer holds anything up. */
  settled: boolean;
};

export type GraphToggles = {
  /** Done and cancelled tasks stay in the graph. */
  showClosed: boolean;
  /** Tasks with no blocking edge stay in the graph. */
  showIsolated: boolean;
};

export type DependencyGraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Board tasks left out for being closed. */
  hiddenClosed: number;
  /** Open board tasks left out for having no edge. */
  hiddenIsolated: number;
};

/** Another project's task, as the graph draws it when it stands at the end of an edge. */
export type ExternalTask = Omit<GraphNode, 'state' | 'blockedBy' | 'external'>;

const CATEGORY_ORDER: Record<Category, number> = { active: 0, backlog: 1, done: 2, cancelled: 3 };

function stateOf(category: Category, blockers: number): NodeState {
  if (category === 'done' || category === 'cancelled') return category;
  return blockers > 0 ? 'blocked' : 'ready';
}

/**
 * Looks up tasks off the board from the synced rows: untrashed ones with a status, named by
 * their own project. The graph draws them where they block, or are blocked by, this board's.
 */
export function externalTasks(
  tasks: readonly TaskRow[],
  statuses: readonly StatusRow[],
  projects: readonly ProjectRow[],
): (id: string) => ExternalTask | undefined {
  const taskById = new Map(tasks.map((row) => [row.id, row]));
  const statusById = new Map(statuses.map((row) => [row.id, row]));
  const projectById = new Map(projects.map((row) => [row.id, row]));
  return (id) => {
    const task = taskById.get(id);
    if (!task) return undefined;
    const project = projectById.get(task.projectId);
    const parent = task.parentId ? taskById.get(task.parentId) : undefined;
    const status = statusById.get(task.statusId);
    if (!project || !status || isTaskTrashed(task, parent, project)) return undefined;
    const names = project.priorityNames;
    return {
      id,
      identifier: taskIdentifier(project, task) ?? 'Pending',
      title: task.title,
      statusName: status.name,
      category: status.category,
      statusColor: status.color ?? null,
      color: project.color,
      projectId: project.id,
      priority: task.priority,
      priorityName: priorityName(
        { ...project, statuses: [], tags: [], priorityNames: names },
        task.priority,
      ),
      projectName: project.name,
      parentTitle: parent?.title ?? null,
    };
  };
}

/**
 * The graph a board draws: its tasks as nodes and `blocks` relations as edges from blocker to
 * blocked. `visible` is what the board's filter leaves (null for everything), matched task by
 * task, so a subtask stands on its own. Tasks of other projects joined to one of this board's
 * by an edge come in as external nodes, with their own blockers upstream of them; the filter
 * is the board's, so it leaves them alone.
 */
export function dependencyGraph({
  data,
  relations,
  blockers,
  visible,
  external,
  toggles,
}: {
  data: BoardData;
  relations: readonly Pick<TaskRelation, 'sourceTaskId' | 'targetTaskId' | 'kind'>[];
  blockers: ReadonlyMap<string, readonly Pick<TaskBlocker, 'id'>[]>;
  visible: ReadonlySet<string> | null;
  external: (id: string) => ExternalTask | undefined;
  toggles: GraphToggles;
}): DependencyGraphData {
  const { project } = data;
  const onBoard = new Map(data.tasks.map((task) => [task.id, task]));
  const statusOrder = new Map(project.statuses.map((status, index) => [status.id, index]));
  const blockedBy = (id: string) => blockers.get(id)?.length ?? 0;
  const boardNode = (task: Task): GraphNode => {
    const own = projectOf(project, task);
    const status = statusById(project, task.statusId);
    const category = status?.category ?? 'backlog';
    const parent = task.parentId ? onBoard.get(task.parentId) : undefined;
    return {
      id: task.id,
      identifier: identifier(project, task) ?? 'Pending',
      title: task.title,
      statusName: status?.name ?? '',
      category,
      statusColor: status?.color ?? null,
      color: taskColor(project, task),
      priority: task.priority,
      priorityName: priorityName(own, task.priority),
      state: stateOf(category, blockedBy(task.id)),
      blockedBy: blockedBy(task.id),
      external: false,
      projectId: task.projectId ?? project.id,
      projectName: project.members ? own.name : null,
      parentTitle: parent?.title ?? null,
    };
  };

  const shown = new Map<string, GraphNode>();
  const included = (node: GraphNode) => toggles.showClosed || !isClosed(node.category);
  // Board tasks first, in board order, so the layout's tie-breaks follow the columns.
  const ordered = [...onBoard.values()].sort(
    (a, b) =>
      CATEGORY_ORDER[statusById(project, a.statusId)?.category ?? 'backlog'] -
        CATEGORY_ORDER[statusById(project, b.statusId)?.category ?? 'backlog'] ||
      (statusOrder.get(a.statusId) ?? 0) - (statusOrder.get(b.statusId) ?? 0) ||
      compareTasks(a, b),
  );
  const candidates = new Map<string, GraphNode>();
  for (const task of ordered) {
    if (visible !== null && !visible.has(task.id)) continue;
    candidates.set(task.id, boardNode(task));
  }
  const externals = new Map<string, GraphNode>();
  const endOf = (id: string): GraphNode | undefined => {
    if (onBoard.has(id)) return candidates.get(id);
    const known = externals.get(id);
    if (known) return known;
    const found = external(id);
    if (!found) return undefined;
    const node: GraphNode = {
      ...found,
      state: stateOf(found.category, blockedBy(id)),
      blockedBy: blockedBy(id),
      external: true,
    };
    externals.set(id, node);
    return node;
  };

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const linked = new Set<string>();
  for (const relation of relations) {
    if (relation.kind !== 'blocks') continue;
    const { sourceTaskId: from, targetTaskId: to } = relation;
    if (from === to || (!onBoard.has(from) && !onBoard.has(to))) continue;
    const key = `${from}\n${to}`;
    if (seen.has(key)) continue;
    const source = endOf(from);
    const target = endOf(to);
    if (!source || !target || !included(source) || !included(target)) continue;
    seen.add(key);
    linked.add(from);
    linked.add(to);
    edges.push({ from, to, settled: isClosed(source.category) });
  }
  // Another project's task is drawn with what blocks it, all the way up, so its blocked mark
  // is explained in the graph as a board task's is; what it blocks off the board stays out.
  const offBoardBlockers = new Map<string, string[]>();
  for (const relation of relations) {
    if (relation.kind !== 'blocks' || onBoard.has(relation.sourceTaskId)) continue;
    const list = offBoardBlockers.get(relation.targetTaskId);
    if (list) list.push(relation.sourceTaskId);
    else offBoardBlockers.set(relation.targetTaskId, [relation.sourceTaskId]);
  }
  const pending = [...externals.keys()].filter((id) => linked.has(id));
  while (pending.length > 0) {
    const to = pending.shift()!;
    const target = externals.get(to)!;
    for (const from of offBoardBlockers.get(to) ?? []) {
      const key = `${from}\n${to}`;
      if (from === to || seen.has(key)) continue;
      const source = endOf(from);
      if (!source || !included(source) || !included(target)) continue;
      seen.add(key);
      if (!linked.has(from)) pending.push(from);
      linked.add(from);
      edges.push({ from, to, settled: isClosed(source.category) });
    }
  }

  let hiddenClosed = 0;
  let hiddenIsolated = 0;
  for (const node of candidates.values()) {
    if (linked.has(node.id)) shown.set(node.id, node);
    else if (!included(node)) hiddenClosed += 1;
    else if (!toggles.showIsolated) hiddenIsolated += 1;
    else shown.set(node.id, node);
  }
  const outside = [...externals.values()]
    .filter((node) => linked.has(node.id))
    .sort((a, b) => a.identifier.localeCompare(b.identifier, undefined, { numeric: true }));
  for (const node of outside) shown.set(node.id, node);
  return { nodes: [...shown.values()], edges, hiddenClosed, hiddenIsolated };
}

/** What a node says to a screen reader: what it is and how it stands. */
export function nodeLabel(node: GraphNode) {
  const state =
    node.state === 'blocked'
      ? `blocked by ${node.blockedBy} ${node.blockedBy === 1 ? 'task' : 'tasks'}`
      : node.state === 'ready'
        ? 'ready'
        : node.state;
  const where = node.external && node.projectName ? `, in ${node.projectName}` : '';
  return `${node.identifier} ${node.title || 'Untitled task'}, ${node.statusName}, ${state}${where}`;
}
