import {
  createTaskRelationSchema,
  createTaskSchema,
  hasCommentText,
  type McpInput,
  type McpOutput,
  positionBetween,
  relationConflictMessage,
  relationFromRole,
  type TaskChanges,
} from '@throw/shared';
import { uuidv7 } from 'uuidv7';
import { createComment } from '../lib/commentWrites';
import type { McpActor } from '../lib/mcpTokens';
import {
  createTaskRelation,
  deleteTaskRelation,
  findTaskRelation,
} from '../lib/taskRelationWrites';
import { createTask, updateTask } from '../lib/taskWrites';
import { markdownToBlocks } from './markdown';
import {
  exposeChanges,
  findTask,
  requireProject,
  requireTask,
  ToolError,
  taskRelationsOf,
} from './read';

import { writeId } from './writeId';

export async function createTaskTool(
  actor: McpActor,
  input: McpInput<'create_task'>,
): Promise<McpOutput<'create_task'>> {
  const operationId = input.operationId ?? uuidv7();
  const id = writeId(actor, operationId, 'task');
  await requireProject(actor, input.projectId);
  const parent = input.parent ? await requireTask(actor, input.parent) : undefined;
  const document = input.description === undefined ? null : markdownToBlocks(input.description);
  const result = await createTask(
    actor,
    createTaskSchema.parse({
      id,
      projectId: input.projectId,
      title: input.title,
      position: positionBetween(null, null),
      parentId: parent?.id ?? null,
      description: document?.length ? document : null,
      descriptionVersion: document?.length ? writeId(actor, operationId, 'description') : null,
      statusId: input.statusId,
      priority: input.priority,
      size: input.size,
      primaryTagId: input.primaryTagId,
      secondaryTagIds: input.secondaryTagIds,
    }),
  );
  if (result === 'not-found') throw new ToolError('Project or parent not found.');
  if (result === 'bad-parent')
    throw new ToolError('A subtask needs a top-level parent in its project.');
  if (result === 'taken') throw new ToolError('That operation ID is already in use.');
  const task = await requireTask(actor, id);
  return { task, operationId, changes: exposeChanges(result.changes) };
}

async function writeUpdate(
  actor: McpActor,
  reference: string,
  operationId: string,
  changes: TaskChanges,
  move?: Parameters<typeof updateTask>[3],
): Promise<McpOutput<'update_task'>> {
  const task = await requireTask(actor, reference);
  const result = await updateTask(
    actor,
    task.id,
    { changeId: writeId(actor, operationId, 'update'), changes },
    move,
  );
  if (result === 'not-found') throw new ToolError('Task not found.');
  if (result === 'taken') throw new ToolError('That operation ID is already in use.');
  return { task, operationId, changes: exposeChanges(result.changes) };
}

export function updateTaskTool(actor: McpActor, input: McpInput<'update_task'>) {
  const { description, ...changes } = input.changes;
  const operationId = input.operationId ?? uuidv7();
  return writeUpdate(actor, input.task, operationId, {
    ...changes,
    ...(description
      ? {
          description: {
            before: description.before,
            after: {
              version: writeId(actor, operationId, 'description'),
              document: description.after === null ? null : markdownToBlocks(description.after),
            },
          },
        }
      : {}),
  });
}

export async function moveTaskTool(actor: McpActor, input: McpInput<'move_task'>) {
  const neighbor = input.placement ? await findTask(actor, input.placement.neighbor) : undefined;
  return writeUpdate(
    actor,
    input.task,
    input.operationId ?? uuidv7(),
    {
      ...(input.statusId
        ? { statusId: { before: input.before.statusId, after: input.statusId } }
        : {}),
    },
    {
      before: input.before,
      relative: input.placement
        ? neighbor
          ? { side: input.placement.side, neighborId: neighbor.id }
          : null
        : undefined,
    },
  );
}

export function setTaskTagsTool(actor: McpActor, input: McpInput<'set_task_tags'>) {
  return writeUpdate(actor, input.task, input.operationId ?? uuidv7(), {
    primaryTagId: input.primaryTagId,
    secondaryTags: input.secondaryTags,
  });
}

export async function addCommentTool(
  actor: McpActor,
  input: McpInput<'add_comment'>,
): Promise<McpOutput<'add_comment'>> {
  const task = await requireTask(actor, input.task);
  const operationId = input.operationId ?? uuidv7();
  const commentId = writeId(actor, operationId, 'comment');
  const body = markdownToBlocks(input.body);
  if (!hasCommentText(body)) throw new ToolError('Write some text for the comment.');
  const result = await createComment(actor, { id: commentId, taskId: task.id, body });
  if (result === 'not-found') throw new ToolError('Task not found.');
  if (result === 'taken') throw new ToolError('That operation ID is already in use.');
  return { task, commentId, operationId };
}

async function relationOf(actor: McpActor, task: { id: string }, relationId: string) {
  const { relations } = await taskRelationsOf(actor, task.id);
  const relation = relations.find((row) => row.id === relationId);
  if (!relation) throw new ToolError('Relation not found.');
  return relation;
}

export async function addTaskRelationTool(
  actor: McpActor,
  input: McpInput<'add_task_relation'>,
): Promise<McpOutput<'add_task_relation'>> {
  const operationId = input.operationId ?? uuidv7();
  const [task, other] = await Promise.all([
    requireTask(actor, input.task),
    requireTask(actor, input.other),
  ]);
  if (task.id === other.id) throw new ToolError(relationConflictMessage.self);
  const id = writeId(actor, operationId, 'relation');
  const result = await createTaskRelation(
    actor,
    createTaskRelationSchema.parse({ id, ...relationFromRole(task.id, input.relation, other.id) }),
  );
  if (result === 'not-found') throw new ToolError('Task not found.');
  if (result === 'other-workspace') throw new ToolError('Related tasks must share a workspace.');
  if (result === 'taken') throw new ToolError('That operation ID is already in use.');
  if (result === 'reverse')
    throw new ToolError(
      `${relationConflictMessage.reverse}. Remove it first if this direction is the right one.`,
    );
  return {
    operationId,
    outcome: result.relation.id === id ? 'added' : 'existing',
    relation: await relationOf(actor, task, result.relation.id),
  };
}

export async function removeTaskRelationTool(
  actor: McpActor,
  input: McpInput<'remove_task_relation'>,
): Promise<McpOutput<'remove_task_relation'>> {
  const operationId = input.operationId ?? uuidv7();
  let relationId = input.relationId ?? null;
  if (!relationId) {
    const [task, other] = await Promise.all([
      requireTask(actor, input.task!),
      requireTask(actor, input.other!),
    ]);
    relationId = await findTaskRelation(
      actor,
      relationFromRole(task.id, input.relation!, other.id),
    );
  }
  const txid = relationId ? await deleteTaskRelation(actor, relationId) : null;
  return { operationId, outcome: txid === null ? 'absent' : 'removed', relationId };
}
