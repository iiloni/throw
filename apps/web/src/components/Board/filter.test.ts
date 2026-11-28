import type { GithubRelease, Project, Status, Tag, Task, TaskRelation } from '@throw/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { boardReleases } from '@/lib/githubReleases';
import { boardRelations } from './blockers';
import { carryAcross, carryVertically, pickUp, setDown } from './carry';
import {
  type BoardFilter,
  bestMatch,
  chosenFilters,
  compareByField,
  compareBySize,
  EMPTY_FILTER,
  facetCounts,
  hasRelation,
  matchesSize,
  matchesTags,
  matchingIds,
} from './filter';
import { projectBoardData, secondaryTagsByTask, updatedAtByTask } from './selection';
import {
  activeFilterCount,
  type BoardActions,
  board,
  clearFilters,
  closeSearch,
  collapseSearch,
  countIn,
  current,
  initialBoard,
  listTasks,
  narrowed,
  placeInList,
  receiveBoard,
  setFilter,
  setSort,
  shownTasks,
  update,
} from './state';

const project: Project = {
  id: 'project',
  workspaceId: 'workspace',
  name: 'Board',
  key: 'BRD',
  color: 'teal',
  icon: null,
  position: 'a0',
  priorityNames: ['', '', '', '', ''],
  deletedAt: null,
};
const status = (id: string, category: Status['category'], position = 'a0'): Status => ({
  id,
  category,
  name: id,
  projectId: project.id,
  workspaceId: project.workspaceId,
  position,
  isDefault: true,
});
const statuses = [
  status('backlog', 'backlog'),
  status('build', 'active'),
  status('review', 'active', 'a1'),
  status('done', 'done'),
];
const tag = (id: string, parentId: string | null = null): Tag => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  parentId,
  projectId: project.id,
  workspaceId: project.workspaceId,
  icon: null,
  color: parentId ? null : 'teal',
  position: 'a0',
});
// Home > Garden, and Work on its own.
const tags = [tag('home'), tag('garden', 'home'), tag('work')];
let number = 0;
const task = (id: string, edit: Partial<Task> = {}): Task => ({
  id,
  projectId: project.id,
  workspaceId: project.workspaceId,
  number: ++number,
  title: id,
  description: null,
  descriptionVersion: null,
  statusId: 'build',
  priority: 3,
  size: null,
  position: 'a0',
  parentId: null,
  primaryTagId: null,
  closedAt: null,
  deletedAt: null,
  createdAt: '2026-10-14T12:00:00Z',
  ...edit,
});

const rows = [
  task('weed beds', { primaryTagId: 'garden', size: 2, position: 'a1' }),
  task('paint fence', { primaryTagId: 'home', size: 4, position: 'a2' }),
  task('write report', {
    primaryTagId: 'work',
    size: 5,
    priority: 2,
    description: [{ type: 'paragraph', content: [{ type: 'text', text: 'quarterly numbers' }] }],
  }),
  task('tidy desk', { size: null, position: 'a3' }),
  task('plan garden office', { primaryTagId: 'work', size: 1, position: 'a4' }),
  task('order seeds', { size: 3, parentId: 'weed beds', statusId: 'review' }),
];
// Plan garden office is tagged Work and Garden, its second tag a secondary one.
const assignments = [
  {
    taskId: 'plan garden office',
    tagId: 'garden',
    projectId: project.id,
    workspaceId: 'workspace',
  },
];

function data(subtasks = rows) {
  return projectBoardData(project, statuses, subtasks, tags, secondaryTagsByTask(assignments));
}
const filter = (edit: Partial<BoardFilter>): BoardFilter => ({ ...EMPTY_FILTER, ...edit });
const shown = (edit: Partial<BoardFilter>, subtasksAsCards = false) =>
  [...(matchingIds(data(), filter(edit), subtasksAsCards) ?? [])].sort();

describe('filter matching', () => {
  it('shows everything when nothing is chosen', () => {
    expect(matchingIds(data(), EMPTY_FILTER, false)).toBeNull();
  });

  it('finds a tag on the card itself or on a tag below it, primary or secondary', () => {
    expect(shown({ tagIds: ['garden'] }, true)).toEqual(['plan garden office', 'weed beds']);
    // Home covers Garden beneath it.
    expect(shown({ tagIds: ['home'] }, true)).toEqual([
      'paint fence',
      'plan garden office',
      'weed beds',
    ]);
  });

  it('matches any of several tags, or all of them', () => {
    expect(shown({ tagIds: ['garden', 'work'], match: 'any' }, true)).toEqual([
      'plan garden office',
      'weed beds',
      'write report',
    ]);
    expect(shown({ tagIds: ['garden', 'work'], match: 'all' }, true)).toEqual([
      'plan garden office',
    ]);
    // A parent and its child: everything under Garden is under Home too.
    expect(shown({ tagIds: ['home', 'garden'], match: 'all' }, true)).toEqual([
      'plan garden office',
      'weed beds',
    ]);
  });

  it('finds untagged cards alone', () => {
    expect(shown({ untagged: true }, true)).toEqual(['order seeds', 'tidy desk']);
    expect(matchesTags(new Set(), filter({ untagged: true, tagIds: ['home'] }))).toBe(true);
    expect(matchesTags(new Set(['home']), filter({ untagged: true }))).toBe(false);
  });

  it('matches any of several sizes, and unsized cards', () => {
    expect(shown({ sizes: [1, 5] }, true)).toEqual(['plan garden office', 'write report']);
    expect(shown({ unsized: true }, true)).toEqual(['tidy desk']);
    expect(shown({ sizes: [4], unsized: true }, true)).toEqual(['paint fence', 'tidy desk']);
    expect(matchesSize({ size: null }, filter({ sizes: [3] }))).toBe(false);
  });

  it('combines the words with every other choice', () => {
    // Literal words across the title, identifier, description and tag names, with ancestors.
    expect(shown({ query: 'quarterly' }, true)).toEqual(['write report']);
    expect(shown({ query: 'home' }, true)).toEqual([
      'paint fence',
      'plan garden office',
      'weed beds',
    ]);
    expect(shown({ query: 'garden', sizes: [2] }, true)).toEqual(['weed beds']);
    expect(shown({ query: 'garden', tagIds: ['work'] }, true)).toEqual(['plan garden office']);
    expect(shown({ query: 'BRD-3' }, true)).toEqual(['write report']);
    expect(shown({ query: 'nothing like it' }, true)).toEqual([]);
  });

  it('keeps a parent card on the board when only its subtask matches', () => {
    expect(shown({ sizes: [3] }, false)).toEqual(['order seeds', 'weed beds']);
    expect(shown({ sizes: [3] }, true)).toEqual(['order seeds']);
  });

  it('ranks the match Enter opens as search does', () => {
    const board = data();
    const open = () => false;
    expect(bestMatch(board, filter({ query: 'garden' }), open)?.id).toBe('plan garden office');
    expect(bestMatch(board, filter({ query: '1' }), open)?.title).toBe('weed beds');
    // Only among what the filters leave.
    expect(bestMatch(board, filter({ query: 'garden', sizes: [2] }), open)?.id).toBe('weed beds');
    expect(bestMatch(board, filter({ sizes: [2] }), open)).toBeUndefined();
  });

  it('opens open work before a closed task that answers better, unless named by identifier', () => {
    const board = data();
    const closed = (task: { id: string }) => task.id === 'plan garden office';
    // Its title holds the word, Weed beds only its tag; still Weed beds comes first.
    expect(bestMatch(board, filter({ query: 'garden' }), closed)?.id).toBe('weed beds');
    // Its identifier names it, closed or not.
    expect(bestMatch(board, filter({ query: 'BRD-5' }), closed)?.id).toBe('plan garden office');
    // With nothing open matching, the closed task is still the answer.
    expect(bestMatch(board, filter({ query: 'office' }), closed)?.id).toBe('plan garden office');
  });

  it('counts what each tag or size would leave, given the rest', () => {
    const counts = facetCounts(data(), filter({ sizes: [2], tagIds: ['work'] }), false);
    // Tags count cards of the chosen size; sizes count cards with the chosen tag.
    expect(counts.tags.get('garden')).toBe(1);
    expect(counts.tags.get('work')).toBeUndefined();
    expect(counts.sizes.get(5)).toBe(1);
    expect(counts.sizes.get(1)).toBe(1);
    expect(counts.sizes.get(2)).toBe(0);
    // Tidy desk, and Weed beds for its untagged subtask Order seeds, which Untagged keeps.
    expect(facetCounts(data(), EMPTY_FILTER, false).untagged).toBe(2);
    expect(shown({ untagged: true })).toEqual(['order seeds', 'tidy desk', 'weed beds']);
    expect(facetCounts(data(), EMPTY_FILTER, true).untagged).toBe(2);
  });
});

describe('relation filters', () => {
  const closedAt = '2026-10-15T09:00:00Z';
  const linkedRows = [
    ...rows,
    task('ship it', { statusId: 'done', closedAt }),
    task('binned', { deletedAt: closedAt }),
  ];
  const link = (
    sourceTaskId: string,
    kind: TaskRelation['kind'],
    targetTaskId: string,
  ): Pick<TaskRelation, 'sourceTaskId' | 'targetTaskId' | 'kind'> => ({
    sourceTaskId,
    targetTaskId,
    kind,
  });
  // Open blockers as `blockersByTask` gives them: closed and trashed blockers are already out.
  const blockers = new Map([
    // Paint fence blocks Weed beds.
    ['weed beds', [{ id: 'paint fence' }]],
    // Tidy desk blocks Ship it, which is closed: no badge, and so nothing blocking.
    ['ship it', [{ id: 'tidy desk' }]],
    // The subtask Order seeds blocks Write report.
    ['write report', [{ id: 'order seeds' }]],
    ['plan garden office', []],
  ]);
  const relations = [
    link('paint fence', 'blocks', 'weed beds'),
    link('tidy desk', 'blocks', 'ship it'),
    link('order seeds', 'blocks', 'write report'),
    link('ship it', 'duplicates', 'plan garden office'),
    link('binned', 'duplicates', 'paint fence'),
    link('tidy desk', 'relates_to', 'paint fence'),
  ];
  const linked = boardRelations(blockers, relations, linkedRows, [project]);
  const linkedData = () => ({
    ...projectBoardData(project, statuses, linkedRows, tags, secondaryTagsByTask(assignments)),
    relations: linked,
  });
  const shownLinked = (edit: Partial<BoardFilter>, subtasksAsCards = true) =>
    [...(matchingIds(linkedData(), filter(edit), subtasksAsCards) ?? [])].sort();

  it('derives blocked, blocking and duplicate tasks from open blockers and live links', () => {
    expect([...linked.blocked].sort()).toEqual(['ship it', 'weed beds', 'write report']);
    // A blocker of a closed task blocks nothing.
    expect([...linked.blocking].sort()).toEqual(['order seeds', 'paint fence']);
    // A closed duplicate counts; one in the trash does not mark its other end.
    expect([...linked.duplicates].sort()).toEqual(['binned', 'plan garden office', 'ship it']);
  });

  it('treats a blocked task in the trash as blocking nothing', () => {
    const gone = boardRelations(new Map([['binned', [{ id: 'tidy desk' }]]]), [], linkedRows, [
      project,
    ]);
    expect([...gone.blocking]).toEqual([]);
  });

  it('finds blocked cards as their badge does, leaving out closed ones', () => {
    expect(shownLinked({ relations: ['blocked'] })).toEqual(['weed beds', 'write report']);
    const shipIt = linkedData().tasks.find((item) => item.id === 'ship it')!;
    expect(hasRelation(shipIt, 'blocked', linked)).toBe(false);
  });

  it('finds blocking cards and duplicates', () => {
    expect(shownLinked({ relations: ['blocking'] })).toEqual(['order seeds', 'paint fence']);
    expect(shownLinked({ relations: ['duplicates'] })).toEqual(['plan garden office', 'ship it']);
  });

  it('matches any of several relations, together with the other filters', () => {
    expect(shownLinked({ relations: ['blocked', 'blocking'] })).toEqual([
      'order seeds',
      'paint fence',
      'weed beds',
      'write report',
    ]);
    expect(shownLinked({ relations: ['blocked', 'blocking'], sizes: [4] })).toEqual([
      'paint fence',
    ]);
    expect(shownLinked({ relations: ['duplicates'], query: 'office' })).toEqual([
      'plan garden office',
    ]);
    expect(shownLinked({ relations: ['blocked'], tagIds: ['work'] })).toEqual(['write report']);
  });

  it('keeps a parent card on the board when only its subtask has the relation', () => {
    expect(shownLinked({ relations: ['blocking'] }, false)).toEqual([
      'order seeds',
      'paint fence',
      'weed beds',
    ]);
  });

  it('counts a parent card once for its tucked subtasks, as the board keeps it', () => {
    // Weed beds stands for Order seeds, which blocks Write report.
    expect(Object.fromEntries(facetCounts(linkedData(), EMPTY_FILTER, false).relations)).toEqual({
      blocked: 2,
      blocking: 2,
      duplicates: 2,
    });
    // Order seeds blocked too: Weed beds, blocked itself, is still one card.
    const both = boardRelations(
      new Map([
        ['weed beds', [{ id: 'paint fence' }]],
        ['order seeds', [{ id: 'tidy desk' }]],
      ]),
      [],
      linkedRows,
      [project],
    );
    const bothData = { ...linkedData(), relations: both };
    expect(facetCounts(bothData, EMPTY_FILTER, false).relations.get('blocked')).toBe(1);
    expect(facetCounts(bothData, EMPTY_FILTER, true).relations.get('blocked')).toBe(2);
    expect(
      [...(matchingIds(bothData, filter({ relations: ['blocked'] }), false) ?? [])].sort(),
    ).toEqual(['order seeds', 'weed beds']);
  });

  it('finds nothing on a board without relations, as the prototype is', () => {
    expect(shown({ relations: ['blocked'] }, true)).toEqual([]);
    expect([...facetCounts(data(), EMPTY_FILTER, true).relations.values()]).toEqual([0, 0, 0]);
  });

  it('counts what each relation would leave, given the rest', () => {
    const counts = facetCounts(linkedData(), filter({ relations: ['duplicates'] }), true);
    expect(Object.fromEntries(counts.relations)).toEqual({
      blocked: 2,
      blocking: 2,
      duplicates: 2,
    });
    // Sizes count only the duplicates.
    expect(counts.sizes.get(1)).toBe(1);
    expect(counts.sizes.get(null)).toBe(1);
    expect(counts.sizes.get(4)).toBe(0);
    const sized = facetCounts(linkedData(), filter({ sizes: [4] }), true);
    expect(Object.fromEntries(sized.relations)).toEqual({
      blocked: 0,
      blocking: 1,
      duplicates: 0,
    });
  });

  it('opens the best match among the chosen relations', () => {
    const open = () => false;
    expect(
      bestMatch(linkedData(), filter({ query: 'garden', relations: ['blocked'] }), open)?.id,
    ).toBe('weed beds');
  });

  it('counts each chosen relation as a filter, and clears them all', () => {
    expect(chosenFilters(filter({ relations: ['blocked', 'duplicates'] }))).toBe(2);
    board.set(initialBoard());
    receiveBoard(linkedData(), { rename: () => {}, place: () => true, send: () => true });
    setFilter({ relations: ['blocking'] });
    expect(narrowed(board.get())).toBe(true);
    expect(activeFilterCount(board.get())).toBe(1);
    // Paint fence, and Weed beds for its blocking subtask tucked under it.
    expect(countIn(board.get(), 'build')).toBe(2);
    clearFilters();
    expect(board.get().filter.relations).toEqual([]);
  });
});

const release = (
  id: string,
  tagName: string,
  edit: Partial<GithubRelease> = {},
): GithubRelease => ({
  id,
  workspaceId: 'workspace',
  projectId: project.id,
  repo: 'org/repo',
  tagName,
  name: null,
  url: `https://github.com/org/repo/releases/tag/${tagName}`,
  targetCommitish: null,
  source: 'release',
  isDraft: false,
  isPrerelease: false,
  publishedAt: '2026-11-01T00:00:00.000Z',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...edit,
});
const releases = [
  release('r1', 'v0.1.0'),
  release('r2', 'v0.2.0', { publishedAt: '2026-11-10T00:00:00.000Z' }),
  release('r3', 'v0.3.0', { isDraft: true, publishedAt: null }),
  release('r4', 'v9.9.9'),
];
const bind = (taskId: string, releaseId: string) => ({ taskId, releaseId });
const merged = (
  taskId: string,
  state: 'merged' | 'open' = 'merged',
  kind: 'pr' | 'issue' = 'pr',
) => ({
  taskId,
  kind,
  state,
});
/**
 * Weed beds shipped in v0.1.0; Paint fence in v0.2.0. Write report merged and sits in the
 * v0.3.0 draft, so it waits still; Tidy desk merged with no release; Order seeds is open work.
 * Plan garden office's closed issue says nothing about releases. Nothing is bound to v9.9.9.
 */
function releasedData() {
  const own = data();
  return {
    ...own,
    releases: boardReleases(
      own.tasks.map((row) => row.id),
      releases,
      [bind('weed beds', 'r1'), bind('paint fence', 'r2'), bind('write report', 'r3')],
      [
        merged('weed beds'),
        merged('write report'),
        merged('tidy desk'),
        merged('order seeds', 'open'),
        merged('plan garden office', 'merged', 'issue'),
      ],
    ),
  };
}
const shownReleased = (edit: Partial<BoardFilter>, subtasksAsCards = true) =>
  [...(matchingIds(releasedData(), filter(edit), subtasksAsCards) ?? [])].sort();

describe('release filter', () => {
  it('lists the releases holding the board’s tasks, newest first, unpublished last', () => {
    expect(releasedData().releases?.releases.map((row) => row.tagName)).toEqual([
      'v0.2.0',
      'v0.1.0',
      'v0.3.0',
    ]);
  });

  it('has nothing to choose without releases or merged pull requests, as the prototype', () => {
    const own = data();
    const ids = own.tasks.map((row) => row.id);
    expect(boardReleases(ids, releases, [], [merged('tidy desk', 'open')])).toBeUndefined();
    expect(boardReleases(ids, releases, [bind('elsewhere', 'r1')], [])).toBeUndefined();
    expect(shown({ unreleased: true }, true)).toEqual([]);
    expect(shown({ releaseIds: ['r1'] }, true)).toEqual([]);
  });

  it('finds merged work that no shipped release holds, as MCP’s unreleased does', () => {
    expect(shownReleased({ unreleased: true })).toEqual(['tidy desk', 'write report']);
  });

  it('matches any chosen release, or Unreleased beside them, with the other filters', () => {
    expect(shownReleased({ releaseIds: ['r1'] })).toEqual(['weed beds']);
    expect(shownReleased({ releaseIds: ['r1', 'r2'] })).toEqual(['paint fence', 'weed beds']);
    expect(shownReleased({ releaseIds: ['r2'], unreleased: true })).toEqual([
      'paint fence',
      'tidy desk',
      'write report',
    ]);
    expect(shownReleased({ unreleased: true, sizes: [5] })).toEqual(['write report']);
  });

  it('keeps a parent card on the board when only its subtask is in the release', () => {
    const own = data();
    const withSubtask = {
      ...own,
      releases: boardReleases(
        own.tasks.map((row) => row.id),
        releases,
        [bind('order seeds', 'r2')],
        [],
      ),
    };
    expect(
      [...(matchingIds(withSubtask, filter({ releaseIds: ['r2'] }), false) ?? [])].sort(),
    ).toEqual(['order seeds', 'weed beds']);
  });

  it('counts what each release and Unreleased would leave, given the rest', () => {
    const counts = facetCounts(releasedData(), filter({ sizes: [2, 4], releaseIds: ['r1'] }), true);
    expect(Object.fromEntries(counts.releases)).toEqual({ r1: 1, r2: 1 });
    expect(counts.unreleased).toBe(0);
    // Sizes count only what v0.1.0 holds.
    expect(counts.sizes.get(2)).toBe(1);
    expect(counts.sizes.get(4)).toBe(0);
    expect(facetCounts(releasedData(), EMPTY_FILTER, true).unreleased).toBe(2);
  });

  it('counts each chosen release as a filter, and clears them', () => {
    expect(chosenFilters(filter({ releaseIds: ['r1', 'r2'], unreleased: true }))).toBe(3);
    board.set(initialBoard());
    receiveBoard(releasedData(), { rename: () => {}, place: () => true, send: () => true });
    setFilter({ unreleased: true });
    expect(narrowed(board.get())).toBe(true);
    expect(activeFilterCount(board.get())).toBe(1);
    expect(countIn(board.get(), 'build')).toBe(2);
    clearFilters();
    expect(board.get().filter).toMatchObject({ releaseIds: [], unreleased: false });
  });
});

describe('size sort', () => {
  const card = (id: string, size: Task['size'], priority: Task['priority'], position = 'a0') =>
    current({
      ...initialBoard([data([task(id, { size, priority, position })])]),
    }).tasks[0]!;
  const cards = [
    card('m-low', 3, 4),
    card('none', null, 1),
    card('s', 2, 3),
    card('m-high', 3, 1),
    card('xl', 5, 5),
    card('m-high-later', 3, 1, 'a5'),
  ];

  it('puts the smallest or the largest first, unsized last either way, then the board order', () => {
    const ids = (direction: 'asc' | 'desc') =>
      [...cards].sort((a, b) => compareBySize(direction)(a, b)).map((item) => item.id);
    expect(ids('asc')).toEqual(['s', 'm-high', 'm-high-later', 'm-low', 'xl', 'none']);
    expect(ids('desc')).toEqual(['xl', 'm-high', 'm-high-later', 'm-low', 's', 'none']);
  });
});

describe('time sorts', () => {
  const at = (minute: number) => `2026-10-14T12:${String(minute).padStart(2, '0')}:00.000Z`;
  const card = (id: string, createdAt: string | undefined, updatedAt?: string) => ({
    ...current(initialBoard([data([task(id)])])).tasks[0]!,
    createdAt,
    updatedAt,
  });
  const cards = [
    card('first', at(1), at(9)),
    card('second', at(2), at(3)),
    card('third', at(3)),
    card('unstamped', undefined),
  ];
  const ids = (field: 'created' | 'updated', direction: 'asc' | 'desc') =>
    [...cards].sort((a, b) => compareByField(field, direction)(a, b)).map((item) => item.id);

  it('orders by when a task was added, with no date last', () => {
    expect(ids('created', 'desc')).toEqual(['third', 'second', 'first', 'unstamped']);
    expect(ids('created', 'asc')).toEqual(['first', 'second', 'third', 'unstamped']);
  });

  it('orders by its last change, or by when it was added before any', () => {
    expect(ids('updated', 'desc')).toEqual(['first', 'second', 'third', 'unstamped']);
  });

  it('finds each task’s last change in its log, leaving out refused writes', () => {
    const entry = (taskId: string, minute: number, applied: boolean, kind = 'updated') => ({
      id: `${taskId}-${minute}`,
      workspaceId: 'workspace',
      projectId: project.id,
      taskId,
      userId: null,
      kind: kind as 'created' | 'updated',
      changes: [{ field: 'title' as const, previous: 'a', requested: 'b', applied }],
      createdAt: at(minute),
    });
    const latest = updatedAtByTask([
      entry('a', 1, false, 'created'),
      entry('a', 5, true),
      entry('a', 7, false),
      entry('b', 2, false, 'created'),
    ]);
    expect(latest.get('a')).toBe(at(5));
    expect(latest.get('b')).toBe(at(2));
    expect(latest.has('c')).toBe(false);
  });
});

describe('a narrowed board', () => {
  let actions: BoardActions & { place: ReturnType<typeof vi.fn<BoardActions['place']>> };
  beforeEach(() => {
    board.set(initialBoard());
    actions = { rename: () => {}, place: vi.fn(() => true), send: vi.fn(() => true) };
    receiveBoard(data(), actions);
  });
  const ids = (listId: Parameters<typeof listTasks>[1]) =>
    listTasks(board.get(), listId).map((item) => item.id);

  it('lists and counts only what matches, with the count a folded strip shows', () => {
    expect(countIn(board.get(), 'build')).toBe(5);
    setFilter({ tagIds: ['home'] });
    expect(ids('status:build')).toEqual(['weed beds', 'paint fence', 'plan garden office']);
    expect(countIn(board.get(), 'build')).toBe(3);
    expect(narrowed(board.get())).toBe(true);
    clearFilters();
    expect(countIn(board.get(), 'build')).toBe(5);
  });

  it('lists everything it shows column by column, for the phone’s search', () => {
    update({ subtasksAsCards: true });
    setFilter({ sizes: [3, 4, 5] });
    expect(shownTasks(board.get()).map((item) => item.id)).toEqual([
      'write report',
      'paint fence',
      'order seeds',
    ]);
    setSort('size-asc');
    expect(shownTasks(board.get()).map((item) => item.id)).toEqual([
      'paint fence',
      'write report',
      'order seeds',
    ]);
  });

  it('orders the columns by size while sorted, and the closed zone by time still', () => {
    setSort('size-desc');
    expect(ids('status:build')).toEqual([
      'write report',
      'paint fence',
      'weed beds',
      'plan garden office',
      'tidy desk',
    ]);
    setSort('priority');
    expect(ids('status:build')).toEqual([
      'write report',
      'weed beds',
      'paint fence',
      'tidy desk',
      'plan garden office',
    ]);
  });

  it('places nothing in a column sorted by size, so no position is worked out from it', () => {
    setSort('size-asc');
    expect(placeInList('tidy desk', 'status:build', 3, 0)).toBeNull();
  });

  it('carries a card across statuses but not within a column while sorted by size', () => {
    setSort('size-asc');
    pickUp('tidy desk');
    carryVertically(-1);
    expect(board.get().announcement).toMatch(/Sorted by size/);
    expect(board.get().carrying?.preview.statusId).toBe('build');
    carryAcross(1);
    expect(board.get().carrying?.preview.statusId).toBe('review');
    setDown();
    expect(actions.place).toHaveBeenCalledWith(
      'tidy desk',
      expect.objectContaining({ statusId: 'review', priority: 3 }),
    );
  });

  it('closing the search clears it, its filters and the sort', () => {
    update({ searching: true });
    setFilter({ query: 'garden', sizes: [1] });
    setSort('size-asc');
    closeSearch();
    expect(board.get()).toMatchObject({ searching: false, filter: EMPTY_FILTER, sort: 'priority' });
  });

  it('collapsing the search hides it while keeping the query, filters and sort', () => {
    update({ searching: true });
    setFilter({ query: 'garden', tagIds: ['home'], sizes: [1] });
    setSort('size-asc');
    expect(activeFilterCount(board.get())).toBe(4);

    collapseSearch();
    expect(board.get()).toMatchObject({
      searching: false,
      filter: { query: 'garden', tagIds: ['home'], sizes: [1] },
      sort: 'size-asc',
    });
    expect(narrowed(board.get())).toBe(true);
    expect(activeFilterCount(board.get())).toBe(4);
  });

  it('counts active search criteria consistently with narrowed()', () => {
    expect(activeFilterCount(board.get())).toBe(0);
    expect(narrowed(board.get())).toBe(false);

    setFilter({ query: '   ' });
    expect(activeFilterCount(board.get())).toBe(0);
    expect(narrowed(board.get())).toBe(false);

    setFilter({ query: 'weed', tagIds: ['home', 'work'], sizes: [2], unsized: true });
    setSort('updated-desc');
    expect(activeFilterCount(board.get())).toBe(6);
    expect(narrowed(board.get())).toBe(true);

    setFilter({ query: '', tagIds: [], untagged: true, sizes: [], unsized: false, projectId: 'p' });
    setSort('priority');
    expect(activeFilterCount(board.get())).toBe(2);
    expect(narrowed(board.get())).toBe(true);
  });

  it('starts every board unfiltered in its own order', () => {
    setFilter({ sizes: [1] });
    setSort('size-desc');
    receiveBoard({ ...data(), project: { ...data().project, id: 'other' } }, actions);
    expect(board.get()).toMatchObject({ filter: EMPTY_FILTER, sort: 'priority' });
  });
});
