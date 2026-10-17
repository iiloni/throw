import { isTaskTrashed, type Project, type Status, type Task, taskIdentifier } from '@throw/shared';

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
  text: string;
};

/** Prepared only when collections change, never once per keystroke. Tag names plug in here. */
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
    indexed.push({
      task,
      project,
      status: statusById.get(task.statusId),
      identifier,
      title,
      text: normalizeSearch(
        [
          task.title,
          identifier ?? '',
          descriptionText(task.description),
          ...(tagNames.get(task.id) ?? []),
        ].join(' '),
      ),
    });
  }
  return indexed;
}

/** Exact identifiers, exact titles, title prefixes, all-title words, then body/tag matches. */
export function searchTasks(
  indexed: readonly IndexedTask[],
  query: string,
  { projectId = '', currentProjectId = '', limit = SEARCH_LIMIT } = {},
): IndexedTask[] {
  const normalized = normalizeSearch(query);
  if (!normalized) return [];
  const identifier = parseTaskIdentifier(query);
  const words = normalized.split(/\s+/);
  const results: { row: IndexedTask; rank: number }[] = [];
  for (const row of indexed) {
    if (projectId && row.project.id !== projectId) continue;
    const exactIdentifier =
      identifier &&
      row.task.number === identifier.number &&
      (identifier.key === null || row.project.key === identifier.key);
    if (!exactIdentifier && !words.every((word) => row.text.includes(word))) continue;
    const rank = exactIdentifier
      ? 0
      : row.title === normalized
        ? 1
        : row.title.startsWith(normalized)
          ? 2
          : words.every((word) => row.title.includes(word))
            ? 3
            : 4;
    results.push({ row, rank });
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
