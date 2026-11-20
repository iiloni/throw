import { createHash } from 'node:crypto';
import {
  createTaskSchema,
  hasCommentText,
  type McpInput,
  type McpOutput,
  positionBetween,
  type TaskChanges,
} from '@throw/shared';
import { uuidv7 } from 'uuidv7';
import { createComment } from '../lib/commentWrites';
import type { McpActor } from '../lib/mcpTokens';
import { createTask, updateTask } from '../lib/taskWrites';
import { markdownToBlocks } from './markdown';
import { exposeChanges, findTask, requireProject, requireTask, ToolError } from './read';

function writeId(actor: McpActor, operationId: string, purpose: string) {
  // Reuse the operation's UUIDv7 timestamp and namespace the rest to this credential.
  // An MCP client cannot use a chosen UUID to collide with a device's operation.
  const canonicalId = operationId.toLowerCase();
  const time = canonicalId.replaceAll('-', '').slice(0, 12);
  const hash = createHash('sha256')
    .update(`${actor.tokenId}/${canonicalId}/${purpose}`)
    .digest('hex');
  const variant = ((Number.parseInt(hash[3]!, 16) & 3) | 8).toString(16);
  return `${time.slice(0, 8)}-${time.slice(8)}-7${hash.slice(0, 3)}-${variant}${hash.slice(4, 7)}-${hash.slice(7, 19)}`;
}

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
