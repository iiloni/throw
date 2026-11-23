import {
  relationConflict,
  relationConflictMessage,
  relationFromRole,
  type TaskRelationRole,
} from '@throw/shared';
import { uuidv7 } from 'uuidv7';
import { taskRelationsCollection, tasksCollection, write } from './collections';

export class RelationError extends Error {}

/**
 * Links `taskId` to `otherTaskId`, offline too: “Blocked by” stores the other task as the
 * blocker. Refuses a self-link, a link already there and the reverse of a directed one, as
 * the server does. Returns the relation's id.
 */
export function addTaskRelation(taskId: string, role: TaskRelationRole, otherTaskId: string) {
  const task = tasksCollection.get(taskId);
  const other = tasksCollection.get(otherTaskId);
  if (!task || !other) throw new RelationError('Task not found');
  if (task.workspaceId !== other.workspaceId)
    throw new RelationError('Related tasks must share a workspace');
  const pair = relationFromRole(taskId, role, otherTaskId);
  const conflict = relationConflict([...taskRelationsCollection.values()], pair);
  if (conflict) throw new RelationError(relationConflictMessage[conflict]);
  const id = uuidv7();
  write(() =>
    taskRelationsCollection.insert({
      id,
      workspaceId: task.workspaceId,
      ...pair,
      // A placeholder until the server's time arrives.
      createdAt: new Date().toISOString(),
    }),
  );
  return id;
}

export function removeTaskRelation(id: string) {
  if (!taskRelationsCollection.has(id)) return;
  write(() => taskRelationsCollection.delete(id));
}
