import { z } from 'zod';
import { activityChangeSchema } from './activity';
import { prioritySchema } from './priorities';
import { statusCategorySchema, statusSchema } from './statuses';
import { timestampSchema } from './sync';
import { secondaryTagChangesSchema, tagSchema } from './tags';
import { taskTitleSchema } from './tasks';

const uuid = z.uuid();
const taskRef = uuid.or(
  z
    .string()
    .max(64)
    .regex(/^[A-Z][A-Z0-9]*-[1-9][0-9]*$/),
);
const operationId = z
  .uuidv7()
  .optional()
  .describe('Reuse this UUIDv7 only when retrying the same write.');
const markdown = z.string().max(48_000);
const pageInput = z.strictObject({
  cursor: uuid.optional().describe('The nextCursor returned by the previous page.'),
  limit: z.int().min(1).max(50).default(20),
});
export type McpPageInput = z.output<typeof pageInput>;

const timelineCursor = z.object({ id: uuid, createdAt: timestampSchema });
const timelinePageInput = z
  .strictObject({
    cursor: timelineCursor.optional(),
    limit: z.int().min(1).max(20).default(10),
  })
  .default({ limit: 10 });

const workspace = z.object({ id: uuid, name: z.string() });
const project = workspace.extend({ key: z.string(), trashed: z.boolean() });
const taskReference = z.object({ id: uuid, key: z.string() });
const task = taskReference.extend({
  projectId: uuid,
  title: taskTitleSchema,
  statusId: uuid,
  category: statusCategorySchema,
  priority: prioritySchema,
  parentId: uuid.nullable(),
  primaryTagId: uuid.nullable(),
  trashed: z.boolean(),
  effectivelyTrashed: z.boolean(),
  closedAt: timestampSchema.nullable(),
});
const textDocument = z.object({ markdown: z.string().nullable(), lossy: z.boolean() });
const changeResult = activityChangeSchema.omit({ rejectedDocument: true }).extend({
  rejectedDescription: textDocument.optional(),
});
const activity = z.object({
  id: uuid,
  kind: z.enum(['created', 'updated']),
  userId: z.string().nullable(),
  viaTokenName: z.string().nullable(),
  createdAt: timestampSchema,
  changes: z.array(changeResult),
});
const comment = z.object({
  id: uuid,
  userId: z.string().nullable(),
  viaTokenName: z.string().nullable(),
  createdAt: timestampSchema,
  editedAt: timestampSchema.nullable(),
  body: textDocument,
});
const status = statusSchema.omit({ projectId: true, workspaceId: true });
const tag = tagSchema.pick({ id: true, name: true, parentId: true }).extend({
  path: z.array(z.string()).describe('Tag names from the root to this tag.'),
});
const uuidPage = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: uuid.nullable(),
  });
const timelinePage = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: timelineCursor.nullable(),
  });
const change = <T extends z.ZodType>(value: T) => z.strictObject({ before: value, after: value });
const taskWriteResult = z.object({
  task: taskReference,
  operationId: z.uuidv7(),
  changes: z.array(changeResult),
});

const taskUpdateFields = z
  .strictObject({
    title: change(taskTitleSchema),
    priority: change(prioritySchema),
    trashed: change(z.boolean()),
    description: z.strictObject({
      before: uuid.nullable().describe('The descriptionVersion returned with the task.'),
      after: markdown.nullable().describe('The full replacement Markdown, or null to clear it.'),
    }),
  })
  .partial();

const placement = z.strictObject({
  side: z.enum(['before', 'after']),
  neighbor: taskRef,
});
const moveScope = z.strictObject({
  statusId: uuid,
  priority: prioritySchema,
  parentId: uuid.nullable(),
});

export const mcpTools = {
  list_workspaces: {
    input: z.strictObject({}),
    output: z.object({ items: z.array(workspace) }),
  },
  list_projects: {
    input: pageInput.extend({ includeTrashed: z.boolean().default(false) }),
    output: uuidPage(project),
  },
  list_statuses: {
    input: pageInput.extend({ projectId: uuid }),
    output: uuidPage(status),
  },
  list_tags: {
    input: pageInput.extend({ projectId: uuid }),
    output: uuidPage(tag),
  },
  list_tasks: {
    input: pageInput.extend({
      query: z.string().trim().min(1).max(200).optional(),
      projectId: uuid.optional(),
      statusId: uuid.optional(),
      category: statusCategorySchema.optional(),
      priority: prioritySchema.optional(),
      tagId: uuid.optional(),
      parent: taskRef.nullable().optional().describe('Use null to return top-level tasks only.'),
      trash: z.enum(['active', 'trashed', 'all']).default('active'),
    }),
    output: uuidPage(task),
  },
  get_task: {
    input: z.strictObject({
      task: taskRef,
      subtasks: pageInput.default({ limit: 20 }),
      comments: timelinePageInput,
      history: timelinePageInput,
    }),
    output: z.object({
      task: task.extend({
        description: textDocument,
        descriptionVersion: uuid.nullable(),
        secondaryTagIds: z.array(uuid),
      }),
      subtasks: uuidPage(task),
      comments: timelinePage(comment),
      history: timelinePage(activity),
    }),
  },
  create_task: {
    input: z.strictObject({
      operationId,
      projectId: uuid,
      title: taskTitleSchema,
      description: markdown.optional(),
      statusId: uuid.optional(),
      priority: prioritySchema.optional(),
      parent: taskRef.optional().describe('Supply a top-level parent to make this a subtask.'),
      primaryTagId: uuid.optional(),
      secondaryTagIds: z.array(uuid).max(100).optional(),
    }),
    output: taskWriteResult,
  },
  update_task: {
    input: z.strictObject({
      operationId,
      task: taskRef,
      changes: taskUpdateFields.refine(
        (fields) => Object.keys(fields).length > 0,
        'Supply a change.',
      ),
    }),
    output: taskWriteResult,
  },
  move_task: {
    input: z
      .strictObject({
        operationId,
        task: taskRef,
        before: moveScope.describe('The task status, priority and parentId you read.'),
        statusId: uuid.optional().describe('The destination status, from list_statuses.'),
        placement: placement.optional(),
      })
      .refine((input) => !!(input.statusId || input.placement), 'Supply a statusId or placement.'),
    output: taskWriteResult,
  },
  set_task_tags: {
    input: z
      .strictObject({
        operationId,
        task: taskRef,
        primaryTagId: change(uuid.nullable()).optional(),
        secondaryTags: secondaryTagChangesSchema.max(100).optional(),
      })
      .refine((input) => !!(input.primaryTagId || input.secondaryTags), 'Supply a tag change.'),
    output: taskWriteResult,
  },
  add_comment: {
    input: z.strictObject({ operationId, task: taskRef, body: markdown }),
    output: z.object({ task: taskReference, commentId: uuid, operationId: z.uuidv7() }),
  },
};

export type McpToolName = keyof typeof mcpTools;
export type McpInput<T extends McpToolName> = z.output<(typeof mcpTools)[T]['input']>;
export type McpOutput<T extends McpToolName> = z.output<(typeof mcpTools)[T]['output']>;
