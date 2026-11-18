import type { ActivityEntry, Comment } from '@throw/shared';
import { describe, expect, it } from 'vitest';
import { taskTimeline } from './timeline';

const id = (n: number) => `0199a0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const at = (second: number) => `2026-10-14T09:30:${String(second).padStart(2, '0')}.000Z`;

const scope = { workspaceId: id(900), projectId: id(901), taskId: id(902), userId: 'user' };

function entry(n: number, createdAt: string, changes = 1): ActivityEntry {
  return {
    ...scope,
    id: id(n),
    kind: 'updated',
    changes: Array.from({ length: changes }, () => ({
      field: 'title',
      previous: 'a',
      requested: 'b',
      applied: true,
    })),
    createdAt,
  };
}

function comment(n: number, createdAt: string | null): Comment {
  return {
    ...scope,
    id: id(n),
    body: [{ type: 'paragraph' }],
    createdAt,
    editedAt: null,
  };
}

const order = (items: ReturnType<typeof taskTimeline>) =>
  items.map((item) => `${item.type}:${Number(item.id.slice(-3))}`);

describe('a task’s timeline', () => {
  it('merges entries and comments by the server’s time, then id', () => {
    const items = taskTimeline(
      [entry(3, at(5)), entry(1, at(1)), entry(2, at(3))],
      [comment(5, at(3)), comment(4, at(2))],
    );
    // An entry and a comment at the same time are ordered by id.
    expect(order(items)).toEqual(['entry:1', 'comment:4', 'entry:2', 'comment:5', 'entry:3']);
  });

  it('puts comments the server has not received last, in the order they were written', () => {
    // Written on this device before a later entry synced from another device: the server will
    // date them after it.
    const items = taskTimeline(
      [entry(1, at(1)), entry(9, at(30))],
      [comment(7, null), comment(2, at(2)), comment(5, null)],
    );
    expect(order(items)).toEqual(['entry:1', 'comment:2', 'entry:9', 'comment:5', 'comment:7']);
    expect(items.map((item) => item.type === 'comment' && item.pending)).toEqual([
      false,
      false,
      false,
      true,
      true,
    ]);
  });

  it('leaves out entries that name no field', () => {
    expect(order(taskTimeline([entry(1, at(1), 0), entry(2, at(2))], []))).toEqual(['entry:2']);
  });

  it('keeps an item whose field the device does not know yet', () => {
    const tagged = entry(1, at(1));
    // As a newer server might write it; the device must not drop or reorder it.
    tagged.changes = [{ ...tagged.changes[0]!, field: 'tags' as 'title' }];
    expect(order(taskTimeline([tagged], []))).toEqual(['entry:1']);
  });
});
