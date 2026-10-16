import { z } from 'zod';
import { type Color, colorSchema } from './colors';
import { txidResponseSchema } from './sync';

// Ported from Catch ADR 0016; ownership is a project, assignments are independent rows.
export const TAG_ICONS = [
  'tag',
  'briefcase',
  'house',
  'heart',
  'book-open',
  'graduation-cap',
  'lightbulb',
  'plane',
  'map-pin',
  'globe',
  'car',
  'bike',
  'train',
  'utensils',
  'coffee',
  'shopping-cart',
  'gift',
  'wallet',
  'landmark',
  'chart-no-axes-combined',
  'code',
  'laptop',
  'smartphone',
  'camera',
  'image',
  'music',
  'film',
  'gamepad-2',
  'palette',
  'paintbrush',
  'pen',
  'notebook',
  'calendar',
  'clock',
  'check',
  'list-todo',
  'target',
  'flag',
  'star',
  'sparkles',
  'rocket',
  'flask-conical',
  'wrench',
  'hammer',
  'key-round',
  'shield',
  'stethoscope',
  'pill',
  'dumbbell',
  'footprints',
  'leaf',
  'flower-2',
  'trees',
  'sun',
  'moon',
  'cloud',
  'paw-print',
  'baby',
  'users',
  'message-circle',
  'mail',
  'archive',
  'folder',
  'building-2',
] as const;

export const tagSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  name: z.string().trim().min(1).max(100),
  parentId: z.uuid().nullable(),
  icon: z.enum(TAG_ICONS).nullable(),
  color: colorSchema.nullable(),
});
export type Tag = z.infer<typeof tagSchema>;
export type TagIconName = (typeof TAG_ICONS)[number];
export const createTagSchema = tagSchema
  .omit({ workspaceId: true })
  .strict()
  .refine(
    (tag) => tag.parentId === null || (tag.color === null && tag.icon === null),
    'Only top-level tags can have an icon or color',
  );
export type CreateTag = z.infer<typeof createTagSchema>;
export const updateTagSchema = tagSchema
  .omit({ id: true, workspaceId: true, projectId: true })
  .partial()
  .strict();
export type UpdateTag = z.infer<typeof updateTagSchema>;

export const taskTagSchema = z.object({
  taskId: z.uuid(),
  tagId: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
});
export type TaskTag = z.infer<typeof taskTagSchema>;
export const taskTagKey = (row: Pick<TaskTag, 'taskId' | 'tagId'>) => `${row.taskId}/${row.tagId}`;

export const secondaryTagChangesSchema = z
  .array(z.object({ tagId: z.uuid(), present: z.boolean() }).strict())
  .min(1)
  .refine(
    (changes) => new Set(changes.map((change) => change.tagId)).size === changes.length,
    'Mention each secondary tag once',
  );
export type SecondaryTagChange = z.infer<typeof secondaryTagChangesSchema>[number];

/** Side-effect txids are present only for shapes that will actually stream the write. */
export const tagWriteResponseSchema = txidResponseSchema.extend({
  tasksTxid: z.number().optional(),
  secondaryTagsTxid: z.number().optional(),
});
export type TagWriteResponse = z.infer<typeof tagWriteResponseSchema>;

export function compareTags(a: Tag, b: Tag) {
  return a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The same validation runs optimistically and under the server's project tree lock. */
export function tagWriteIssue(candidate: Tag, tags: readonly Tag[]): string | null {
  if (candidate.parentId !== null) {
    if (!tags.some((tag) => tag.id === candidate.parentId && tag.projectId === candidate.projectId))
      return 'Parent tag not in this project';
    if (tagSubtreeIds(tags, candidate.id).has(candidate.parentId))
      return 'A tag cannot be moved into its own branch';
    if (candidate.color !== null || candidate.icon !== null)
      return 'Only top-level tags can have an icon or color';
  }
  if (
    candidate.color !== null &&
    tags.some(
      (tag) =>
        tag.projectId === candidate.projectId &&
        tag.id !== candidate.id &&
        tag.color === candidate.color,
    )
  )
    return 'That color is already linked to another tag';
  return null;
}

/** Iterative and defensive: very deep trees and a partial sync never recurse forever. */
export function tagPath(tags: readonly Tag[], id: string): Tag[] {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  const seen = new Set<string>();
  const path: Tag[] = [];
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path.reverse();
}

export function tagSubtreeIds(tags: readonly Tag[], id: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const tag of tags) {
    if (!tag.parentId) continue;
    const siblings = children.get(tag.parentId) ?? [];
    siblings.push(tag.id);
    children.set(tag.parentId, siblings);
  }
  const found = new Set<string>();
  const pending = [id];
  while (pending.length) {
    const next = pending.pop();
    if (!next || found.has(next)) continue;
    found.add(next);
    pending.push(...(children.get(next) ?? []));
  }
  return found;
}

export function tagTree(tags: readonly Tag[]): { tag: Tag; depth: number }[] {
  const children = new Map<string | null, Tag[]>();
  for (const tag of tags) {
    const siblings = children.get(tag.parentId) ?? [];
    siblings.push(tag);
    children.set(tag.parentId, siblings);
  }
  for (const siblings of children.values()) siblings.sort(compareTags);
  const present = new Set(tags.map((tag) => tag.id));
  const roots = tags
    .filter((tag) => tag.parentId === null || !present.has(tag.parentId))
    .sort(compareTags);
  const pending = [...roots].reverse().map((tag) => ({ tag, depth: 0 }));
  const rows: { tag: Tag; depth: number }[] = [];
  const seen = new Set<string>();
  while (pending.length) {
    const row = pending.pop();
    if (!row || seen.has(row.tag.id)) continue;
    seen.add(row.tag.id);
    rows.push(row);
    pending.push(
      ...[...(children.get(row.tag.id) ?? [])]
        .reverse()
        .map((tag) => ({ tag, depth: row.depth + 1 })),
    );
  }
  return rows;
}

/** Null during partial sync, on a corrupt cycle, or when the root has no color. */
export function taskTagColor(
  task: { primaryTagId: string | null; projectId: string },
  tags: readonly Tag[],
): Color | null {
  if (!task.primaryTagId) return null;
  const path = tagPath(
    tags.filter((tag) => tag.projectId === task.projectId),
    task.primaryTagId,
  );
  const root = path[0];
  return root?.parentId === null ? root.color : null;
}
