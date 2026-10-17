import type { Project, Task } from '@throw/shared';
import { describe, expect, it } from 'vitest';
import {
  descriptionSnippet,
  descriptionText,
  highlight,
  indexTasks,
  parseTaskIdentifier,
  searchProjects,
  searchTasks,
} from './taskSearch';

const project: Project = {
  id: 'cat',
  workspaceId: 'workspace',
  name: 'Catch',
  key: 'CAT',
  icon: null,
  color: 'teal',
  deletedAt: null,
  position: 'a0',
  priorityNames: ['', '', '', '', ''],
};
const other: Project = { ...project, id: 'throw', name: 'Throw', key: 'THR' };
const task = (id: string, changes: Partial<Task> = {}): Task => ({
  id,
  workspaceId: 'workspace',
  projectId: project.id,
  number: 1,
  title: id,
  description: null,
  descriptionVersion: null,
  parentId: null,
  deletedAt: null,
  closedAt: null,
  createdAt: '2026-10-15T00:00:00Z',
  statusId: 'backlog',
  priority: 3,
  position: 'a0',
  ...changes,
});
const index = (tasks: Task[], projects = [project, other]) =>
  indexTasks(tasks, projects, [], 'workspace');
const ids = (rows: ReturnType<typeof searchTasks>) => rows.map((r) => r.task.id);

describe('identifier parsing', () => {
  it.each([
    ['CAT-12', 'CAT', 12],
    [' cat2-12 ', 'CAT2', 12],
    ['12', null, 12],
  ])('parses %s', (query, key, number) => {
    expect(parseTaskIdentifier(query as string)).toEqual({ key, number });
  });
  it.each([
    '0',
    '-12',
    'CAT-0',
    'CAT-01',
    '12cats',
    'CAT-12 more',
    '1234567-2',
    '9007199254740992',
    '1.2',
    'CAT 12',
  ])('rejects %s', (query) => {
    expect(parseTaskIdentifier(query)).toBeNull();
  });
});

it('reads nested BlockNote text, links and table cells without indexing ids, styles or URLs', () => {
  expect(
    descriptionText([
      {
        id: 'secret',
        props: { color: 'red' },
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'link', href: 'secret-url', content: [{ text: 'world' }] },
        ],
        children: [{ content: [{ text: 'child' }] }],
      },
      { content: { rows: [{ cells: [[{ text: 'cell' }]] }] } },
    ]),
  ).toBe('Hello world child cell');
});
it('scopes to a workspace, excludes inherited trash, includes closed tasks and subtasks', () => {
  const rows = index(
    [
      task('open'),
      task('closed', { closedAt: '2026-10-15T01:00:00Z' }),
      task('parent', { deletedAt: '2026-10-15T01:00:00Z' }),
      task('hidden-child', { parentId: 'parent' }),
      task('child', { parentId: 'open' }),
      task('foreign', { workspaceId: 'other' }),
      task('deleted-project', { projectId: 'deleted' }),
      task('foreign-project', { projectId: 'foreign' }),
    ],
    [
      project,
      { ...project, id: 'deleted', deletedAt: '2026-10-15T01:00:00Z' },
      { ...project, id: 'foreign', workspaceId: 'other' },
    ],
  );
  expect(rows.map((r) => r.task.id)).toEqual(['open', 'closed', 'child']);
});
it('matches literal, accent-insensitive words across title, description and assigned tag names', () => {
  const row = task('one', {
    title: 'Café release',
    description: [{ content: [{ text: 'Improve offline [sync]' }] }],
  });
  const rows = indexTasks([row], [project], [], 'workspace', new Map([['one', ['Engineering']]]));
  expect(ids(searchTasks(rows, 'CAFE engineering [sync]'))).toEqual(['one']);
  expect(searchTasks(rows, 'cafe missing')).toEqual([]);
  expect(searchTasks(rows, '.*')).toEqual([]);
});
it('ranks exact identifier, exact title, title prefix, all title words, then body matches', () => {
  const rows = index([
    task('body', { title: 'Other', description: [{ content: [{ text: 'CAT-12' }] }] }),
    task('all', { title: 'See CAT-12 now' }),
    task('prefix', { title: 'CAT-12 needs work' }),
    task('exact', { title: 'CAT-12' }),
    task('identifier', { number: 12, title: 'A task' }),
  ]);
  expect(ids(searchTasks(rows, 'cat-12'))).toEqual([
    'identifier',
    'exact',
    'prefix',
    'all',
    'body',
  ]);
});
it('disambiguates bare numbers with the current project first and a project filter', () => {
  const rows = index([
    task('cat', { number: 12 }),
    task('throw', { number: 12, projectId: other.id }),
    task('partial', { number: 123 }),
  ]);
  expect(ids(searchTasks(rows, '12', { currentProjectId: other.id }))).toEqual([
    'throw',
    'cat',
    'partial',
  ]);
  expect(ids(searchTasks(rows, '12', { projectId: other.id }))).toEqual(['throw']);
  expect(ids(searchTasks(rows, 'THR-12'))).toEqual(['throw']);
});
it('uses the current key and includes pending tasks by title without inventing identifiers', () => {
  const rows = index(
    [task('pending', { number: null, title: 'Offline task' })],
    [{ ...project, key: null }],
  );
  expect(searchTasks(rows, 'Offline')[0]?.identifier).toBeNull();
  expect(searchTasks(rows, 'CAT-1')).toEqual([]);
  const renamed = index([task('renamed')], [{ ...project, key: 'NEW' }]);
  expect(searchTasks(renamed, 'CAT-1')).toEqual([]);
  expect(ids(searchTasks(renamed, 'NEW-1'))).toEqual(['renamed']);
});
it('caps results and breaks ties deterministically regardless of input order', () => {
  const rows = index(
    Array.from({ length: 100 }, (_, i) => task(String(i).padStart(3, '0'), { title: 'Same' })),
  );
  expect(searchTasks(rows, '')).toEqual([]);
  expect(searchTasks(rows, 'same')).toHaveLength(30);
  expect(ids(searchTasks(rows, 'same'))).toEqual(ids(searchTasks([...rows].reverse(), 'same')));
});
it('finds projects by name and key with exact name first', () => {
  expect(
    searchProjects([{ ...project, name: 'Catch extras' }, project, other], 'Catch').map(
      (p) => p.name,
    ),
  ).toEqual(['Catch', 'Catch extras']);
  expect(searchProjects([project, other], 'THR')).toEqual([other]);
});

describe('highlighting', () => {
  const marked = (segments: { text: string; match: boolean }[]) =>
    segments.filter((segment) => segment.match).map((segment) => segment.text);

  it('marks every word wherever it appears, ignoring case and accents', () => {
    expect(marked(highlight('Café menu for the CAFE', 'cafe menu'))).toEqual([
      'Café',
      'menu',
      'CAFE',
    ]);
    expect(highlight('Plain', 'zzz')).toEqual([{ text: 'Plain', match: false }]);
    expect(highlight('', 'a')).toEqual([]);
  });

  it('keeps the original text intact around matches', () => {
    const segments = highlight('Ünïcode naïve text', 'naive');
    expect(segments.map((segment) => segment.text).join('')).toBe('Ünïcode naïve text');
    expect(marked(segments)).toEqual(['naïve']);
  });

  it('trims a long description around its first match', () => {
    const description = [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: `${'a '.repeat(60)}needle ${'b '.repeat(60)}` }],
      },
    ];
    const snippet = descriptionSnippet(description, 'needle');
    const text = snippet?.map((segment) => segment.text).join('') ?? '';
    expect(text.startsWith('…')).toBe(true);
    expect(text.endsWith('…')).toBe(true);
    expect(snippet && marked(snippet)).toEqual(['needle']);
    expect(descriptionSnippet(description, 'absent')).toBeNull();
  });
});
