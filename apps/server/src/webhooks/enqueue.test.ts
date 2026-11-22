import { webhookPayloadSchema } from '@throw/shared';
import { describe, expect, it } from 'vitest';
import { buildPayload, followsChange } from './enqueue';

const user = { userId: 'user-1' };
const token = {
  userId: 'user-1',
  workspaceId: '019a0000-0000-7000-8000-00000000000a',
  viaTokenName: 'Queue agent',
  tokenId: '019a0000-0000-7000-8000-00000000000b',
};
const projectId = '019a0000-0000-7000-8000-00000000000c';
const otherProject = '019a0000-0000-7000-8000-00000000000d';

describe('followsChange', () => {
  const workspaceWide = { projectId: null, ignoreTokenWrites: true, projectTrashed: false };
  const scoped = { projectId, ignoreTokenWrites: false, projectTrashed: false };

  it('skips token writes when the webhook ignores them', () => {
    const change = { projectId, entityType: 'task' as const, kind: 'updated' };
    expect(followsChange(workspaceWide, change, user)).toBe(true);
    expect(followsChange(workspaceWide, change, token)).toBe(false);
    expect(followsChange({ ...workspaceWide, ignoreTokenWrites: false }, change, token)).toBe(true);
  });

  it('limits a project webhook to its project', () => {
    expect(
      followsChange(scoped, { projectId, entityType: 'task' as const, kind: 'updated' }, token),
    ).toBe(true);
    expect(
      followsChange(
        scoped,
        { projectId: otherProject, entityType: 'task' as const, kind: 'updated' },
        user,
      ),
    ).toBe(false);
    expect(
      followsChange(
        scoped,
        { projectId: null, entityType: 'task' as const, kind: 'updated' },
        user,
      ),
    ).toBe(false);
  });

  it('keeps a trashed project quiet apart from its trashing', () => {
    const trashed = { ...scoped, projectTrashed: true };
    expect(
      followsChange(trashed, { projectId, entityType: 'project', kind: 'trashed' }, user),
    ).toBe(true);
    // A task trashed inside the trashed project is part of the quiet.
    expect(followsChange(trashed, { projectId, entityType: 'task', kind: 'trashed' }, user)).toBe(
      false,
    );
    expect(
      followsChange(trashed, { projectId, entityType: 'task' as const, kind: 'updated' }, user),
    ).toBe(false);
  });
});

describe('buildPayload', () => {
  const deliveryId = '019a0000-0000-7000-8000-000000000001';
  const occurredAt = new Date('2026-11-22T10:00:00.000Z');

  it('describes a task change with its key and status, without content', () => {
    const payload = buildPayload(
      deliveryId,
      {
        event: 'task.updated',
        workspaceId: token.workspaceId,
        projectId,
        entityType: 'task',
        kind: 'updated',
        taskId: '019a0000-0000-7000-8000-00000000000e',
        taskNumber: 12,
        changedFields: ['statusId', 'position'],
        statusTo: { id: '019a0000-0000-7000-8000-00000000000f', name: 'Done', category: 'done' },
      },
      token,
      'THR',
      occurredAt,
    );
    expect(webhookPayloadSchema.parse(payload)).toEqual(payload);
    expect(payload).toEqual({
      deliveryId,
      event: 'task.updated',
      workspaceId: token.workspaceId,
      projectId,
      projectKey: 'THR',
      entityType: 'task',
      kind: 'updated',
      taskId: '019a0000-0000-7000-8000-00000000000e',
      taskKey: 'THR-12',
      actor: { kind: 'token', viaTokenName: 'Queue agent' },
      changedFields: ['statusId', 'position'],
      statusTo: { id: '019a0000-0000-7000-8000-00000000000f', name: 'Done', category: 'done' },
      occurredAt: '2026-11-22T10:00:00.000Z',
    });
  });

  it('leaves out task fields for structure changes and names a user actor', () => {
    const payload = buildPayload(
      deliveryId,
      {
        event: 'structure.updated',
        workspaceId: token.workspaceId,
        projectId,
        entityType: 'status',
        kind: 'created',
        changedFields: ['status.name'],
      },
      user,
      null,
      occurredAt,
    );
    expect(webhookPayloadSchema.parse(payload)).toEqual(payload);
    expect(payload).not.toHaveProperty('taskId');
    expect(payload).not.toHaveProperty('statusTo');
    expect(payload.actor).toEqual({ kind: 'user', viaTokenName: null });
  });
});
