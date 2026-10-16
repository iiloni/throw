import {
  type Tag,
  tagSchema,
  tagSubtreeIds,
  tagWriteIssue,
  taskTagKey,
  type UpdateTag,
  updateTagSchema,
} from '@throw/shared';
import { uuidv7 } from 'uuidv7';
import {
  projectsCollection,
  tagsCollection,
  tasksCollection,
  taskTagsCollection,
  write,
} from './collections';

export function requireTag(id: string, projectId: string) {
  const tag = tagsCollection.get(id);
  if (!tag || tag.projectId !== projectId) throw new Error('Tag not in this project');
  return tag;
}
function validate(tag: Tag) {
  const issue = tagWriteIssue(
    tag,
    [...tagsCollection.values()].filter((row) => row.projectId === tag.projectId),
  );
  if (issue) throw new Error(issue);
}
export function createTag(
  projectId: string,
  fields: Pick<Tag, 'name'> & Partial<Pick<Tag, 'parentId' | 'icon' | 'color'>>,
) {
  const project = projectsCollection.get(projectId);
  if (!project) throw new Error('Project not found');
  const tag = tagSchema.parse({
    id: uuidv7(),
    workspaceId: project.workspaceId,
    projectId,
    parentId: null,
    icon: null,
    color: null,
    ...fields,
  });
  validate(tag);
  write(() => tagsCollection.insert(tag));
  return tag.id;
}
export function updateTag(id: string, changes: UpdateTag) {
  const tag = tagsCollection.get(id);
  if (!tag) throw new Error('Tag not found');
  const valid = updateTagSchema.parse(changes);
  validate({ ...tag, ...valid });
  write(() => tagsCollection.update(id, (draft) => Object.assign(draft, valid)));
}
export function deleteTag(id: string) {
  const tag = tagsCollection.get(id);
  if (!tag) return;
  const removed = tagSubtreeIds(
    [...tagsCollection.values()].filter((row) => row.projectId === tag.projectId),
    id,
  );
  write(() => {
    // Only hierarchy deletes are sent; cleanup is recomputed against current server rows.
    for (const task of tasksCollection.values())
      if (task.primaryTagId && removed.has(task.primaryTagId))
        tasksCollection.update(task.id, (draft) => {
          draft.primaryTagId = null;
        });
    for (const row of taskTagsCollection.values())
      if (removed.has(row.tagId)) taskTagsCollection.delete(taskTagKey(row));
    for (const tagId of removed) if (tagsCollection.has(tagId)) tagsCollection.delete(tagId);
  });
}
export function setPrimaryTag(taskId: string, tagId: string | null) {
  const task = tasksCollection.get(taskId);
  if (!task) throw new Error('Task not found');
  if (tagId !== null) requireTag(tagId, task.projectId);
  if (task.primaryTagId === tagId) return;
  write(() =>
    tasksCollection.update(taskId, (draft) => {
      draft.primaryTagId = tagId;
    }),
  );
}
export function setSecondaryTag(taskId: string, tagId: string, present: boolean) {
  const task = tasksCollection.get(taskId);
  if (!task) throw new Error('Task not found');
  requireTag(tagId, task.projectId);
  const row = { taskId, tagId, projectId: task.projectId, workspaceId: task.workspaceId };
  const key = taskTagKey(row);
  if (taskTagsCollection.has(key) === present) return;
  write(() => {
    if (present) taskTagsCollection.insert(row);
    else taskTagsCollection.delete(key);
  });
}
