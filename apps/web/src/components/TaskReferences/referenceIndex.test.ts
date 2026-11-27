import type { Project, Status, Tag, Task, TaskRelation, TaskTag } from '@throw/shared';
import { describe, expect, it, vi } from 'vitest';
import { buildReferenceIndex, type ReferenceSources } from './referenceIndex';

vi.mock('@/lib/collections', () => ({}));

const project = (id: string, key: string | null, extra: Partial<Project> = {}): Project => ({
  id,
  workspaceId: 'workspace',
  name: id,
  color: 'teal',
  icon: null,
  position: 'a0',
  key,
  priorityNames: ['', 'Soon', '', '', ''],
  deletedAt: null,
  ...extra,
});
const status = (id: string, projectId: string, category: Status['category']): Status => ({
  id,
  workspaceId: 'workspace',
  projectId,
  name: id,
  category,
  position: 'a0',
  isDefault: true,
});
const task = (id: string, projectId: string, number: number | null, extra: Partial<Task> = {}) =>
  ({
    id,
    workspaceId: 'workspace',
    projectId,
    number,
    title: `Task ${id}`,
    description: null,
    descriptionVersion: null,
    statusId: `${projectId}-open`,
    priority: 3,
    size: null,
    position: 'a0',
    parentId: null,
    primaryTagId: null,
    closedAt: null,
    deletedAt: null,
    createdAt: '2026-11-22T00:00:00.000Z',
    ...extra,
  }) satisfies Task;
const tag = (id: string, projectId: string): Tag => ({
  id,
  workspaceId: 'workspace',
  projectId,
  parentId: null,
  name: id,
  icon: null,
  color: null,
  position: 'a0',
});

function sources(extra: Partial<ReferenceSources> = {}): ReferenceSources {
  return {
    projects: [
      project('app', 'THR'),
      project('notes', 'CAT'),
      project('gone', 'OLD', { deletedAt: '2026-11-22T00:00:00.000Z' }),
      project('elsewhere', 'FAR', { workspaceId: 'other' }),
    ],
    statuses: [
      status('app-open', 'app', 'active'),
      status('app-done', 'app', 'done'),
      status('notes-open', 'notes', 'backlog'),
    ],
    tasks: [
      task('me', 'app', 1),
      task('next', 'app', 2, { title: 'Write the docs' }),
      task('done', 'app', 3, { statusId: 'app-done' }),
      task('trashed', 'app', 4, { deletedAt: '2026-11-22T00:00:00.000Z' }),
      task('under-trashed', 'app', 5, { parentId: 'trashed' }),
      task('offline', 'app', null),
      task('dock', 'notes', 7, { title: 'Port the dock' }),
      task('old', 'gone', 1),
      task('far', 'elsewhere', 1, { workspaceId: 'other' }),
    ],
    tags: [],
    taskTags: [],
    relations: [],
    ...extra,
  };
}

describe('resolving references', () => {
  const index = buildReferenceIndex(sources());

  it('finds a task of any project in the workspace by its key and number', () => {
    expect(index.resolve('workspace', 'THR-2')?.task.id).toBe('next');
    expect(index.resolve('workspace', 'CAT-7')).toMatchObject({
      identifier: 'CAT-7',
      project: { id: 'notes' },
      status: { category: 'backlog' },
      closed: false,
    });
  });

  it('reads any case', () => {
    expect(index.resolve('workspace', 'thr-2')?.task.id).toBe('next');
  });

  it('marks closed work', () => {
    expect(index.resolve('workspace', 'THR-3')?.closed).toBe(true);
  });

  it('leaves unknown, trashed, numberless and other workspaces’ tasks unresolved', () => {
    expect(index.resolve('workspace', 'THR-99')).toBeUndefined();
    expect(index.resolve('workspace', 'NOPE-1')).toBeUndefined();
    expect(index.resolve('workspace', 'THR-4')).toBeUndefined();
    expect(index.resolve('workspace', 'THR-5')).toBeUndefined();
    expect(index.resolve('workspace', 'OLD-1')).toBeUndefined();
    expect(index.resolve('workspace', 'FAR-1')).toBeUndefined();
    expect(index.resolve('other', 'FAR-1')?.task.id).toBe('far');
  });
});

describe('suggesting tasks after #', () => {
  const index = buildReferenceIndex(sources());
  const suggest = (query: string) =>
    index
      .suggest('workspace', query, { currentProjectId: 'app', excludeTaskId: 'me' })
      .map((reference) => reference.identifier);

  it('offers the latest open tasks, the current project’s first, leaving out this task', () => {
    expect(suggest('')).toEqual(['THR-2', 'CAT-7']);
  });

  it('matches titles and identifiers across the workspace', () => {
    expect(suggest('dock')).toEqual(['CAT-7']);
    expect(suggest('THR-2')).toEqual(['THR-2']);
    expect(suggest('cat-7')).toEqual(['CAT-7']);
    expect(suggest('nothing like it')).toEqual([]);
  });
});

describe('a reference’s card details', () => {
  it('reads its rank, tags and open blockers', () => {
    const tags = [tag('primary', 'app'), tag('secondary', 'app'), tag('foreign', 'notes')];
    const taskTags: TaskTag[] = [
      { workspaceId: 'workspace', projectId: 'app', taskId: 'next', tagId: 'secondary' },
      { workspaceId: 'workspace', projectId: 'app', taskId: 'next', tagId: 'primary' },
      { workspaceId: 'workspace', projectId: 'app', taskId: 'me', tagId: 'secondary' },
    ];
    const relations: TaskRelation[] = [
      {
        id: 'r',
        workspaceId: 'workspace',
        sourceTaskId: 'dock',
        targetTaskId: 'next',
        kind: 'blocks',
        createdAt: '2026-11-22T00:00:00.000Z',
      },
    ];
    const base = sources({ tags, taskTags, relations });
    base.tasks = base.tasks.map((row) =>
      row.id === 'next' ? { ...row, priority: 2, primaryTagId: 'primary' } : row,
    );
    const index = buildReferenceIndex(base);
    const details = index.details(index.resolve('workspace', 'THR-2')!);
    expect(details.priorityName).toBe('Soon');
    expect(details.primaryTag?.id).toBe('primary');
    expect(details.secondaryTags.map((row) => row.id)).toEqual(['secondary']);
    expect(details.tags.map((row) => row.id)).toEqual(['primary', 'secondary']);
    expect(details.blockers.map((blocker) => blocker.identifier)).toEqual(['CAT-7']);
  });
});
