import type { Project, Status, Task } from '@throw/shared';
import { describe, expect, it } from 'vitest';
import {
  changeIdFor,
  projectCreateRequest,
  projectUpdateRequest,
  statusUpdateRequest,
  tagCreateRequest,
  taskCreateRequest,
  taskUpdateRequest,
} from './writeRequests';

const id = (n: number) => `0199a0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('change ids', () => {
  const key = '019a0c3e-5f1a-7b2c-9d3e-4f5a6b7c8d9e';
  it('are UUIDv7s with the write’s time', () => {
    const changeId = changeIdFor(key, id(1));
    expect(changeId).toMatch(UUID_V7);
    expect(changeId.slice(0, 13)).toBe(key.slice(0, 13));
  });
  it('are the same for every send of a write, and differ between tasks and writes', () => {
    expect(changeIdFor(key, id(1))).toBe(changeIdFor(key, id(1)));
    expect(changeIdFor(key, id(1))).not.toBe(changeIdFor(key, id(2)));
    expect(changeIdFor(key, id(1))).not.toBe(
      changeIdFor('019a0c3e-5f1a-7b2c-9d3e-4f5a6b7c8d9f', id(1)),
    );
  });
  it('are still UUIDs for a key that is not one', () => {
    expect(changeIdFor('not-a-uuid', id(1))).toMatch(UUID_V7);
  });
});

const project: Project = {
  id: id(1),
  workspaceId: id(2),
  name: 'Kitchen',
  color: 'teal',
  icon: null,
  position: 'a0',
  key: null,
  proposedKey: 'KIT',
  priorityNames: ['', '', '', '', ''],
  deletedAt: null,
};

describe('project requests', () => {
  const statuses: Status[] = (['backlog', 'active', 'done', 'cancelled'] as const).map(
    (category, index) => ({
      id: id(10 + index),
      workspaceId: id(2),
      projectId: id(1),
      name: category,
      category,
      position: 'a0',
      isDefault: true,
    }),
  );

  it('creates a project with its statuses and proposed key', () => {
    expect(projectCreateRequest(project, statuses)).toMatchObject({
      key: 'KIT',
      statuses: statuses.map(({ id, name, category, position, isDefault }) => ({
        id,
        name,
        category,
        position,
        isDefault,
      })),
    });
  });

  it('gives a create queued before statuses existed the starter set, the same on every resend', () => {
    const legacy = { ...project, proposedKey: undefined } as Project;
    const first = projectCreateRequest(legacy, []);
    expect(first.statuses.map((status) => [status.category, status.isDefault])).toEqual([
      ['backlog', true],
      ['active', true],
      ['done', true],
      ['cancelled', true],
    ]);
    expect(first.key).toBe('KIT');
    expect(projectCreateRequest(legacy, []).statuses).toEqual(first.statuses);
    for (const status of first.statuses) expect(status.id).toMatch(UUID_V7);
  });

  it('sends the trash state and a changed key, and nothing that is the device’s own', () => {
    const synced = { ...project, key: 'KIT', proposedKey: undefined };
    const trashed = { ...synced, deletedAt: '2026-10-14T10:00:00.000Z' };
    expect(projectUpdateRequest(synced, trashed, { deletedAt: trashed.deletedAt })).toEqual({
      trashed: true,
    });
    expect(projectUpdateRequest(trashed, synced, { deletedAt: null })).toEqual({ trashed: false });
    expect(
      projectUpdateRequest(synced, { ...synced, key: 'KT' }, { key: 'KT', name: 'Kitchen' }),
    ).toEqual({ key: 'KT', name: 'Kitchen' });
    expect(projectUpdateRequest(synced, synced, { proposedKey: 'X' } as Partial<Project>)).toBe(
      null,
    );
  });
});

describe('status requests', () => {
  it('leaves clearing a default to the server', () => {
    expect(statusUpdateRequest({ isDefault: false })).toBeNull();
    expect(statusUpdateRequest({ isDefault: true, name: 'Ready' })).toEqual({
      isDefault: true,
      name: 'Ready',
    });
  });
});

describe('task updates', () => {
  const task: Task = {
    id: id(5),
    workspaceId: id(2),
    projectId: id(1),
    number: 4,
    title: 'Paint',
    primaryTagId: null,
    description: null,
    descriptionVersion: null,
    statusId: id(10),
    priority: 3,
    position: 'a0',
    parentId: null,
    closedAt: null,
    deletedAt: null,
    createdAt: '2026-10-14T10:00:00.000Z',
  };

  it('carries a task create queued before tags existed without changing its other fields', () => {
    const { primaryTagId: _primaryTagId, ...legacy } = task;
    expect(taskCreateRequest(legacy as Task)).toMatchObject({
      id: task.id,
      title: task.title,
      primaryTagId: null,
      secondaryTagIds: [],
    });
  });

  it('sends nothing for server values and unchanged fields', () => {
    expect(
      taskUpdateRequest(task, { ...task, closedAt: 'x', number: 5 }, { closedAt: 'x' }, id(9)),
    ).toBeNull();
    expect(taskUpdateRequest(task, task, { title: 'Paint' }, id(9))).toBeNull();
  });

  it('refuses a description change without a new version', () => {
    expect(() =>
      taskUpdateRequest(task, { ...task, description: [] }, { description: [] }, id(9)),
    ).toThrow(/version/);
  });
});

it('sends client-set tag fields without the device workspace column', () => {
  expect(
    tagCreateRequest({
      id: id(1),
      workspaceId: id(2),
      projectId: id(3),
      name: 'Work',
      parentId: null,
      color: 'teal',
      icon: null,
    }),
  ).toEqual({
    id: id(1),
    projectId: id(3),
    name: 'Work',
    parentId: null,
    color: 'teal',
    icon: null,
  });
});
