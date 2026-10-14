import { describe, expect, it } from 'vitest';
import type { Priority } from './priorities';
import {
  closedAtAfter,
  compareClosedTasks,
  compareTasks,
  createTaskSchema,
  isTaskTrashed,
  taskIdentifier,
  updateTaskSchema,
} from './tasks';

const id = (n: number) => `0199a0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('task identifiers', () => {
  it('needs both the key and the number', () => {
    expect(taskIdentifier({ key: 'CAT' }, { number: 12 })).toBe('CAT-12');
    expect(taskIdentifier({ key: null }, { number: 12 })).toBeNull();
    expect(taskIdentifier({ key: 'CAT' }, { number: null })).toBeNull();
  });
});

describe('ordering', () => {
  it('sorts a column by priority, then position, then id', () => {
    const tasks: { id: string; priority: Priority; position: string }[] = [
      { id: id(3), priority: 3, position: 'a0' },
      { id: id(2), priority: 1, position: 'a1' },
      { id: id(1), priority: 3, position: 'a0' },
      { id: id(4), priority: 1, position: 'a0' },
    ];
    expect(tasks.sort(compareTasks).map((task) => task.id)).toEqual([id(4), id(2), id(1), id(3)]);
  });

  it('compares positions by code unit, not locale', () => {
    // 'Z' sorts before 'a' by code unit; a locale comparison folds case and would not.
    const tasks: { id: string; priority: Priority; position: string }[] = [
      { id: id(1), priority: 3, position: 'a0' },
      { id: id(2), priority: 3, position: 'Zz' },
    ];
    expect(tasks.sort(compareTasks).map((task) => task.id)).toEqual([id(2), id(1)]);
  });

  it('sorts the closed zone newest first', () => {
    const tasks = [
      { id: id(1), closedAt: '2026-10-01T10:00:00.000Z' },
      { id: id(2), closedAt: '2026-10-03T10:00:00.000Z' },
      { id: id(3), closedAt: '2026-10-02T10:00:00.000Z' },
    ];
    expect(tasks.sort(compareClosedTasks).map((task) => task.id)).toEqual([id(2), id(3), id(1)]);
  });
});

describe('closedAt', () => {
  const now = '2026-10-14T10:00:00.000Z';
  const earlier = '2026-10-01T10:00:00.000Z';
  it('is stamped on entering a closed status from an open one, or on creation in one', () => {
    expect(closedAtAfter(null, 'active', 'done', now)).toBe(now);
    expect(closedAtAfter(null, 'backlog', 'cancelled', now)).toBe(now);
    expect(closedAtAfter(null, null, 'done', now)).toBe(now);
  });
  it('is kept between closed statuses and cleared on reopening', () => {
    expect(closedAtAfter(earlier, 'done', 'cancelled', now)).toBe(earlier);
    expect(closedAtAfter(earlier, 'done', 'active', now)).toBeNull();
    expect(closedAtAfter(null, null, 'backlog', now)).toBeNull();
  });
});

describe('trash', () => {
  const live = { deletedAt: null };
  const gone = { deletedAt: '2026-10-14T10:00:00.000Z' };
  it('counts a task trashed through itself, its parent or its project', () => {
    expect(isTaskTrashed(live, null, live)).toBe(false);
    expect(isTaskTrashed(gone, null, live)).toBe(true);
    expect(isTaskTrashed(live, gone, live)).toBe(true);
    expect(isTaskTrashed(live, live, gone)).toBe(true);
  });
});

describe('create schema', () => {
  const create = {
    id: id(1),
    projectId: id(2),
    title: 'Paint the hall',
    description: null,
    descriptionVersion: null,
    position: 'a0',
    parentId: null,
  };
  it('defaults the status to the backlog default and the priority to 3', () => {
    expect(createTaskSchema.parse(create)).toMatchObject({ statusId: null, priority: 3 });
  });
  it('takes no server values', () => {
    expect(createTaskSchema.safeParse({ ...create, number: 4 }).success).toBe(false);
    expect(createTaskSchema.safeParse({ ...create, workspaceId: id(3) }).success).toBe(false);
    expect(createTaskSchema.safeParse({ ...create, closedAt: null }).success).toBe(false);
  });
  it('allows an empty title, so a create is never dropped for one', () => {
    expect(createTaskSchema.safeParse({ ...create, title: '' }).success).toBe(true);
  });
});

describe('update schema', () => {
  it('carries each field before and after', () => {
    const update = {
      changeId: id(9),
      changes: {
        title: { before: 'A', after: 'B' },
        priority: { before: 3, after: 1 },
        statusId: { before: id(1), after: id(2) },
        parentId: { before: null, after: id(3) },
        trashed: { before: false, after: true },
        description: { before: null, after: { version: id(4), document: [{ type: 'paragraph' }] } },
        position: { after: 'a1', statusId: id(2), priority: 1, parentId: id(3) },
      },
    };
    expect(updateTaskSchema.parse(update)).toEqual(update);
  });
  it('refuses a field without its before value, an empty change and unknown fields', () => {
    expect(
      updateTaskSchema.safeParse({ changeId: id(9), changes: { title: { after: 'B' } } }).success,
    ).toBe(false);
    expect(updateTaskSchema.safeParse({ changeId: id(9), changes: {} }).success).toBe(false);
    expect(
      updateTaskSchema.safeParse({
        changeId: id(9),
        changes: { closedAt: { before: null, after: 'x' } },
      }).success,
    ).toBe(false);
  });
  it('needs the context a position was computed in', () => {
    expect(
      updateTaskSchema.safeParse({ changeId: id(9), changes: { position: { after: 'a1' } } })
        .success,
    ).toBe(false);
  });
});
