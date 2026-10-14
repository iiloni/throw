import type { PendingMutation, Transaction } from '@tanstack/react-db';
import {
  type Project,
  STARTER_STATUSES,
  type Status,
  type Task,
  updateTaskSchema,
} from '@throw/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeIdFor, taskCreateRequest, taskUpdateRequest } from './writeRequests';

// The actions run against real TanStack DB collections, kept in memory, and writes that are
// never sent: as on a device that is offline. Each write's mutations then go through the same
// mapping the outbox uses to build requests.
const fake = vi.hoisted(() => ({ written: [] as Transaction[] }));
vi.mock('./collections', async () => {
  const { createCollection, createTransaction, localOnlyCollectionOptions } = await import(
    '@tanstack/react-db'
  );
  const collection = <T extends { id: string }>(id: string) =>
    createCollection(localOnlyCollectionOptions<T, string>({ id, getKey: (row) => row.id }));
  return {
    projectsCollection: collection<Project>('projects'),
    statusesCollection: collection<Status>('statuses'),
    tasksCollection: collection<Task>('tasks'),
    write(mutate: () => void) {
      const transaction = createTransaction({ autoCommit: false, mutationFn: async () => {} });
      transaction.mutate(mutate);
      fake.written.push(transaction);
      return transaction;
    },
  };
});

const { projectsCollection, statusesCollection, tasksCollection } = await import('./collections');
const { createProject } = await import('./projects');
const tasks = await import('./tasks');

const KEY = '0199a0a0-0000-7000-8000-00000000000a';

/** The single mutation of the last write. */
function lastMutation() {
  const mutations = fake.written.at(-1)?.mutations ?? [];
  expect(mutations).toHaveLength(1);
  return mutations[0] as unknown as PendingMutation<Task>;
}

function lastUpdateRequest() {
  const mutation = lastMutation();
  expect(mutation.type).toBe('update');
  return taskUpdateRequest(
    mutation.original as Task,
    mutation.modified,
    mutation.changes,
    changeIdFor(KEY, String(mutation.key)),
  );
}

function statusIn(projectId: string, category: Status['category']) {
  return [...statusesCollection.values()].find(
    (status) => status.projectId === projectId && status.category === category,
  )!;
}

let projectId: string;
beforeEach(() => {
  fake.written.length = 0;
  projectId = createProject('0199a0a0-0000-7000-8000-0000000000ff', 'House move');
});

describe('creating a project', () => {
  it('makes one default status per category in the same write, and proposes a key', () => {
    const [write] = fake.written;
    expect(write?.mutations.map((mutation) => mutation.collection.id)).toEqual([
      'projects',
      ...STARTER_STATUSES.map(() => 'statuses'),
    ]);
    expect(projectsCollection.get(projectId)).toMatchObject({ key: null, proposedKey: 'HM' });
  });
});

describe('creating a task offline', () => {
  it('takes the backlog default and default priority, with no number until it syncs', () => {
    const id = tasks.createTask(projectId, { title: 'Pack books' });
    const task = tasksCollection.get(id)!;
    expect(task).toMatchObject({
      number: null,
      priority: 3,
      statusId: statusIn(projectId, 'backlog').id,
      closedAt: null,
      deletedAt: null,
    });
    expect(taskCreateRequest(task)).toEqual({
      id,
      projectId,
      title: 'Pack books',
      description: null,
      descriptionVersion: null,
      statusId: statusIn(projectId, 'backlog').id,
      priority: 3,
      position: task.position,
      parentId: null,
    });
  });

  it('puts a new task at the top of its priority, and a subtask after its siblings', () => {
    const first = tasks.createTask(projectId, { title: 'First' });
    const second = tasks.createTask(projectId, { title: 'Second' });
    expect(tasksCollection.get(second)!.position < tasksCollection.get(first)!.position).toBe(true);
    const a = tasks.createTask(projectId, { title: 'a', parentId: first });
    const b = tasks.createTask(projectId, { title: 'b', parentId: first });
    expect(tasksCollection.get(a)!.position < tasksCollection.get(b)!.position).toBe(true);
    expect(() => tasks.createTask(projectId, { parentId: a })).toThrow(/top-level parent/);
  });

  it('stamps a placeholder close time on a task created closed', () => {
    const id = tasks.createTask(projectId, { statusId: statusIn(projectId, 'done').id });
    expect(tasksCollection.get(id)!.closedAt).toEqual(expect.any(String));
  });
});

describe('editing a task offline', () => {
  it('sends what the device held before each change, so a chain of edits holds together', () => {
    const id = tasks.createTask(projectId, { title: 'A' });
    tasks.updateTask(id, { title: 'B' });
    const first = lastUpdateRequest();
    tasks.updateTask(id, { title: 'C' });
    const second = lastUpdateRequest();
    expect(first?.changes).toEqual({ title: { before: 'A', after: 'B' } });
    expect(second?.changes).toEqual({ title: { before: 'B', after: 'C' } });
    expect(updateTaskSchema.safeParse(second).success).toBe(true);
  });

  it('sends a status change without the close time, which the server stamps', () => {
    const id = tasks.createTask(projectId, { title: 'Pack' });
    const done = statusIn(projectId, 'done');
    tasks.updateTask(id, { statusId: done.id });
    expect(tasksCollection.get(id)!.closedAt).toEqual(expect.any(String));
    expect(lastUpdateRequest()?.changes).toEqual({
      statusId: { before: statusIn(projectId, 'backlog').id, after: done.id },
    });
    tasks.updateTask(id, { statusId: statusIn(projectId, 'active').id });
    expect(tasksCollection.get(id)!.closedAt).toBeNull();
  });

  it('sends a drop with the status, priority and parent its position was computed for', () => {
    const id = tasks.createTask(projectId, { title: 'Drop me' });
    const active = statusIn(projectId, 'active');
    tasks.moveTask(id, { statusId: active.id, priority: 1, position: 'a5' });
    expect(lastUpdateRequest()?.changes).toEqual({
      statusId: { before: statusIn(projectId, 'backlog').id, after: active.id },
      priority: { before: 3, after: 1 },
      position: { after: 'a5', statusId: active.id, priority: 1, parentId: null },
    });
  });

  it('sends a description save with the version it replaces', () => {
    const id = tasks.createTask(projectId, { title: 'Notes' });
    tasks.saveDescription(id, [{ type: 'paragraph' }]);
    const first = tasksCollection.get(id)!.descriptionVersion;
    tasks.saveDescription(id, [{ type: 'paragraph', content: 'more' }]);
    const request = lastUpdateRequest();
    expect(request?.changes.description).toEqual({
      before: first,
      after: {
        version: tasksCollection.get(id)!.descriptionVersion,
        document: [{ type: 'paragraph', content: 'more' }],
      },
    });
  });

  it('sends the trash state, not the device’s time', () => {
    const id = tasks.createTask(projectId, { title: 'Bin me' });
    tasks.trashTask(id);
    expect(lastUpdateRequest()?.changes).toEqual({ trashed: { before: false, after: true } });
    tasks.restoreTask(id);
    expect(lastUpdateRequest()?.changes).toEqual({ trashed: { before: true, after: false } });
  });

  it('moves a task that becomes a subtask to the end of its new parent', () => {
    const parent = tasks.createTask(projectId, { title: 'Parent' });
    tasks.createTask(projectId, { title: 'Existing', parentId: parent });
    const id = tasks.createTask(projectId, { title: 'Child' });
    tasks.updateTask(id, { parentId: parent });
    const request = lastUpdateRequest();
    expect(request?.changes.parentId).toEqual({ before: null, after: parent });
    expect(request?.changes.position).toMatchObject({ parentId: parent });
    expect(() => tasks.updateTask(parent, { parentId: id })).toThrow();
  });
});

describe('sending a task to a status', () => {
  it('puts a task at the top of its priority, and leaves a subtask in its place', () => {
    const active = statusIn(projectId, 'active');
    tasks.createTask(projectId, { title: 'Already there', statusId: active.id });
    const parent = tasks.createTask(projectId, { title: 'Parent' });
    const child = tasks.createTask(projectId, { title: 'Child', parentId: parent });
    tasks.sendTask(child, active.id);
    expect(lastUpdateRequest()?.changes).toEqual({
      statusId: { before: statusIn(projectId, 'backlog').id, after: active.id },
    });
    tasks.sendTask(parent, active.id);
    expect(lastUpdateRequest()?.changes.position).toMatchObject({
      statusId: active.id,
      parentId: null,
    });
  });
});

describe('the trash', () => {
  it('lists what was trashed on its own and empties it in one write', () => {
    const parent = tasks.createTask(projectId, { title: 'Parent' });
    const child = tasks.createTask(projectId, { title: 'Child', parentId: parent });
    const loose = tasks.createTask(projectId, { title: 'Loose' });
    tasks.trashTask(child);
    tasks.trashTask(parent);
    tasks.trashTask(loose);
    const workspaceId = projectsCollection.get(projectId)!.workspaceId;
    expect(
      tasks
        .trashedItems(workspaceId)
        .tasks.map((task) => task.id)
        .sort(),
    ).toEqual([parent, loose].sort());
    expect(tasks.taskInTrash(tasksCollection.get(child)!)).toBe(true);
    tasks.emptyTrash(workspaceId);
    const deleted = fake.written.at(-1)!.mutations.map((mutation) => String(mutation.key));
    expect(deleted.sort()).toEqual([parent, child, loose].sort());
  });
});
