import { SIZES, type Size } from '@throw/shared';
import { normalizeSearch, type PreparedQuery, prepareQuery, rankMatch } from '@/lib/taskSearch';
import {
  type BoardData,
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
  projectId: null,
};

/** Anything beyond the query: what the filter button marks and the chips list. */
export function chosenFilters(filter: BoardFilter) {
  return (
    filter.tagIds.length +
    Number(filter.untagged) +
    filter.sizes.length +
    Number(filter.unsized) +
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
) {
  if (filter.projectId !== null && task.projectId !== filter.projectId) return false;
  if (!matchesSize(task, filter)) return false;
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
    if (!matchesFilter(data.project, task, filter, query)) continue;
    ids.add(task.id);
    if (!subtasksAsCards && task.parentId !== null) ids.add(task.parentId);
  }
  matched.set(data, { filter, subtasksAsCards, ids });
  return ids;
}

/**
 * The task Enter opens from the search: the best answer to the query among those that match
 * the filters, ranked as the palette ranks its results. Open work comes before closed work at
 * the same rank.
 */
export function bestMatch(data: BoardData, filter: BoardFilter, closed: (task: Task) => boolean) {
  const query = prepareQuery(filter.query);
  if (!query) return undefined;
  let best: { task: Task; rank: number } | undefined;
  for (const task of data.tasks) {
    if (!matchesFilter(data.project, task, { ...filter, query: '' }, null)) continue;
    const rank = queryRank(data.project, task, query);
    if (rank === null) continue;
    const score = rank * 2 + Number(closed(task));
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
};

/**
 * How many cards each choice would leave, given the rest of the filter: a tag's count is of
 * cards that match everything but the tags, a size's of those that match everything but the
 * sizes.
 */
export function facetCounts(
  data: BoardData,
  filter: BoardFilter,
  subtasksAsCards: boolean,
): FacetCounts {
  const query = prepareQuery(filter.query);
  const tags = new Map<string, number>();
  const sizes = new Map<Size | null, number>([...SIZES, null].map((size) => [size, 0]));
  let untagged = 0;
  const anyTag = { ...filter, tagIds: [], untagged: false };
  const anySize = { ...filter, sizes: [], unsized: false };
  for (const task of data.tasks) {
    if (!subtasksAsCards && task.parentId !== null) continue;
    if (matchesFilter(data.project, task, anyTag, query)) {
      const assigned = cardTags(data.project, task);
      if (assigned.size === 0) untagged += 1;
      for (const id of assigned) tags.set(id, (tags.get(id) ?? 0) + 1);
    }
    if (matchesFilter(data.project, task, anySize, query))
      sizes.set(task.size, (sizes.get(task.size) ?? 0) + 1);
  }
  return { tags, untagged, sizes };
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
