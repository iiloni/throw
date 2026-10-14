import type { Project, Status, Task } from '@throw/shared';
import { describe, expect, it } from 'vitest';
import { compareClosed, compareTasks, identifier, subtasksOf } from './model';
import { projectBoardData } from './selection';
import { initialBoard, listTasks } from './state';

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
  status('done', 'done'),
  status('review', 'active', 'a1'),
  status('ideas', 'backlog', 'a1'),
  status('build', 'active'),
  status('backlog', 'backlog'),
  status('cancelled', 'cancelled'),
];
const task = (id: string, edit: Partial<Task> = {}): Task => ({
  id,
  projectId: project.id,
  workspaceId: project.workspaceId,
  number: 1,
  title: id,
  description: null,
  descriptionVersion: null,
  statusId: 'build',
  priority: 3,
  position: 'a0',
  parentId: null,
  closedAt: null,
  deletedAt: null,
  createdAt: '2026-10-14T12:00:00Z',
  ...edit,
});

function view(tasks: Task[]) {
  return initialBoard([projectBoardData(project, statuses, tasks)]);
}

describe('synced project board selection', () => {
  it('isolates projects and excludes a trashed task, its children and trashed projects', () => {
    const rows = [
      task('visible'),
      task('other', { projectId: 'other' }),
      task('trashed', { deletedAt: '2026-10-14T12:00:00Z' }),
      task('child', { parentId: 'trashed' }),
      task('deleted-child', { parentId: 'visible', deletedAt: '2026-10-14T12:00:00Z' }),
    ];
    expect(projectBoardData(project, statuses, rows).tasks.map(({ id }) => id)).toEqual([
      'visible',
    ]);
    expect(
      projectBoardData({ ...project, deletedAt: '2026-10-14T12:00:00Z' }, statuses, rows).tasks,
    ).toEqual([]);
  });
  it('orders statuses by category, position and id, leaving active columns in project order', () => {
    const data = projectBoardData(
      project,
      [...statuses, { ...status('foreign', 'active'), projectId: 'other' }],
      [],
    );
    expect(data.project.statuses.map(({ id }) => id)).toEqual([
      'backlog',
      'ideas',
      'build',
      'review',
      'done',
      'cancelled',
    ]);
  });
  it('orders each column and mixed backlog by priority 1–5, position and id, without mutating source rows', () => {
    const rows = [
      task('z'),
      task('b', { position: 'a1' }),
      task('a'),
      task('urgent', { priority: 1, position: 'a9' }),
      task('last', { priority: 5 }),
      task('waiting', { statusId: 'ideas' }),
      task('planned', { statusId: 'backlog', priority: 2 }),
    ];
    const state = view(rows);
    expect(listTasks(state, 'status:build').map(({ id }) => id)).toEqual([
      'urgent',
      'a',
      'z',
      'b',
      'last',
    ]);
    expect(listTasks(state, 'backlog').map(({ id }) => id)).toEqual(['planned', 'waiting']);
    expect(listTasks({ ...state, backlogFilter: 'ideas' }, 'backlog').map(({ id }) => id)).toEqual([
      'waiting',
    ]);
    expect(rows[0]?.id).toBe('z');
  });
  it('sorts closed tasks newest first with a deterministic id tie-break and filters both closed categories', () => {
    const state = view([
      task('old', { statusId: 'done', closedAt: '2026-10-10T12:00:00Z' }),
      task('a', { statusId: 'cancelled', closedAt: '2026-10-14T12:00:00Z' }),
      task('z', { statusId: 'done', closedAt: '2026-10-14T12:00:00Z' }),
    ]);
    expect(listTasks(state, 'closed').map(({ id }) => id)).toEqual(['z', 'a', 'old']);
    expect(
      listTasks({ ...state, closedFilter: 'cancelled' }, 'closed').map(({ id }) => id),
    ).toEqual(['a']);
    expect([...state.boards[0]!.tasks].sort(compareClosed).map(({ id }) => id)).toEqual([
      'z',
      'a',
      'old',
    ]);
  });
  it('keeps subtasks in parent position order and shows them in their own statuses only when requested', () => {
    const state = view([
      task('parent'),
      task('z', { parentId: 'parent', statusId: 'review', priority: 1 }),
      task('a', { parentId: 'parent', statusId: 'done', closedAt: '2026-10-14T12:00:00Z' }),
      task('first', { parentId: 'parent', priority: 5, position: 'Zz' }),
    ]);
    expect(listTasks(state, 'status:build').map(({ id }) => id)).toEqual(['parent']);
    expect(listTasks(state, 'closed')).toEqual([]);
    expect(subtasksOf(state.boards[0]!.tasks, 'parent').map(({ id }) => id)).toEqual([
      'first',
      'a',
      'z',
    ]);
    expect(
      listTasks({ ...state, subtasksAsCards: true }, 'status:review').map(({ id }) => id),
    ).toEqual(['z']);
    expect(listTasks({ ...state, subtasksAsCards: true }, 'closed').map(({ id }) => id)).toEqual([
      'a',
    ]);
  });
  it('keeps unnumbered tasks visible and identifiers pending until both values sync', () => {
    const data = projectBoardData({ ...project, key: null }, statuses, [
      task('pending', { number: null }),
      task('numbered'),
    ]);
    expect(data.tasks.sort(compareTasks).map(({ id }) => id)).toEqual(['numbered', 'pending']);
    expect(identifier(data.project, data.tasks[0]!)).toBeNull();
    expect(identifier({ ...data.project, key: 'BRD' }, data.tasks[1]!)).toBeNull();
    expect(identifier({ ...data.project, key: 'NEW' }, { ...data.tasks[1]!, number: 12 })).toBe(
      'NEW-12',
    );
  });
});
