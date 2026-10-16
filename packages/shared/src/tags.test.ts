import { describe, expect, it } from 'vitest';
import {
  createTagSchema,
  type Tag,
  tagPath,
  tagSubtreeIds,
  tagTree,
  tagWriteIssue,
  taskTagColor,
  taskTagKey,
  updateTagSchema,
} from './tags';
import { createTaskSchema, updateTaskSchema } from './tasks';

const id = (n: number) => `0199a0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const tag = (n: number, fields: Partial<Tag> = {}): Tag => ({
  id: id(n),
  workspaceId: id(90),
  projectId: id(91),
  name: `Tag ${n}`,
  parentId: null,
  icon: null,
  color: null,
  ...fields,
});
const root = tag(1, { name: 'Product', color: 'teal', icon: 'rocket' });
const child = tag(2, { name: 'Mobile', parentId: root.id });
const leaf = tag(3, { name: 'Android', parentId: child.id });
const tags = [root, child, leaf];

describe('tag contracts', () => {
  it('validates trimmed names, root appearance and immutable project ownership', () => {
    const { workspaceId: _workspaceId, ...create } = root;
    expect(createTagSchema.parse({ ...create, name: '  Product  ' }).name).toBe('Product');
    expect(createTagSchema.safeParse({ ...create, parentId: root.id, color: 'red' }).success).toBe(
      false,
    );
    expect(updateTagSchema.safeParse({ projectId: id(99) }).success).toBe(false);
    expect(updateTagSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(updateTagSchema.safeParse({ name: 'x'.repeat(101) }).success).toBe(false);
    expect(updateTagSchema.safeParse({ color: 'made-up' }).success).toBe(false);
  });
  it('keeps earlier task creates valid and deduplicates initial secondary tags', () => {
    const create = {
      id: id(20),
      projectId: root.projectId,
      title: '',
      description: null,
      descriptionVersion: null,
      parentId: null,
      position: 'a0',
    };
    expect(createTaskSchema.parse(create)).toMatchObject({
      primaryTagId: null,
      secondaryTagIds: [],
    });
    expect(
      createTaskSchema.parse({ ...create, secondaryTagIds: [root.id, root.id] }).secondaryTagIds,
    ).toEqual([root.id]);
  });
  it('requires before/after primaries and independent, unambiguous secondary operations', () => {
    expect(
      updateTaskSchema.safeParse({ changeId: id(50), changes: { primaryTagId: root.id } }).success,
    ).toBe(false);
    expect(
      updateTaskSchema.parse({
        changeId: id(50),
        changes: {
          primaryTagId: { before: null, after: child.id },
          secondaryTags: [
            { tagId: root.id, present: true },
            { tagId: leaf.id, present: true },
          ],
        },
      }).changes.secondaryTags,
    ).toHaveLength(2);
    expect(
      updateTaskSchema.safeParse({
        changeId: id(50),
        changes: {
          secondaryTags: [
            { tagId: root.id, present: true },
            { tagId: root.id, present: false },
          ],
        },
      }).success,
    ).toBe(false);
    expect(taskTagKey({ taskId: id(20), tagId: child.id })).toBe(`${id(20)}/${child.id}`);
  });
});
describe('tree operations ported from Catch', () => {
  it('refuses self/descendant moves, cross-project parents, child appearance and duplicate colors', () => {
    expect(tagWriteIssue({ ...root, parentId: leaf.id, color: null, icon: null }, tags)).toMatch(
      /own branch/,
    );
    expect(tagWriteIssue({ ...child, parentId: child.id }, tags)).toMatch(/own branch/);
    expect(tagWriteIssue({ ...child, parentId: id(80) }, tags)).toMatch(/Parent/);
    expect(tagWriteIssue({ ...child, projectId: id(80) }, tags)).toMatch(/Parent/);
    expect(tagWriteIssue({ ...child, color: 'red' }, tags)).toMatch(/top-level/);
    expect(tagWriteIssue(tag(4, { color: 'teal' }), tags)).toMatch(/already linked/);
    expect(tagWriteIssue(tag(4, { name: root.name }), tags)).toBeNull();
    expect(tagWriteIssue(tag(4, { projectId: id(80), color: 'teal' }), tags)).toBeNull();
  });
  it('sorts siblings by name then id, and finds branches and paths', () => {
    expect(
      tagTree([leaf, tag(5, { name: root.name }), root, child]).map(({ tag }) => tag.id),
    ).toEqual([root.id, child.id, leaf.id, id(5)]);
    expect([...tagSubtreeIds(tags, child.id)]).toEqual([child.id, leaf.id]);
    expect(tagPath(tags, leaf.id).map((tag) => tag.name)).toEqual(['Product', 'Mobile', 'Android']);
  });
  it('handles deep trees iteratively and partial/cyclic snapshots without looping', () => {
    const deep = Array.from({ length: 12000 }, (_, n) =>
      tag(n + 1, { parentId: n ? id(n) : null }),
    );
    expect(tagPath(deep, id(12000))).toHaveLength(12000);
    expect(tagTree(deep)).toHaveLength(12000);
    expect(tagSubtreeIds(deep, id(1)).size).toBe(12000);
    expect(tagPath([{ ...root, parentId: child.id }, child], child.id)).toHaveLength(2);
    expect(tagTree([child, leaf])).toHaveLength(2);
  });
});
describe('board colour helper', () => {
  const task = { primaryTagId: leaf.id, projectId: root.projectId };
  it('derives from the root and follows recolors and branch moves without rewriting tasks', () => {
    expect(taskTagColor(task, tags)).toBe('teal');
    expect(taskTagColor(task, [{ ...root, color: 'amber' }, child, leaf])).toBe('amber');
    const other = tag(4, { color: 'red' });
    expect(taskTagColor(task, [root, { ...child, parentId: other.id }, leaf, other])).toBe('red');
  });
  it('returns no color for untagged, missing, foreign-project, incomplete and cyclic paths', () => {
    expect(taskTagColor({ ...task, primaryTagId: null }, tags)).toBeNull();
    expect(taskTagColor(task, [child, leaf])).toBeNull();
    expect(taskTagColor(task, [{ ...root, parentId: leaf.id }, child, leaf])).toBeNull();
    expect(taskTagColor({ ...task, projectId: id(99) }, tags)).toBeNull();
    expect(
      taskTagColor(
        task,
        tags.map((tag) => ({ ...tag, color: null })),
      ),
    ).toBeNull();
  });
});
