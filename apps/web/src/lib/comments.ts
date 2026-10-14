import { type CommentBody, commentBodySchema } from '@throw/shared';
import { uuidv7 } from 'uuidv7';
import { commentsCollection, signedInUserId, tasksCollection, write } from './collections';

const sameBody = (a: CommentBody, b: CommentBody) => JSON.stringify(a) === JSON.stringify(b);

function requireOwnComment(id: string) {
  const comment = commentsCollection.get(id);
  if (!comment) throw new Error('Comment not found');
  if (comment.userId === null || comment.userId !== signedInUserId)
    throw new Error('Only the author can change a comment');
  return comment;
}

/**
 * Writes a comment on a task, offline too. It has no time until the server receives it, and
 * the timeline shows it last until then. Returns its id.
 */
export function addComment(taskId: string, body: CommentBody) {
  const task = tasksCollection.get(taskId);
  if (!task) throw new Error('Task not found');
  const valid = commentBodySchema.parse(body);
  const id = uuidv7();
  write(() =>
    commentsCollection.insert({
      id,
      workspaceId: task.workspaceId,
      projectId: task.projectId,
      taskId,
      // The author the server will set.
      userId: signedInUserId,
      body: valid,
      createdAt: null,
      editedAt: null,
    }),
  );
  return id;
}

/** Replaces a comment's body. Edits apply in the order they reach the server. */
export function editComment(id: string, body: CommentBody) {
  const comment = requireOwnComment(id);
  const valid = commentBodySchema.parse(body);
  if (sameBody(comment.body, valid)) return;
  write(() =>
    commentsCollection.update(id, (draft) => {
      draft.body = valid;
      // A placeholder until the server's time arrives.
      draft.editedAt = new Date().toISOString();
    }),
  );
}

export function deleteComment(id: string) {
  requireOwnComment(id);
  write(() => commentsCollection.delete(id));
}
