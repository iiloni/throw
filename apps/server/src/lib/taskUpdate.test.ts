import type { StatusCategory } from '@throw/shared';
import { describe, expect, it } from 'vitest';
import { planTaskUpdate, type TaskState, type UpdateContext } from './taskUpdate';

const id = (n: number) => `0199a0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const BACKLOG = id(1);
const DOING = id(2);
const DONE = id(3);
const PARENT = id(10);

const statuses = new Map<string, { name: string; category: StatusCategory }>([
  [BACKLOG, { name: 'Backlog', category: 'backlog' }],
  [DOING, { name: 'Doing', category: 'active' }],
  [DONE, { name: 'Done', category: 'done' }],
]);
const context: UpdateContext = { statuses, parentAllowed: true };

const current: TaskState = {
  title: 'Server title',
  primaryTagId: null,
  descriptionVersion: id(20),
  statusId: BACKLOG,
  priority: 3,
  parentId: null,
  position: 'a0',
  trashed: false,
};

describe('the conflict rule', () => {
  it('applies a field whose before value is still the server value', () => {
    const plan = planTaskUpdate(
      current,
      { title: { before: 'Server title', after: 'New' } },
      context,
    );
    expect(plan.set).toEqual({ title: 'New' });
    expect(plan.refused).toEqual([]);
    expect(plan.items).toEqual([
      { field: 'title', previous: 'Server title', requested: 'New', applied: true },
    ]);
  });

  it('refuses a stale field and applies a fresh one in the same write', () => {
    const plan = planTaskUpdate(
      current,
      {
        title: { before: 'What this device saw', after: 'Offline title' },
        priority: { before: 3, after: 1 },
      },
      context,
    );
    expect(plan.set).toEqual({ priority: 1 });
    expect(plan.refused).toEqual([{ field: 'title', reason: 'stale' }]);
    expect(plan.items).toContainEqual({
      field: 'title',
      previous: 'Server title',
      requested: 'Offline title',
      applied: false,
      reason: 'stale',
    });
  });

  it('counts a field already at the wanted value as applied, changing nothing', () => {
    const plan = planTaskUpdate(
      { ...current, statusId: DONE },
      { statusId: { before: BACKLOG, after: DONE } },
      context,
    );
    expect(plan.set).toEqual({});
    expect(plan.refused).toEqual([]);
    expect(plan.items).toEqual([
      {
        field: 'statusId',
        previous: DONE,
        requested: DONE,
        previousName: 'Done',
        requestedName: 'Done',
        applied: true,
      },
    ]);
  });

  it('refuses a status that was deleted, and never substitutes one', () => {
    const plan = planTaskUpdate(current, { statusId: { before: BACKLOG, after: id(99) } }, context);
    expect(plan.set).toEqual({});
    expect(plan.refused).toEqual([{ field: 'statusId', reason: 'invalid' }]);
    expect(plan.items[0]).toMatchObject({ previousName: 'Backlog', requestedName: null });
  });

  it('reports a stale status as stale even when it is also invalid', () => {
    const plan = planTaskUpdate(current, { statusId: { before: DOING, after: id(99) } }, context);
    expect(plan.refused).toEqual([{ field: 'statusId', reason: 'stale' }]);
  });

  it('refuses a parent that would nest subtasks two deep', () => {
    const plan = planTaskUpdate(
      current,
      { parentId: { before: null, after: PARENT } },
      { ...context, parentAllowed: false },
    );
    expect(plan.refused).toEqual([{ field: 'parentId', reason: 'invalid' }]);
    const leaving = planTaskUpdate(
      { ...current, parentId: PARENT },
      { parentId: { before: PARENT, after: null } },
      { ...context, parentAllowed: false },
    );
    expect(leaving.set).toEqual({ parentId: null });
  });

  it('compares a description by version and keeps a refused document in the log', () => {
    const document = [{ type: 'paragraph', content: 'Written offline' }];
    const applied = planTaskUpdate(
      current,
      { description: { before: id(20), after: { version: id(21), document } } },
      context,
    );
    expect(applied.set).toEqual({ description: document, descriptionVersion: id(21) });
    expect(applied.items[0]).not.toHaveProperty('rejectedDocument');

    const refused = planTaskUpdate(
      current,
      { description: { before: id(19), after: { version: id(21), document } } },
      context,
    );
    expect(refused.set).toEqual({});
    expect(refused.items[0]).toMatchObject({
      field: 'description',
      previous: id(20),
      requested: id(21),
      applied: false,
      reason: 'stale',
      rejectedDocument: document,
    });
  });

  it('compares the trash by the task’s own state', () => {
    const trash = planTaskUpdate(current, { trashed: { before: false, after: true } }, context);
    expect(trash.trashed).toBe(true);
    const restore = planTaskUpdate(current, { trashed: { before: true, after: false } }, context);
    expect(restore.trashed).toBeUndefined();
    expect(restore.refused).toEqual([]);
    const stale = planTaskUpdate(
      { ...current, trashed: true },
      { trashed: { before: true, after: false }, title: { before: 'Server title', after: 'x' } },
      context,
    );
    expect(stale.trashed).toBe(false);
    expect(stale.set).toEqual({ title: 'x' });
  });

  it('applies a position only where it was computed, after the rest of the write', () => {
    const move = planTaskUpdate(
      current,
      {
        statusId: { before: BACKLOG, after: DOING },
        priority: { before: 3, after: 1 },
        position: { after: 'a5', statusId: DOING, priority: 1, parentId: null },
      },
      context,
    );
    expect(move.set).toEqual({ statusId: DOING, priority: 1, position: 'a5' });

    // The status was refused, so the task is not where the position was computed for.
    const elsewhere = planTaskUpdate(
      { ...current, statusId: DONE },
      {
        statusId: { before: BACKLOG, after: DOING },
        position: { after: 'a5', statusId: DOING, priority: 3, parentId: null },
      },
      context,
    );
    expect(elsewhere.set).toEqual({});
    expect(elsewhere.refused).toEqual([{ field: 'statusId', reason: 'stale' }]);
  });

  it('never records or reports a position', () => {
    const ignored = planTaskUpdate(
      current,
      { position: { after: 'a5', statusId: DOING, priority: 3, parentId: null } },
      context,
    );
    expect(ignored).toEqual({ set: {}, items: [], refused: [] });
    const applied = planTaskUpdate(
      current,
      { position: { after: 'a5', statusId: BACKLOG, priority: 3, parentId: null } },
      context,
    );
    expect(applied).toEqual({ set: { position: 'a5' }, items: [], refused: [] });
  });

  it('holds a chain of offline edits together: a refused first edit refuses the next', () => {
    const server = { ...current, title: 'Changed elsewhere' };
    const first = planTaskUpdate(
      server,
      { title: { before: 'Server title', after: 'B' } },
      context,
    );
    const second = planTaskUpdate(server, { title: { before: 'B', after: 'C' } }, context);
    expect(first.refused).toEqual([{ field: 'title', reason: 'stale' }]);
    expect(second.refused).toEqual([{ field: 'title', reason: 'stale' }]);
  });
});

it('primary tags compare before values, snapshot names, and refuse missing tags without substitution', () => {
  const tags = new Map([
    [id(30), { name: 'Mobile' }],
    [id(31), { name: 'Desktop' }],
  ]);
  const state = { ...current, primaryTagId: id(30) };
  const changed = planTaskUpdate(
    state,
    { primaryTagId: { before: id(30), after: id(31) } },
    { ...context, tags },
  );
  expect(changed.set).toEqual({ primaryTagId: id(31) });
  expect(changed.items[0]).toMatchObject({
    previousName: 'Mobile',
    requestedName: 'Desktop',
    applied: true,
  });
  expect(
    planTaskUpdate(state, { primaryTagId: { before: null, after: id(90) } }, { ...context, tags })
      .refused,
  ).toEqual([{ field: 'primaryTagId', reason: 'stale' }]);
  expect(
    planTaskUpdate(state, { primaryTagId: { before: id(30), after: id(90) } }, { ...context, tags })
      .refused,
  ).toEqual([{ field: 'primaryTagId', reason: 'invalid' }]);
  expect(
    planTaskUpdate(state, { primaryTagId: { before: id(30), after: null } }, { ...context, tags })
      .set,
  ).toEqual({ primaryTagId: null });
});
