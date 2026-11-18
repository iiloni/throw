import { describe, expect, it } from 'vitest';
import { activityEntrySchema, SYNCED_ACTIVITY_KINDS } from './activity';
import { commentSchema, createCommentSchema, updateCommentSchema } from './comments';

const id = (n: number) => `0199a0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const body = [{ type: 'paragraph', content: [{ type: 'text', text: 'Looks good' }] }];

describe('comments', () => {
  it('creates with the id, task and body only; the server sets the rest', () => {
    expect(createCommentSchema.parse({ id: id(1), taskId: id(2), body })).toEqual({
      id: id(1),
      taskId: id(2),
      body,
    });
    expect(
      createCommentSchema.safeParse({ id: id(1), taskId: id(2), body, userId: 'me' }).success,
      'the author is the server’s to set',
    ).toBe(false);
    expect(
      createCommentSchema.safeParse({ id: id(1), taskId: id(2), body: [] }).success,
      'an empty document',
    ).toBe(false);
    expect(createCommentSchema.safeParse({ id: id(1), taskId: id(2), body: null }).success).toBe(
      false,
    );
  });

  it('edits only the body', () => {
    expect(updateCommentSchema.parse({ body })).toEqual({ body });
    expect(updateCommentSchema.safeParse({ body, editedAt: null }).success).toBe(false);
  });

  it('has no time on the device until the server receives it', () => {
    const comment = {
      id: id(1),
      workspaceId: id(3),
      projectId: id(4),
      taskId: id(2),
      userId: 'user',
      body,
      createdAt: null,
      editedAt: null,
    };
    expect(commentSchema.parse(comment)).toEqual(comment);
    expect(
      commentSchema.parse({ ...comment, createdAt: '2026-10-14T09:30:00.000Z' }).createdAt,
    ).toBe('2026-10-14T09:30:00.000Z');
  });
});

describe('activity entries', () => {
  const entry = {
    id: id(5),
    workspaceId: id(3),
    projectId: id(4),
    taskId: id(2),
    userId: 'user',
    kind: 'updated',
    changes: [
      {
        field: 'statusId',
        previous: id(6),
        requested: id(7),
        previousName: 'Backlog',
        requestedName: 'In progress',
        applied: false,
        reason: 'stale',
      },
    ],
    createdAt: '2026-10-14T09:30:00.000Z',
  };

  it('reads an entry a device syncs', () => {
    expect(activityEntrySchema.parse(entry)).toEqual(entry);
  });

  it('never syncs the entries that only record a reorder', () => {
    expect(SYNCED_ACTIVITY_KINDS).toEqual(['created', 'updated']);
    expect(activityEntrySchema.safeParse({ ...entry, kind: 'reordered' }).success).toBe(false);
  });
});
