import { describe, expect, it } from 'vitest';
import {
  canonicalPair,
  createTaskRelationSchema,
  openBlockers,
  relationConflict,
  relationFromRole,
  relationRole,
  TASK_RELATION_ROLES,
} from './taskRelations';

const id = (n: number) => `0199a0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const [a, b, c] = [id(1), id(2), id(3)];

describe('task relations', () => {
  it('stores relates_to with the lower id first, and directed kinds as given', () => {
    expect(canonicalPair({ sourceTaskId: b, targetTaskId: a, kind: 'relates_to' })).toEqual({
      sourceTaskId: a,
      targetTaskId: b,
    });
    expect(canonicalPair({ sourceTaskId: b, targetTaskId: a, kind: 'blocks' })).toEqual({
      sourceTaskId: b,
      targetTaskId: a,
    });
  });

  it('parses a create, lower-casing ids and refusing self-links', () => {
    const parsed = createTaskRelationSchema.parse({
      id: id(9),
      sourceTaskId: b.toUpperCase(),
      targetTaskId: a,
      kind: 'relates_to',
    });
    expect(parsed).toMatchObject({ sourceTaskId: a, targetTaskId: b });
    expect(
      createTaskRelationSchema.safeParse({
        id: id(9),
        sourceTaskId: a,
        targetTaskId: a.toUpperCase(),
        kind: 'blocks',
      }).success,
    ).toBe(false);
  });

  it('round-trips every role through the stored row', () => {
    for (const role of TASK_RELATION_ROLES) {
      const row = relationFromRole(a, role, b);
      expect(relationRole(row, a)).toEqual({ role, otherTaskId: b });
    }
    expect(relationFromRole(a, 'blocked_by', b)).toEqual({
      kind: 'blocks',
      sourceTaskId: b,
      targetTaskId: a,
    });
    expect(relationRole({ sourceTaskId: b, targetTaskId: c, kind: 'blocks' }, a)).toBeNull();
  });

  it('refuses the same link twice and the reverse of a directed one', () => {
    const existing = [
      { sourceTaskId: b, targetTaskId: a, kind: 'blocks' as const },
      { sourceTaskId: a, targetTaskId: c, kind: 'relates_to' as const },
    ];
    expect(relationConflict(existing, { sourceTaskId: a, targetTaskId: b, kind: 'blocks' })).toBe(
      'reverse',
    );
    expect(relationConflict(existing, { sourceTaskId: b, targetTaskId: a, kind: 'blocks' })).toBe(
      'exists',
    );
    expect(
      relationConflict(existing, { sourceTaskId: c, targetTaskId: a, kind: 'relates_to' }),
    ).toBe('exists');
    expect(
      relationConflict(existing, { sourceTaskId: a, targetTaskId: b, kind: 'duplicates' }),
    ).toBeNull();
    expect(relationConflict([], { sourceTaskId: a, targetTaskId: a, kind: 'blocks' })).toBe('self');
  });

  it('counts only open, untrashed, known blockers', () => {
    const relations = [
      { sourceTaskId: b, targetTaskId: a, kind: 'blocks' as const },
      { sourceTaskId: c, targetTaskId: a, kind: 'blocks' as const },
      { sourceTaskId: id(4), targetTaskId: a, kind: 'blocks' as const },
      { sourceTaskId: id(5), targetTaskId: a, kind: 'duplicates' as const },
      { sourceTaskId: a, targetTaskId: b, kind: 'blocks' as const },
    ];
    const tasks = new Map([
      [b, { task: 'B', category: 'active' as const, trashed: false }],
      [c, { task: 'C', category: 'done' as const, trashed: false }],
      [id(4), { task: 'D', category: 'backlog' as const, trashed: true }],
      [id(5), { task: 'E', category: 'active' as const, trashed: false }],
    ]);
    expect(openBlockers(a, relations, (blocker) => tasks.get(blocker))).toEqual(['B']);
  });
});
