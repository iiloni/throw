import type { PendingMutation, Transaction } from '@tanstack/react-db';
import type { Comment, Task } from '@throw/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commentCreateRequest, commentUpdateRequest } from './writeRequests';

// As in `tasks.test.ts`: real collections in memory, and writes that are never sent, as on a
// device that is offline. Each write's mutations go through the outbox's request mapping.
const fake = vi.hoisted(() => ({ written: [] as Transaction[] }));
vi.mock('./collections', async () => {
  const { createCollection, createTransaction, localOnlyCollectionOptions } = await import(
    '@tanstack/react-db'
  );
  const collection = <T extends { id: string }>(id: string) =>
    createCollection(localOnlyCollectionOptions<T, string>({ id, getKey: (row) => row.id }));
  return {
    tasksCollection: collection<Task>('tasks'),
    commentsCollection: collection<Comment>('comments'),
    signedInUserId: 'me',
    write(mutate: () => void) {
      const transaction = createTransaction({ autoCommit: false, mutationFn: async () => {} });
      transaction.mutate(mutate);
      fake.written.push(transaction);
      return transaction;
    },
  };
});

const { commentsCollection, tasksCollection } = await import('./collections');
const comments = await import('./comments');

const id = (n: number) => `0199a0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const TASK = id(1);
const text = (value: string) => [{ type: 'paragraph', content: [{ type: 'text', text: value }] }];

function lastMutation() {
  const mutations = fake.written.at(-1)?.mutations ?? [];
  expect(mutations).toHaveLength(1);
  return mutations[0] as unknown as PendingMutation<Comment>;
}

// Only the fields a comment takes from its task.
tasksCollection.insert({ id: TASK, workspaceId: id(2), projectId: id(3) } as Task);

beforeEach(() => {
  fake.written.length = 0;
});

describe('writing a comment offline', () => {
  it('has no time until the server receives it, and sends only what the server takes', () => {
    const commentId = comments.addComment(TASK, text('First'));
    expect(commentsCollection.get(commentId)).toMatchObject({
      taskId: TASK,
      workspaceId: id(2),
      projectId: id(3),
      userId: 'me',
      createdAt: null,
      editedAt: null,
    });
    const mutation = lastMutation();
    expect(mutation.type).toBe('insert');
    expect(commentCreateRequest(mutation.modified)).toEqual({
      id: commentId,
      taskId: TASK,
      body: text('First'),
    });
  });

  it('refuses an empty comment and a task the device does not have', () => {
    expect(() => comments.addComment(TASK, [])).toThrow();
    expect(() => comments.addComment(id(99), text('Nowhere'))).toThrow(/Task not found/);
    expect(fake.written).toHaveLength(0);
  });

  it('sends an edit’s body, and nothing for an edit that changes nothing', () => {
    const commentId = comments.addComment(TASK, text('Draft'));
    comments.editComment(commentId, text('Final'));
    const mutation = lastMutation();
    expect(mutation.type).toBe('update');
    expect(commentUpdateRequest(mutation.changes)).toEqual({ body: text('Final') });
    expect(commentsCollection.get(commentId)?.editedAt).toEqual(expect.any(String));
    const writes = fake.written.length;
    comments.editComment(commentId, text('Final'));
    expect(fake.written).toHaveLength(writes);
  });

  it('deletes', () => {
    const commentId = comments.addComment(TASK, text('Oops'));
    comments.deleteComment(commentId);
    expect(lastMutation().type).toBe('delete');
    expect(commentsCollection.has(commentId)).toBe(false);
  });

  it('lets only the author change a comment', () => {
    const theirs = id(50);
    commentsCollection.insert({
      id: theirs,
      workspaceId: id(2),
      projectId: id(3),
      taskId: TASK,
      userId: 'someone else',
      body: text('Theirs'),
      createdAt: '2026-10-14T09:30:00.000Z',
      editedAt: null,
    });
    expect(() => comments.editComment(theirs, text('Mine now'))).toThrow(/author/);
    expect(() => comments.deleteComment(theirs)).toThrow(/author/);
  });
});

describe('a comment edit request', () => {
  it('is null when the body did not change', () => {
    expect(commentUpdateRequest({ editedAt: '2026-10-14T09:30:00.000Z' })).toBeNull();
  });
});
