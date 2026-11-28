import { SIZES, type Size } from '@throw/shared';
import type { BoardReleases } from '@/lib/githubReleases';
import { normalizeSearch, type PreparedQuery, prepareQuery, rankMatch } from '@/lib/taskSearch';
import {
  type BoardData,
  type BoardRelations,
  compareTasks,
  identifier,
  type Project,
  projectOf,
  type Tag,
  type Task,
} from './model';

/**
 * What a board shows and in what order, while someone narrows it down: search and filters
 * hide the cards that do not match, and the size sort reorders the columns. All of it is view
 * state on this device, gone when the board is left or reloaded (spec, "Search, filters and
 * sorting").
 */

export type TagMatch = 'any' | 'all';

export type SortField = 'size' | 'created' | 'updated';
export type SortDirection = 'asc' | 'desc';

/**
 * `priority` is the board's own order (ADR 0008). The others order by a task's size, when it
 * was added or when it last changed, put tasks without the value last either way and fall
 * back to the priority order for ties.
 */
export type BoardSort = 'priority' | `${SortField}-${SortDirection}`;

/** The relations a card can be chosen by, in the order the filter lists them. */
export const RELATION_FILTERS = ['blocked', 'blocking', 'duplicates'] as const;
export type RelationFilter = (typeof RELATION_FILTERS)[number];

export const RELATION_FILTER_NAMES: Record<RelationFilter, string> = {
  blocked: 'Blocked',
  blocking: 'Blocking',
  duplicates: 'Duplicates',
};

export type BoardFilter = {
  query: string;
  /** Tags a card must carry, itself or through a tag below it. A project board's alone. */
  tagIds: string[];
  /** With several tags: all of them, or any one. */
  match: TagMatch;
  untagged: boolean;
  /** Any of these sizes. */
  sizes: Size[];
  unsized: boolean;
  /** Any of these relations: blocked, blocking another task, or linked as a duplicate. */
  relations: RelationFilter[];
  /** Any of these GitHub releases, by id: tasks bound to one (ADR 0017). */
  releaseIds: string[];
  /** Merged work no shipped release holds yet, as MCP's `unreleased` reads it. */
  unreleased: boolean;
  /** The workspace board's project scope. */
  projectId: string | null;
};

export const EMPTY_FILTER: BoardFilter = {
  query: '',
  tagIds: [],
  match: 'any',
  untagged: false,
  sizes: [],
  unsized: false,
  relations: [],
  releaseIds: [],
  unreleased: false,
  projectId: null,
};

/** Anything beyond the query: what the filter button marks and the chips list. */
export function chosenFilters(filter: BoardFilter) {
  return (
    filter.tagIds.length +
    Number(filter.untagged) +
    filter.sizes.length +
    Number(filter.unsized) +
    filter.relations.length +
    filter.releaseIds.length +
    Number(filter.unreleased) +
    Number(filter.projectId !== null)
  );
}

export function isFiltering(filter: BoardFilter) {
  return filter.query.trim() !== '' || chosenFilters(filter) > 0;
}

const ancestry = new WeakMap<readonly Tag[], Map<string, readonly string[]>>();

/**
 * A tag and every tag above it. A card tagged Garden under Home carries both, so a filter on
 * Home finds it, as Catch's tag search does. A tag that has not synced adds nothing.
 */
function tagLine(tags: readonly Tag[], tagId: string): readonly string[] {
  let lines = ancestry.get(tags);
  if (!lines) {
    lines = new Map();
    ancestry.set(tags, lines);
  }
  const known = lines.get(tagId);
  if (known) return known;
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  const line: string[] = [];
  for (let id: string | null | undefined = tagId; id && byId.has(id) && !line.includes(id); ) {
    line.push(id);
    id = byId.get(id)?.parentId;
  }
  lines.set(tagId, line);
  return line;
}

/** A card's tags, primary and secondary, with the tags above them. */
export function cardTags(project: Project, task: Task): ReadonlySet<string> {
  const { tags } = projectOf(project, task);
  const ids = task.primaryTagId
    ? [task.primaryTagId, ...task.secondaryTagIds]
    : task.secondaryTagIds;
  return new Set(ids.flatMap((id) => tagLine(tags, id)));
}

/** Catch's tag filter: Untagged alone, or all or any of the chosen tags. */
export function matchesTags(assigned: ReadonlySet<string>, filter: BoardFilter) {
  if (filter.untagged) return assigned.size === 0;
  if (filter.tagIds.length === 0) return true;
  const has = (id: string) => assigned.has(id);
  return filter.match === 'all' ? filter.tagIds.every(has) : filter.tagIds.some(has);
}

/** Any of the chosen sizes, or none at all for Unsized. */
export function matchesSize(task: Pick<Task, 'size'>, filter: BoardFilter) {
  if (filter.sizes.length === 0 && !filter.unsized) return true;
  return task.size === null ? filter.unsized : filter.sizes.includes(task.size);
}

/**
 * Whether a task has the chosen relation. Blocked is the card's own rule for its badge: an
 * open blocker, on a task that is not closed itself. A board without relations (the
 * prototype) has none.
 */
export function hasRelation(
  task: Pick<Task, 'id' | 'closedAt'>,
  relation: RelationFilter,
  relations: BoardRelations | undefined,
) {
  if (!relations) return false;
  if (relation === 'blocked') return relations.blocked.has(task.id) && task.closedAt === null;
  return relations[relation].has(task.id);
}

/** Any of the chosen relations. */
export function matchesRelations(
  task: Pick<Task, 'id' | 'closedAt'>,
  filter: BoardFilter,
  relations: BoardRelations | undefined,
) {
  if (filter.relations.length === 0) return true;
  return filter.relations.some((relation) => hasRelation(task, relation, relations));
}

/**
 * Whether a task is in any of the chosen releases, or waits for one when Unreleased is chosen.
 * A board without releases (the prototype) has none.
 */
export function matchesReleases(
  task: Pick<Task, 'id'>,
  filter: Pick<BoardFilter, 'releaseIds' | 'unreleased'>,
  releases: BoardReleases | undefined,
) {
  if (filter.releaseIds.length === 0 && !filter.unreleased) return true;
  if (!releases) return false;
  if (filter.unreleased && releases.unreleased.has(task.id)) return true;
  const own = releases.byTask.get(task.id);
  return !!own && filter.releaseIds.some((id) => own.has(id));
}

/** What a board knows of its tasks' links, for the filters that choose by them. */
export type BoardLinks = Pick<BoardData, 'relations' | 'releases'>;

function cardText(project: Project, task: Task) {
  const own = projectOf(project, task);
  const names = cardTags(project, task);
  const tagNames = own.tags.filter((tag) => names.has(tag.id)).map((tag) => tag.name);
  const text = task.searchText ?? normalizeSearch(`${task.title} ${task.description ?? ''}`.trim());
  return `${text} ${normalizeSearch([identifier(project, task) ?? '', ...tagNames].join(' '))}`;
}

/** How well a card answers the query, as the palette ranks it; null when it does not. */
export function queryRank(project: Project, task: Task, query: PreparedQuery) {
  return rankMatch(query, {
    number: task.number,
    key: projectOf(project, task).key,
    title: normalizeSearch(task.title),
    text: cardText(project, task),
  });
}

/** Whether a task matches everything chosen, the query included. */
export function matchesFilter(
  project: Project,
  task: Task,
  filter: BoardFilter,
  query: PreparedQuery | null = prepareQuery(filter.query),
  links: BoardLinks = {},
) {
  if (filter.projectId !== null && task.projectId !== filter.projectId) return false;
  if (!matchesSize(task, filter)) return false;
  if (!matchesRelations(task, filter, links.relations)) return false;
  if (!matchesReleases(task, filter, links.releases)) return false;
  if (!matchesTags(cardTags(project, task), filter)) return false;
  return query === null || queryRank(project, task, query) !== null;
}

type Matching = { filter: BoardFilter; subtasksAsCards: boolean; ids: ReadonlySet<string> | null };
const matched = new WeakMap<BoardData, Matching>();

/**
 * The tasks a filtered board shows: those that match and, while subtasks stay with their
 * parent, a parent one of whose subtasks matches, since the card stands for them. Null when
 * nothing is filtered, so the board shows everything.
 */
export function matchingIds(
  data: BoardData,
  filter: BoardFilter,
  subtasksAsCards: boolean,
): ReadonlySet<string> | null {
  if (!isFiltering(filter)) return null;
  const known = matched.get(data);
  if (known && known.filter === filter && known.subtasksAsCards === subtasksAsCards)
    return known.ids;
  const query = prepareQuery(filter.query);
  const ids = new Set<string>();
  for (const task of data.tasks) {
    if (!matchesFilter(data.project, task, filter, query, data)) continue;
    ids.add(task.id);
    if (!subtasksAsCards && task.parentId !== null) ids.add(task.parentId);
  }
  matched.set(data, { filter, subtasksAsCards, ids });
  return ids;
}

/**
 * The task Enter opens from the search: the best answer to the query among those that match
 * the filters, ranked as the palette ranks its results. Open work comes before any closed work,
 * as the palette lists it, unless the closed task is named by its exact identifier; between
 * equal answers, open work still comes first.
 */
export function bestMatch(data: BoardData, filter: BoardFilter, closed: (task: Task) => boolean) {
  const query = prepareQuery(filter.query);
  if (!query) return undefined;
  let best: { task: Task; rank: number } | undefined;
  for (const task of data.tasks) {
    if (!matchesFilter(data.project, task, { ...filter, query: '' }, null, data)) continue;
    const rank = queryRank(data.project, task, query);
    if (rank === null) continue;
    const shut = closed(task);
    // Ranks run 0 to 4: a closed task found by anything but its identifier sorts after them all.
    const score = (shut && rank > 0 ? 5 + rank : rank) * 2 + Number(shut);
    if (
      !best ||
      score < best.rank ||
      (score === best.rank && task.title.localeCompare(best.task.title) < 0)
    )
      best = { task, rank: score };
  }
  return best?.task;
}

export type FacetCounts = {
  tags: ReadonlyMap<string, number>;
  untagged: number;
  sizes: ReadonlyMap<Size | null, number>;
  /** The workspace board's projects. */
  projects: ReadonlyMap<string, number>;
  relations: ReadonlyMap<RelationFilter, number>;
  /** Each listed release's cards, and the cards of merged work awaiting one. */
  releases: ReadonlyMap<string, number>;
  unreleased: number;
};

/**
 * How many cards each choice would leave, given the rest of the filter: a tag's count is of
 * cards that match everything but the tags, a size's of those that match everything but the
 * sizes, a project's of those that match everything but the project scope, and a relation's of
 * those that match everything but the relations. A release's count, and Unreleased's, are of
 * cards that match everything but the release choice.
 */
export function facetCounts(
  data: BoardData,
  filter: BoardFilter,
  subtasksAsCards: boolean,
): FacetCounts {
  const query = prepareQuery(filter.query);
  const tags = new Map<string, number>();
  const sizes = new Map<Size | null, number>([...SIZES, null].map((size) => [size, 0]));
  const projects = new Map<string, number>();
  const relations = new Map<RelationFilter, number>(
    RELATION_FILTERS.map((relation) => [relation, 0]),
  );
  const releases = new Map<string, number>();
  let untagged = 0;
  let unreleased = 0;
  const anyTag = { ...filter, tagIds: [], untagged: false };
  const anySize = { ...filter, sizes: [], unsized: false };
  const anyProject = { ...filter, projectId: null };
  const anyRelation = { ...filter, relations: [] };
  const anyRelease = { ...filter, releaseIds: [], unreleased: false };
  const linked = data.relations;
  const shipped = data.releases;
  for (const task of data.tasks) {
    if (!subtasksAsCards && task.parentId !== null) continue;
    if (matchesFilter(data.project, task, anyTag, query, data)) {
      const assigned = cardTags(data.project, task);
      if (assigned.size === 0) untagged += 1;
      for (const id of assigned) tags.set(id, (tags.get(id) ?? 0) + 1);
    }
    if (matchesFilter(data.project, task, anySize, query, data))
      sizes.set(task.size, (sizes.get(task.size) ?? 0) + 1);
    if (task.projectId && matchesFilter(data.project, task, anyProject, query, data))
      projects.set(task.projectId, (projects.get(task.projectId) ?? 0) + 1);
    if (linked && matchesFilter(data.project, task, anyRelation, query, data))
      for (const relation of RELATION_FILTERS)
        if (hasRelation(task, relation, linked))
          relations.set(relation, (relations.get(relation) ?? 0) + 1);
    if (shipped && matchesFilter(data.project, task, anyRelease, query, data)) {
      if (shipped.unreleased.has(task.id)) unreleased += 1;
      for (const id of shipped.byTask.get(task.id) ?? [])
        releases.set(id, (releases.get(id) ?? 0) + 1);
    }
  }
  return { tags, untagged, sizes, projects, relations, releases, unreleased };
}

function time(at: string | undefined) {
  const value = at === undefined ? Number.NaN : Date.parse(at);
  return Number.isNaN(value) ? null : value;
}

function sortValue(task: Task, field: SortField): number | null {
  if (field === 'size') return task.size;
  return time(field === 'created' ? task.createdAt : (task.updatedAt ?? task.createdAt));
}

/**
 * A sort by one field: ascending or descending, tasks without the value (unsized, or not yet
 * stamped) last either way, and the board's own order (priority, then manual order) between
 * tasks that tie.
 */
export function compareByField(field: SortField, direction: SortDirection) {
  const sign = direction === 'asc' ? 1 : -1;
  return (a: Task, b: Task, tie: (a: Task, b: Task) => number = compareTasks) => {
    const [first, second] = [sortValue(a, field), sortValue(b, field)];
    if (first !== second) {
      if (first === null) return 1;
      if (second === null) return -1;
      return (first - second) * sign;
    }
    return tie(a, b);
  };
}

export function compareBySize(direction: SortDirection) {
  return compareByField('size', direction);
}

/** A sort's field as a sentence names it: "Sorted by size". */
export const SORT_FIELD_NAMES: Record<SortField, string> = {
  size: 'size',
  created: 'date added',
  updated: 'last update',
};

/** The field and direction of a sort, or null for the board's own order. */
export function sortOrder(sort: BoardSort) {
  if (sort === 'priority') return null;
  const [field, direction] = sort.split('-') as [SortField, SortDirection];
  return { field, direction };
}
