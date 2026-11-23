import type { PendingMutation, Transaction } from '@tanstack/react-db';
import type { Task, TaskRelation } from '@throw/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { taskRelationCreateRequest } from './writeRequests';

// As in `comments.test.ts`: real collections in memory, and writes that are never sent.
const fake = vi.hoisted(() => ({ written: [] as Transaction[] }));
vi.mock('./collections', async () => {
  const { createCollection, createTransaction, localOnlyCollectionOptions } = await import(
    '@tanstack/react-db'
  );
  const collection = <T extends { id: string }>(id: string) =>
    createCollection(localOnlyCollectionOptions<T, string>({ id, getKey: (row) => row.id }));
  return {
    tasksCollection: collection<Task>('tasks'),
    taskRelationsCollection: collection<TaskRelation>('task-relations'),
    write(mutate: () => void) {
      const transaction = createTransaction({ autoCommit: false, mutationFn: async () => {} });
      transaction.mutate(mutate);
      fake.written.push(transaction);
      return transaction;
    },
  };
});

const { taskRelationsCollection, tasksCollection } = await import('./collections');
const { addTaskRelation, removeTaskRelation } = await import('./taskRelations');

const id = (n: number) => `0199a0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const WORKSPACE = id(10);
const [A, B, C, FOREIGN] = [id(1), id(2), id(3), id(4)];
for (const [task, workspaceId, projectId] of [
  [A, WORKSPACE, id(20)],
  [B, WORKSPACE, id(21)],
  [C, WORKSPACE, id(20)],
  [FOREIGN, id(11), id(22)],
] as const)
  tasksCollection.insert({ id: task, workspaceId, projectId } as Task);

function lastMutation() {
  const mutations = fake.written.at(-1)?.mutations ?? [];
  expect(mutations).toHaveLength(1);
  return mutations[0] as unknown as PendingMutation<TaskRelation>;
}

beforeEach(() => {
  fake.written.length = 0;
});

describe('task relations on the device', () => {
  it('stores “Blocked by” as the other task blocking, across projects', () => {
    const relationId = addTaskRelation(A, 'blocked_by', B);
    expect(taskRelationsCollection.get(relationId)).toMatchObject({
      workspaceId: WORKSPACE,
      sourceTaskId: B,
      targetTaskId: A,
      kind: 'blocks',
    });
    const mutation = lastMutation();
    expect(mutation.type).toBe('insert');
    expect(taskRelationCreateRequest(mutation.modified)).toEqual({
      id: relationId,
      sourceTaskId: B,
      targetTaskId: A,
      kind: 'blocks',
    });
  });

  it('refuses the reverse, a repeat, self-links and other workspaces without writing', () => {
    expect(() => addTaskRelation(B, 'blocked_by', A)).toThrow('reverse relation');
    expect(() => addTaskRelation(A, 'blocked_by', B)).toThrow('already linked');
    expect(() => addTaskRelation(A, 'relates_to', A)).toThrow('itself');
    expect(() => addTaskRelation(A, 'relates_to', FOREIGN)).toThrow('workspace');
    expect(fake.written).toHaveLength(0);
  });

  it('keeps one symmetric link whichever task it was made from', () => {
    const relationId = addTaskRelation(C, 'relates_to', A);
    expect(taskRelationsCollection.get(relationId)).toMatchObject({
      sourceTaskId: A,
      targetTaskId: C,
    });
    expect(() => addTaskRelation(A, 'relates_to', C)).toThrow('already linked');
  });

  it('removes a relation once', () => {
    const relationId = addTaskRelation(A, 'duplicates', C);
    fake.written.length = 0;
    removeTaskRelation(relationId);
    expect(lastMutation().type).toBe('delete');
    removeTaskRelation(relationId);
    expect(fake.written).toHaveLength(1);
  });
});
