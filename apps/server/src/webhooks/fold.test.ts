import { type ActivityChange, webhookPayloadSchema } from '@throw/shared';
import { describe, expect, it } from 'vitest';
import { buildPayload, type WebhookChange } from './enqueue';
import {
  BLANK_TASK_TITLE,
  coalesceKeyOf,
  type Folded,
  fieldValues,
  foldStructure,
  foldTask,
  mergePayload,
} from './fold';

const workspaceId = '019a0000-0000-7000-8000-00000000000a';
const projectId = '019a0000-0000-7000-8000-00000000000c';
const taskId = '019a0000-0000-7000-8000-00000000000e';
const tagId = '019a0000-0000-7000-8000-000000000020';
const otherTask = '019a0000-0000-7000-8000-000000000021';
const backlog = {
  id: '019a0000-0000-7000-8000-000000000010',
  name: 'Backlog',
  category: 'backlog' as const,
};
const done = {
  id: '019a0000-0000-7000-8000-000000000011',
  name: 'Done',
  category: 'done' as const,
};
const user = { userId: 'user-1' };
const agent = {
  userId: 'user-1',
  workspaceId,
  viaTokenName: 'Agent',
  tokenId: '019a0000-0000-7000-8000-00000000000b',
};
const deliveryId = '019a0000-0000-7000-8000-000000000001';

const item = (field: ActivityChange['field'], previous: unknown, requested: unknown, extra = {}) =>
  ({ field, previous, requested, applied: true, ...extra }) as ActivityChange;

const created = (title = BLANK_TASK_TITLE, extra: ActivityChange[] = []): WebhookChange => ({
  event: 'task.created',
  workspaceId,
  projectId,
  entityType: 'task',
  kind: 'created',
  taskId,
  taskNumber: 12,
  changedFields: ['title', 'statusId', 'priority', ...extra.map((change) => change.field)],
  statusTo: backlog,
  values: [
    item('title', null, title),
    item('statusId', null, backlog.id),
    item('priority', null, 2),
    ...extra,
  ],
});

const updated = (items: ActivityChange[], extra: Partial<WebhookChange> = {}): WebhookChange => ({
  event: 'task.updated',
  workspaceId,
  projectId,
  entityType: 'task',
  kind: 'updated',
  taskId,
  taskNumber: 12,
  changedFields: [...new Set(items.map((change) => change.field))],
  values: items,
  ...extra,
});

const purged: WebhookChange = {
  event: 'task.deleted',
  workspaceId,
  projectId,
  projectKey: 'THR',
  entityType: 'task',
  kind: 'deleted',
  taskId,
  taskNumber: 12,
};

/** Folds changes as the queue does: each into whatever the previous left waiting. */
function fold(...changes: (WebhookChange | [WebhookChange, typeof agent])[]) {
  let current: Folded | undefined;
  changes.forEach((entry, minute) => {
    const [change, actor] = Array.isArray(entry) ? entry : [entry, user];
    const next = buildPayload(
      current?.payload.deliveryId ?? deliveryId,
      change,
      actor,
      'THR',
      new Date(`2026-11-22T10:0${minute}:00.000Z`),
    );
    const values = change.values && fieldValues(change.values);
    current =
      change.event === 'structure.updated'
        ? foldStructure(current, next)
        : foldTask(current?.outcome === 'drop' ? undefined : current, next, values);
  });
  expect(webhookPayloadSchema.parse(current!.payload)).toEqual(current!.payload);
  // The stored fold survives a JSON round trip, as jsonb.
  if (current!.fold) expect(JSON.parse(JSON.stringify(current!.fold))).toEqual(current!.fold);
  return current!;
}

describe('coalesceKeyOf', () => {
  it('folds task changes by task and structure by project, never comments', () => {
    expect(coalesceKeyOf(updated([]))).toBe(`task:${taskId}`);
    expect(coalesceKeyOf(created())).toBe(`task:${taskId}`);
    expect(coalesceKeyOf(purged)).toBe(`task:${taskId}`);
    expect(coalesceKeyOf({ ...updated([]), event: 'comment.created' })).toBeNull();
    expect(coalesceKeyOf({ event: 'structure.updated', workspaceId, projectId })).toBe(
      `structure:${projectId}`,
    );
    expect(coalesceKeyOf({ event: 'structure.updated', workspaceId, projectId: null })).toBe(
      `structure:${workspaceId}`,
    );
  });
});

describe('fieldValues', () => {
  it('keys tags and relations by what they point at, and skips refused items', () => {
    expect(
      fieldValues([
        item('title', 'A', 'B'),
        item('secondaryTags', tagId, null, { tagId }),
        item('relations', null, otherTask, { relation: 'blocks', relationId: tagId }),
        { ...item('priority', 1, 3), applied: false },
      ]),
    ).toEqual([
      { key: 'title', field: 'title', from: 'A', to: 'B' },
      { key: `secondaryTags:${tagId}`, field: 'secondaryTags', from: true, to: false },
      { key: `relations:blocks:${otherTask}`, field: 'relations', from: false, to: true },
    ]);
  });
});

describe('foldTask', () => {
  it('holds a blank new task until someone names it, then announces it as created', () => {
    expect(fold(created()).outcome).toBe('hold');
    const named = fold(created(), updated([item('title', BLANK_TASK_TITLE, 'Fix login')]));
    expect(named.outcome).toBe('wait');
    expect(named.payload).toMatchObject({
      deliveryId,
      event: 'task.created',
      kind: 'created',
      changedFields: ['title', 'statusId', 'priority'],
      statusTo: backlog,
      occurredAt: '2026-11-22T10:01:00.000Z',
    });
    // Named and then blank again is as untouched as never named.
    expect(
      fold(
        created(),
        updated([item('title', BLANK_TASK_TITLE, 'Fix login')]),
        updated([item('title', 'Fix login', BLANK_TASK_TITLE)]),
      ).outcome,
    ).toBe('hold');
  });

  it('announces a new task with a real title, a description or tags after the window', () => {
    expect(fold(created('Fix login')).outcome).toBe('wait');
    expect(fold(created(BLANK_TASK_TITLE, [item('description', null, 'v1')])).outcome).toBe('wait');
    expect(
      fold(created(BLANK_TASK_TITLE, [item('secondaryTags', null, tagId, { tagId })])).outcome,
    ).toBe('wait');
    // Any other change to a blank task counts as touching it.
    const moved = fold(created(), updated([item('priority', 2, 4)]));
    expect(moved.outcome).toBe('wait');
    expect(moved.payload.changedFields).toEqual(['title', 'statusId', 'priority']);
  });

  it('lists what changed after creation alongside what the task was created with', () => {
    const result = fold(
      created('Fix login'),
      updated([item('description', null, 'v1')]),
      updated([item('statusId', backlog.id, done.id)], { statusTo: done }),
    );
    expect(result.payload).toMatchObject({
      event: 'task.created',
      changedFields: ['title', 'statusId', 'priority', 'description'],
      statusTo: done,
    });
  });

  it('sends nothing for a task created and trashed or purged within the window', () => {
    const trashed = fold(created('Oops'), updated([item('trashed', false, true)]));
    expect(trashed.outcome).toBe('hold');
    // Restored, it is a new task again.
    expect(
      fold(
        created('Oops'),
        updated([item('trashed', false, true)]),
        updated([item('trashed', true, false)]),
      ).outcome,
    ).toBe('wait');
    expect(fold(created('Oops'), updated([item('trashed', false, true)]), purged).outcome).toBe(
      'drop',
    );
  });

  it('sends nothing when a status move is undone, and the rest when only part was', () => {
    const undone = fold(
      updated([item('statusId', backlog.id, done.id)], { statusTo: done }),
      updated([item('statusId', done.id, backlog.id)], { statusTo: backlog }),
    );
    expect(undone.outcome).toBe('hold');

    const partly = fold(
      updated([item('statusId', backlog.id, done.id)], { statusTo: done }),
      updated([item('priority', 2, 4)]),
      updated([item('statusId', done.id, backlog.id)], { statusTo: backlog }),
    );
    expect(partly.outcome).toBe('wait');
    expect(partly.payload.changedFields).toEqual(['priority']);
    expect(partly.payload).not.toHaveProperty('statusTo');
    expect(partly.payload.kind).toBe('updated');
  });

  it('takes the latest status move when it stands', () => {
    const result = fold(
      updated([item('title', 'A', 'B')]),
      updated([item('statusId', backlog.id, done.id)], { statusTo: done }),
    );
    expect(result.outcome).toBe('wait');
    expect(result.payload).toMatchObject({
      deliveryId,
      event: 'task.updated',
      kind: 'updated',
      changedFields: ['title', 'statusId'],
      statusTo: done,
    });
  });

  it('cancels a tag removed and added again, and a relation undone', () => {
    expect(
      fold(
        updated([item('secondaryTags', tagId, null, { tagId })]),
        updated([item('secondaryTags', null, tagId, { tagId })]),
      ).outcome,
    ).toBe('hold');
    expect(
      fold(
        updated([item('relations', null, otherTask, { relation: 'blocks' })]),
        updated([item('relations', otherTask, null, { relation: 'blocks' })]),
      ).outcome,
    ).toBe('hold');
    // A different relation to the same task is a real change.
    expect(
      fold(
        updated([item('relations', null, otherTask, { relation: 'blocks' })]),
        updated([item('relations', otherTask, null, { relation: 'relates_to' })]),
      ).outcome,
    ).toBe('wait');
  });

  it('wakes again when a held delivery changes for real', () => {
    const result = fold(
      updated([item('statusId', backlog.id, done.id)], { statusTo: done }),
      updated([item('statusId', done.id, backlog.id)], { statusTo: backlog }),
      updated([item('size', null, 3)]),
    );
    expect(result.outcome).toBe('wait');
    expect(result.payload.changedFields).toEqual(['size']);
  });

  it('leaves out a position left over from an undone move, but not an agent reorder', () => {
    const moved = fold(
      updated([item('statusId', backlog.id, done.id), item('position', 'a0', 'a5')], {
        statusTo: done,
      }),
      updated([item('statusId', done.id, backlog.id), item('position', 'a5', 'a1')], {
        statusTo: backlog,
      }),
    );
    expect(moved.outcome).toBe('hold');
    const reordered = fold([updated([item('position', 'a0', 'a1')]), agent]);
    expect(reordered.outcome).toBe('wait');
    expect(reordered.payload.kind).toBe('reordered');
  });

  it('names where a task ended up when it was trashed or restored', () => {
    expect(fold(updated([item('trashed', false, true)])).payload.kind).toBe('trashed');
    expect(
      fold(updated([item('trashed', false, true)]), updated([item('title', 'A', 'B')])).payload
        .kind,
    ).toBe('trashed');
    expect(
      fold(updated([item('trashed', true, false)]), updated([item('title', 'A', 'B')])).payload
        .kind,
    ).toBe('restored');
    expect(
      fold(
        updated([item('title', 'A', 'B')]),
        updated([item('trashed', false, true)]),
        updated([item('trashed', true, false)]),
      ).payload.kind,
    ).toBe('updated');
  });

  it('sends a purge at once, in place of the changes before it', () => {
    const result = fold(updated([item('title', 'A', 'B')]), purged);
    expect(result.outcome).toBe('now');
    expect(result.payload).toMatchObject({ deliveryId, event: 'task.deleted', kind: 'deleted' });
    expect(result.payload).not.toHaveProperty('changedFields');
    expect(fold(purged).outcome).toBe('now');
  });

  it('counts fields named without values as changed', () => {
    const result = fold({ ...updated([]), changedFields: ['title'], values: undefined });
    expect(result.outcome).toBe('wait');
    expect(result.payload.changedFields).toEqual(['title']);
  });

  it('keeps a person as the actor when an agent also changed the task', () => {
    const mixed = fold(updated([item('title', 'A', 'B')]), [updated([item('size', 1, 2)]), agent]);
    expect(mixed.payload.actor).toEqual({ kind: 'user', viaTokenName: null });
    const agentOnly = fold([updated([item('title', 'A', 'B')]), agent]);
    expect(agentOnly.payload.actor).toEqual({ kind: 'token', viaTokenName: 'Agent' });
  });
});

describe('structure', () => {
  const structure = (entityType: 'project' | 'status', kind: string, fields: string[]) =>
    ({
      event: 'structure.updated',
      workspaceId,
      projectId,
      projectKey: 'THR',
      entityType,
      kind,
      changedFields: fields,
    }) satisfies WebhookChange;

  it('names a structure notice after its first change and lists every field', () => {
    const result = fold(
      structure('project', 'created', ['project.name']),
      structure('status', 'updated', ['status.name']),
      structure('status', 'updated', ['status.name', 'status.color']),
    );
    expect(result.outcome).toBe('wait');
    expect(result.fold).toBeNull();
    expect(result.payload).toMatchObject({
      deliveryId,
      entityType: 'project',
      kind: 'created',
      changedFields: ['project.name', 'status.name', 'status.color'],
      occurredAt: '2026-11-22T10:02:00.000Z',
    });
    expect(result.payload).not.toHaveProperty('taskId');
  });

  it('merges a purge over anything and nothing over a purge', () => {
    const waiting = buildPayload(deliveryId, updated([]), user, 'THR', new Date());
    const deleted = buildPayload('x', purged, user, 'THR', new Date());
    expect(mergePayload(waiting, deleted)).toMatchObject({ deliveryId, event: 'task.deleted' });
    expect(mergePayload(deleted, waiting).event).toBe('task.deleted');
  });
});
