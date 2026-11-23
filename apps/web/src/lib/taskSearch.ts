import {
  isTaskTrashed,
  type Project,
  type Status,
  type Tag,
  type Task,
  type TaskTag,
  tagPath,
  taskIdentifier,
} from '@throw/shared';

export const SEARCH_LIMIT = 30;

export function normalizeSearch(text: string) {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/** A whole identifier or number, never a numeric fragment of another task's number. */
export function parseTaskIdentifier(query: string): { key: string | null; number: number } | null {
  const match = /^(?:([a-z][a-z0-9]{0,5})-)?([1-9]\d*)$/i.exec(query.trim());
  if (!match) return null;
  const number = Number(match[2]);
  return Number.isSafeInteger(number) ? { key: match[1]?.toUpperCase() ?? null, number } : null;
}

/** Read BlockNote text and children, leaving formatting, URLs and block ids out of search. */
export function descriptionText(value: unknown): string {
  if (Array.isArray(value)) return value.map(descriptionText).join(' ');
  if (typeof value !== 'object' || value === null) return '';
  const block = value as Record<string, unknown>;
  return [
    typeof block.text === 'string' ? block.text : '',
    descriptionText(block.content),
    descriptionText(block.children),
    descriptionText(block.rows),
    descriptionText(block.cells),
  ]
    .filter(Boolean)
    .join(' ');
}

export type IndexedTask = {
  task: Task;
  project: Project;
  status: Status | undefined;
  identifier: string | null;
  title: string;
  /** Its tags' names, to show which one a search matched. */
  tags: readonly string[];
  text: string;
};

/**
 * Each task's tag names, primary and secondary, with their ancestors' names: a task tagged
 * Garden under Home is found by either. A tag that has not synced adds nothing.
 */
export function taskTagNames(
  tasks: readonly Task[],
  tags: readonly Tag[],
  assignments: readonly TaskTag[],
): Map<string, string[]> {
  const pathNames = new Map<string, string[]>();
  const namesOf = (tagId: string) => {
    let names = pathNames.get(tagId);
    if (!names) {
      names = tagPath(tags, tagId).map((tag) => tag.name);
      pathNames.set(tagId, names);
    }
    return names;
  };
  const tagIds = new Map<string, string[]>();
  for (const task of tasks) if (task.primaryTagId) tagIds.set(task.id, [task.primaryTagId]);
  for (const { taskId, tagId } of assignments) {
    const ids = tagIds.get(taskId);
    if (ids) ids.push(tagId);
    else tagIds.set(taskId, [tagId]);
  }
  const result = new Map<string, string[]>();
  for (const [taskId, ids] of tagIds) result.set(taskId, [...new Set(ids.flatMap(namesOf))]);
  return result;
}

/** Prepared only when collections change, never once per keystroke. */
export function indexTasks(
  tasks: readonly Task[],
  projects: readonly Project[],
  statuses: readonly Status[],
  workspaceId: string,
  tagNames: ReadonlyMap<string, readonly string[]> = new Map(),
): IndexedTask[] {
  const projectById = new Map(
    projects.filter((p) => p.workspaceId === workspaceId && !p.deletedAt).map((p) => [p.id, p]),
  );
  const parentById = new Map(tasks.map((t) => [t.id, t]));
  const statusById = new Map(statuses.map((s) => [s.id, s]));
  const indexed: IndexedTask[] = [];
  for (const task of tasks) {
    const project = projectById.get(task.projectId);
    if (
      !project ||
      task.workspaceId !== workspaceId ||
      isTaskTrashed(task, parentById.get(task.parentId ?? ''), project)
    )
      continue;
    const identifier = taskIdentifier(project, task);
    const title = normalizeSearch(task.title);
    const tags = tagNames.get(task.id) ?? [];
    indexed.push({
      task,
      project,
      status: statusById.get(task.statusId),
      identifier,
      title,
      tags,
      text: normalizeSearch(
        [task.title, identifier ?? '', descriptionText(task.description), ...tags].join(' '),
      ),
    });
  }
  return indexed;
}

/** A query as search compares it: its words, and the identifier it could be. */
export type PreparedQuery = {
  normalized: string;
  words: string[];
  identifier: { key: string | null; number: number } | null;
};

/** Null for a query with nothing to look for. */
export function prepareQuery(query: string): PreparedQuery | null {
  const normalized = normalizeSearch(query);
  if (!normalized) return null;
  return { normalized, words: normalized.split(/\s+/), identifier: parseTaskIdentifier(query) };
}

/**
 * How well a task answers a query, best first: its exact identifier, its exact title, a title
 * prefix, every word in the title, then words found across its text. Null when it does not.
 * `title` and `text` are normalized; `text` holds the title, identifier, description and tags.
 */
export function rankMatch(
  query: PreparedQuery,
  task: { number: number | null; key: string | null; title: string; text: string },
): number | null {
  const { identifier, normalized, words } = query;
  const exactIdentifier =
    identifier &&
    task.number === identifier.number &&
    (identifier.key === null || task.key === identifier.key);
  if (exactIdentifier) return 0;
  if (!words.every((word) => task.text.includes(word))) return null;
  return task.title === normalized
    ? 1
    : task.title.startsWith(normalized)
      ? 2
      : words.every((word) => task.title.includes(word))
        ? 3
        : 4;
}

/** Exact identifiers, exact titles, title prefixes, all-title words, then body/tag matches. */
export function searchTasks(
  indexed: readonly IndexedTask[],
  query: string,
  { projectId = '', currentProjectId = '', limit = SEARCH_LIMIT } = {},
): IndexedTask[] {
  const prepared = prepareQuery(query);
  if (!prepared) return [];
  const results: { row: IndexedTask; rank: number }[] = [];
  for (const row of indexed) {
    if (projectId && row.project.id !== projectId) continue;
    const rank = rankMatch(prepared, {
      number: row.task.number,
      key: row.project.key,
      title: row.title,
      text: row.text,
    });
    if (rank !== null) results.push({ row, rank });
  }
  results.sort(
    (a, b) =>
      a.rank - b.rank ||
      Number(b.row.project.id === currentProjectId) -
        Number(a.row.project.id === currentProjectId) ||
      a.row.project.name.localeCompare(b.row.project.name) ||
      a.row.title.localeCompare(b.row.title) ||
      a.row.task.id.localeCompare(b.row.task.id),
  );
  return results.slice(0, limit).map(({ row }) => row);
}

export function searchProjects(projects: readonly Project[], query: string): Project[] {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  return projects
    .filter(
      (project) =>
        !project.deletedAt &&
        words.every((word) =>
          normalizeSearch(`${project.name} ${project.key ?? ''}`).includes(word),
        ),
    )
    .sort(
      (a, b) =>
        Number(normalizeSearch(b.name) === normalizeSearch(query)) -
          Number(normalizeSearch(a.name) === normalizeSearch(query)) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 8);
}

/** The tag names a search matched, so a result found by its tag says so. */
export function matchedTags(tags: readonly string[], query: string) {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  return tags.filter((name) => {
    const normalized = normalizeSearch(name);
    return words.some((word) => normalized.includes(word));
  });
}

export type Segment = { text: string; match: boolean };

/**
 * Splits text into matched and unmatched runs for highlighting, matching the way search does:
 * ignoring case and accents, so "cafe" marks "Café" whole.
 */
export function highlight(text: string, query: string): Segment[] {
  if (!text) return [];
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  // The normalized text, and for each of its characters the original one it came from.
  let normalized = '';
  const origin: number[] = [];
  for (let index = 0; index < text.length; ) {
    const char = String.fromCodePoint(text.codePointAt(index) ?? 0);
    const folded = char.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
    for (let k = 0; k < folded.length; k++) origin.push(index);
    normalized += folded;
    index += char.length;
  }
  origin.push(text.length);
  const marked = new Uint8Array(text.length);
  for (const word of words) {
    for (let at = normalized.indexOf(word); at >= 0; at = normalized.indexOf(word, at + 1)) {
      const end = origin[at + word.length] ?? text.length;
      for (let i = origin[at] ?? 0; i < end; i++) marked[i] = 1;
    }
  }
  const segments: Segment[] = [];
  for (let i = 0; i < text.length; i++) {
    const match = marked[i] === 1;
    const last = segments.at(-1);
    if (last && last.match === match) last.text += text[i];
    else segments.push({ text: text[i] ?? '', match });
  }
  return segments;
}

const SNIPPET_CONTEXT = 40;

/** The description around its first match, or null when the match is not in it. */
export function descriptionSnippet(description: unknown, query: string): Segment[] | null {
  const text = descriptionText(description).replace(/\s+/g, ' ').trim();
  const segments = highlight(text, query);
  const first = segments.findIndex((segment) => segment.match);
  if (first < 0) return null;
  const at = segments.slice(0, first).reduce((sum, segment) => sum + segment.text.length, 0);
  const start = Math.max(0, at - SNIPPET_CONTEXT);
  const end = Math.min(text.length, at + SNIPPET_CONTEXT * 2);
  if (start === 0 && end === text.length) return segments;
  return highlight(
    `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`,
    query,
  );
}
