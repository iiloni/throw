import { z } from 'zod';
import { readPreference, usePersistentState, writePreference } from '@/lib/storage';

/**
 * One device-wide set of collapsed tag branches, shared by every tag tree (the task pane's
 * pickers, tag settings and the board's filters). Tag ids are UUIDs, so trees of different
 * projects and workspaces never collide in it.
 */
export const COLLAPSED_TAGS_KEY = 'throw-tag-tree-collapsed';
const collapsedTagsSchema = z.array(z.string());

/**
 * How many collapsed branches a device remembers. Ids of deleted tags are never pruned, since
 * one tree cannot tell a deleted tag from another project's; the oldest choices drop first.
 */
export const COLLAPSED_TAGS_LIMIT = 500;

/** Collapses an expanded branch or expands a collapsed one, remembered across reloads. */
function toggleCollapsedTag(id: string) {
  const ids = readPreference(COLLAPSED_TAGS_KEY, collapsedTagsSchema, []);
  const next = ids.filter((stored) => stored !== id);
  if (next.length === ids.length) next.push(id);
  writePreference(COLLAPSED_TAGS_KEY, next.slice(-COLLAPSED_TAGS_LIMIT));
}

/** The tag branches collapsed on this device; mounted trees follow each other's changes. */
export function useCollapsedTags(): [ReadonlySet<string>, (id: string) => void] {
  const [ids] = usePersistentState(COLLAPSED_TAGS_KEY, collapsedTagsSchema, []);
  return [new Set(ids), toggleCollapsedTag];
}
