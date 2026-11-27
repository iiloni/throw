import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { changeCursorErrorSchema, mcpTools } from '@throw/shared';
import type { z } from 'zod';
import { addGithubLink, LinkError, removeGithubLink } from '../github/manualLinks';
import { listReleases, setReleaseBinding } from '../github/releases';
import type { McpActor } from '../lib/mcpTokens';
import { StarterStatusIdTaken } from '../lib/projectWrites';
import { StatusIdTaken } from '../lib/statusWrites';
import { TagError } from '../lib/tagWrites';
import { InvalidChangeCursor, listChanges } from './listChanges';
import { MarkdownError } from './markdown';
import {
  getTask,
  listProjects,
  listStatuses,
  listTags,
  listTasks,
  listWorkspaces,
  requireTask,
  ToolError,
} from './read';
import {
  createProjectTool,
  createStatusTool,
  createTagTool,
  moveProjectTool,
  moveStatusTool,
  moveTagTool,
  updateProjectTool,
  updateStatusTool,
  updateTagTool,
} from './structure';
import {
  addCommentTool,
  addTaskRelationTool,
  createTaskTool,
  moveTaskTool,
  removeTaskRelationTool,
  setTaskTagsTool,
  updateTaskTool,
} from './write';

export function throwMcpServer(actor: McpActor) {
  const server = new McpServer({ name: 'Throw', version: '1.0.0' });

  function register<Input extends z.ZodObject, Output extends z.ZodObject>(
    name: keyof typeof mcpTools,
    contract: { input: Input; output: Output },
    description: string,
    handler: (actor: McpActor, input: z.output<Input>) => Promise<z.input<Output>>,
    readOnly = false,
  ) {
    const inputSchema: z.ZodObject = contract.input;
    const outputSchema: z.ZodObject = contract.output;
    server.registerTool(
      name,
      {
        description,
        inputSchema,
        outputSchema,
        annotations: {
          readOnlyHint: readOnly,
          idempotentHint:
            readOnly ||
            name.endsWith('_github') ||
            name.endsWith('_task_release') ||
            name.endsWith('_project') ||
            name.endsWith('_status') ||
            name.endsWith('_tag') ||
            name.endsWith('_task_relation'),
          openWorldHint: false,
          destructiveHint:
            name.startsWith('update_') ||
            name === 'set_task_tags' ||
            name === 'remove_task_relation' ||
            name === 'unlink_github' ||
            name === 'unbind_task_release',
        },
      },
      async (args: unknown): Promise<CallToolResult> => {
        try {
          const result = await handler(actor, contract.input.parse(args));
          const structuredContent = outputSchema.parse(result);
          return {
            structuredContent,
            content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
          };
        } catch (caught) {
          if (caught instanceof InvalidChangeCursor) {
            const error = changeCursorErrorSchema.parse({
              code: 'cursor_invalid',
              message: caught.message,
              cursor: caught.cursor,
            });
            return {
              isError: true,
              structuredContent: error,
              content: [{ type: 'text', text: JSON.stringify(error) }],
            };
          }
          const error =
            caught instanceof StarterStatusIdTaken || caught instanceof StatusIdTaken
              ? new ToolError('Status ID is already in use.')
              : caught;
          const expected =
            error instanceof LinkError ||
            error instanceof ToolError ||
            error instanceof MarkdownError ||
            error instanceof TagError;
          if (!expected) console.error(`Throw MCP tool ${name} failed.`);
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: expected ? error.message : 'Throw could not complete the tool call.',
              },
            ],
          };
        }
      },
    );
  }

  register(
    'list_changes',
    mcpTools.list_changes,
    'Follow task, comment and board structure changes in this workspace. Start with list_changes({}) to get a cursor and no changes, then read the board with list_tasks or get_task. Changes that happen during those reads can appear again, so handle duplicates. Pass the cursor as since to read exact changes in transaction order, or pass since: { after: "<ISO timestamp>" } for an approximate catch-up that returns a normal snapshot cursor. Offline writes are dated when they arrive. Your token’s writes are excluded unless includeOwn is true. While hasMore is true, pass the latest cursor as since with the same includeOwn setting. Save the final cursor for the next poll. A cursor_invalid error supplies a new starting cursor.',
    listChanges,
    true,
  );
  register(
    'list_workspaces',
    mcpTools.list_workspaces,
    'Identify the one Throw workspace this connection can access.',
    listWorkspaces,
    true,
  );
  register(
    'list_projects',
    mcpTools.list_projects,
    'List projects with keys, appearance, priority names and rail positions. Follow nextCursor to see more.',
    listProjects,
    true,
  );
  register(
    'list_statuses',
    mcpTools.list_statuses,
    'List a project’s statuses, positions, categories, and the defaults used for new and moved tasks.',
    listStatuses,
    true,
  );
  register(
    'list_tags',
    mcpTools.list_tags,
    'List a project’s tags with parents, appearance, sibling positions and root-to-leaf paths. Use the returned IDs to assign tags.',
    listTags,
    true,
  );
  register(
    'create_project',
    mcpTools.create_project,
    'Create a project at the end of this workspace’s rail with four starter statuses. Read the returned key, which can be suffixed when the proposed key is taken.',
    createProjectTool,
  );
  register(
    'update_project',
    mcpTools.update_project,
    'Edit a project’s name, key, color, icon or five priority names. Supply the observed before value for each edit. A key change updates the displayed keys of all its tasks.',
    updateProjectTool,
  );
  register(
    'move_project',
    mcpTools.move_project,
    'Move a project before or after another project in this workspace’s rail. Supply the project’s last-read position and the neighbor’s UUID.',
    moveProjectTool,
  );
  register(
    'create_status',
    mcpTools.create_status,
    'Add a status at the end of a category in a project. Its category is fixed. The existing category default stays selected.',
    createStatusTool,
  );
  register(
    'update_status',
    mcpTools.update_status,
    'Rename a status or make it the category default. Use list_statuses to find the observed default UUID. Supply that UUID as defaultStatusId.before and the target status UUID as after.',
    updateStatusTool,
  );
  register(
    'move_status',
    mcpTools.move_status,
    'Move a status before or after another status in the same project and category. Supply the status’s last-read position and the neighbor’s UUID.',
    moveStatusTool,
  );
  register(
    'create_tag',
    mcpTools.create_tag,
    'Create a root or nested tag. Color and icon belong to roots only. Any tag can be assigned to a task as primary or secondary.',
    createTagTool,
  );
  register(
    'update_tag',
    mcpTools.update_tag,
    'Rename, recolor, change the icon or reparent a tag. Supply before values for every change. To nest a root with color or icon, clear those fields in the same write.',
    updateTagTool,
  );
  register(
    'move_tag',
    mcpTools.move_tag,
    'Move a tag before or after a sibling in the same project. Supply its last-read parentId and position. Use update_tag to change its parent.',
    moveTagTool,
  );
  register(
    'list_tasks',
    mcpTools.list_tasks,
    'Search task titles, descriptions, and keys or list tasks with filters, including size (1–5, or null for unsized tasks). Results include subtasks and closed tasks. Trash is excluded by default.',
    listTasks,
    true,
  );
  register(
    'get_task',
    mcpTools.get_task,
    'Read a task by UUID or current key (such as THR-12), its Markdown description and version, its relations to other tasks (blocked is true while a blocking task is open), and pages of subtasks, comments, and history.',
    getTask,
    true,
  );
  register(
    'create_task',
    mcpTools.create_task,
    'Create a task. Omit statusId for the project’s backlog default. Supply a top-level parent to create a subtask. Inspect changes for any fallback status or tag.',
    createTaskTool,
  );
  register(
    'update_task',
    mcpTools.update_task,
    'Edit a task’s title, Markdown description, priority, size (1–5, or null to clear), or own trash state. Supply the before values you read. Inspect changes for refusals and read the task again before retrying a stale edit.',
    updateTaskTool,
  );
  register(
    'move_task',
    mcpTools.move_task,
    'Move a task to a project status or place it before or after a neighbor in the destination lane. Supply the last-read status, priority and parentId, then inspect changes for refusals. Top-level closed tasks are ordered by closing time.',
    moveTaskTool,
  );
  register(
    'set_task_tags',
    mcpTools.set_task_tags,
    'Set or clear the primary tag using its last-read value. Add or remove secondary tags by ID with present: true or false. Inspect changes for refused tags.',
    setTaskTagsTool,
  );
  register(
    'add_task_relation',
    mcpTools.add_task_relation,
    'Link a task to another task in this workspace, in any project: blocks, blocked_by, duplicates (this task is a duplicate of the other), duplicated_by or relates_to. Relations are informational and never stop a task from moving. Adding the reverse of an existing blocks or duplicates relation is refused. A link that already exists answers outcome existing.',
    addTaskRelationTool,
  );
  register(
    'remove_task_relation',
    mcpTools.remove_task_relation,
    'Remove a relation by its id from get_task, or by the task, relation and other task as add_task_relation takes them. A relation that is already gone answers outcome absent.',
    removeTaskRelationTool,
  );
  register(
    'add_comment',
    mcpTools.add_comment,
    'Post a Markdown comment on a task using its UUID or current key. Reuse an operation ID when retrying the same comment.',
    addCommentTool,
  );

  register(
    'link_github',
    mcpTools.link_github,
    'Link a GitHub issue or pull request from the connected repository to a task.',
    async (actor, input) => addGithubLink(actor, (await requireTask(actor, input.task)).id, input),
  );
  register(
    'unlink_github',
    mcpTools.unlink_github,
    'Remove a GitHub link using its ID from get_task.',
    async (actor, input) =>
      removeGithubLink(actor, (await requireTask(actor, input.task)).id, input.linkId),
  );
  register(
    'list_github_releases',
    mcpTools.list_github_releases,
    'List releases and tags recorded for a project.',
    (actor, input) => listReleases(actor, input.projectId),
    true,
  );
  for (const name of ['bind_task_release', 'unbind_task_release'] as const) {
    register(
      name,
      mcpTools[name],
      name === 'bind_task_release' ? 'Bind a task to a release.' : 'Remove a task from a release.',
      async (actor, input) => {
        const task = await requireTask(actor, input.task);
        return setReleaseBinding(
          actor,
          undefined,
          input.releaseId,
          task.id,
          name === 'bind_task_release',
        );
      },
    );
  }
  return server;
}
