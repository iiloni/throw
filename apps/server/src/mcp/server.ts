import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { mcpTools } from '@throw/shared';
import type { z } from 'zod';
import type { McpActor } from '../lib/mcpTokens';
import { MarkdownError } from './markdown';
import {
  getTask,
  listProjects,
  listStatuses,
  listTags,
  listTasks,
  listWorkspaces,
  ToolError,
} from './read';
import {
  addCommentTool,
  createTaskTool,
  moveTaskTool,
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
          idempotentHint: readOnly,
          openWorldHint: false,
          destructiveHint: name === 'update_task' || name === 'set_task_tags',
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
        } catch (error) {
          const expected = error instanceof ToolError || error instanceof MarkdownError;
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
    'list_workspaces',
    mcpTools.list_workspaces,
    'Identify the one Throw workspace this connection can access.',
    listWorkspaces,
    true,
  );
  register(
    'list_projects',
    mcpTools.list_projects,
    'List projects and their keys in this workspace. Follow nextCursor to see more.',
    listProjects,
    true,
  );
  register(
    'list_statuses',
    mcpTools.list_statuses,
    'List a project’s statuses, their categories, and the defaults used for new and moved tasks.',
    listStatuses,
    true,
  );
  register(
    'list_tags',
    mcpTools.list_tags,
    'List a project’s tags with their root-to-leaf paths. Use the returned IDs to assign tags.',
    listTags,
    true,
  );
  register(
    'list_tasks',
    mcpTools.list_tasks,
    'Search task titles, descriptions, and keys or list tasks with filters. Results include subtasks and closed tasks. Trash is excluded by default.',
    listTasks,
    true,
  );
  register(
    'get_task',
    mcpTools.get_task,
    'Read a task by UUID or current key (such as THR-12), its Markdown description and version, and pages of subtasks, comments, and history.',
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
    'Edit a task’s title, Markdown description, priority, or own trash state. Supply the before values you read. Inspect changes for refusals and read the task again before retrying a stale edit.',
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
    'add_comment',
    mcpTools.add_comment,
    'Post a Markdown comment on a task using its UUID or current key. Reuse an operation ID when retrying the same comment.',
    addCommentTool,
  );

  return server;
}
