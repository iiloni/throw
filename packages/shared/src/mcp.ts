import { z } from 'zod';
import { activityChangeSchema } from './activity';
import { linkGithubRequestSchema, taskGithubLinkSchema } from './github';
import { positionSchema } from './position';
import { prioritySchema } from './priorities';
import { projectKeySchema, projectSchema, storedProjectKeySchema } from './projects';
import { sizeSchema } from './sizes';
import { statusCategorySchema, statusSchema } from './statuses';
import { timestampSchema } from './sync';
import { secondaryTagChangesSchema, tagSchema } from './tags';
import { taskRelationRoleSchema } from './taskRelations';
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
const project = projectSchema
  .pick({ id: true, name: true, color: true, icon: true, position: true, priorityNames: true })
  .extend({ key: storedProjectKeySchema, trashed: z.boolean() });
const taskReference = z.object({ id: uuid, key: z.string() });
const task = taskReference.extend({
  projectId: uuid,
  title: taskTitleSchema,
  statusId: uuid,
  category: statusCategorySchema,
  priority: prioritySchema,
  size: sizeSchema.nullable(),
  parentId: uuid.nullable(),
  primaryTagId: uuid.nullable(),
  trashed: z.boolean(),
  effectivelyTrashed: z.boolean(),
  closedAt: timestampSchema.nullable(),
});
const relatedTask = taskReference.extend({
  projectId: uuid,
  title: taskTitleSchema,
  category: statusCategorySchema,
  effectivelyTrashed: z.boolean(),
});
const relation = z.object({
  id: uuid,
  relation: taskRelationRoleSchema.describe('How the task you asked about sees the other task.'),
  task: relatedTask,
});
const relationRole = taskRelationRoleSchema.describe(
  'blocks: this task blocks the other. blocked_by: the other blocks this one. duplicates: this task is a duplicate of the other. duplicated_by: the other is a duplicate of this one. relates_to: a plain link.',
);
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
const tag = tagSchema
  .pick({ id: true, name: true, parentId: true, color: true, icon: true })
  .extend({ position: positionSchema.nullable() });
const tagWithPath = tag.extend({
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
    size: change(sizeSchema.nullable()),
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

const structureId = uuid.toLowerCase();
const structureOperationId = z
  .uuidv7()
  .toLowerCase()
  .describe('Use a new UUIDv7 for each write and reuse it only to retry that same write.');
const structurePlacement = z.strictObject({
  side: z.enum(['before', 'after']),
  neighborId: structureId,
});
const structureResult = <T extends z.ZodType>(item: T) =>
  z.object({
    operationId: z.uuidv7(),
    outcome: z.enum(['applied', 'conflict']),
    current: item,
    conflicts: z
      .array(z.string())
      .describe('Fields whose before values differ from the current values.'),
  });
const projectResult = structureResult(project);
const statusResult = structureResult(status.extend({ defaultStatusId: uuid }));
const tagResult = structureResult(tag);

const projectFields = projectSchema.shape;
const tagFields = tagSchema.shape;
const nonEmpty = (fields: object) => Object.keys(fields).length > 0;

const feedCursor = z.string().describe('The opaque cursor returned by list_changes.');
const feedChange = z.object({
  id: uuid,
  type: z.enum(['task', 'comment', 'project', 'status', 'tag']),
  kind: z.enum(['created', 'updated', 'moved', 'reordered', 'trashed', 'restored', 'deleted']),
  entity: z.object({
    id: uuid,
    projectId: uuid.nullable(),
    projectKey: z.string().nullable(),
    taskId: uuid.nullable(),
    taskKey: z.string().nullable(),
    taskTitle: z.string().nullable(),
  }),
  actor: z.object({ userId: z.string().nullable(), viaToken: z.string().nullable() }),
  changes: z.array(
    z.object({
      field: z.string(),
      before: z.unknown(),
      after: z.unknown(),
      applied: z.boolean().optional(),
      requested: z.unknown().optional(),
      tagId: uuid.optional(),
      relationId: uuid.optional(),
      relation: taskRelationRoleSchema.optional(),
      reason: z.enum(['stale', 'invalid', 'replaced']).optional(),
    }),
  ),
  createdAt: timestampSchema,
});

export const changeCursorErrorSchema = z.object({
  code: z.literal('cursor_invalid'),
  message: z.string(),
  cursor: feedCursor,
});

/** Normalize offsets before the SQL cast and keep the UTC instant in the supported year range. */
export const changeFeedAfterSchema = z.iso.datetime({ offset: true }).refine((value) => {
  const year = new Date(value).getUTCFullYear();
  return !value.startsWith('0000-') && year >= 1 && year <= 9999;
}, 'Use a timestamp between years 0001 and 9999.');

export const mcpTools = {
  list_changes: {
    input: z.strictObject({
      since: z.union([feedCursor, z.strictObject({ after: changeFeedAfterSchema })]).optional(),
      includeOwn: z.boolean().default(false),
      limit: z.int().min(1).max(50).default(20),
    }),
    output: z.object({ changes: z.array(feedChange), cursor: feedCursor, hasMore: z.boolean() }),
  },
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
    output: uuidPage(tagWithPath),
  },
  create_project: {
    input: z.strictObject({
      operationId: structureOperationId,
      name: projectFields.name,
      key: projectKeySchema
        .optional()
        .describe(
          'Proposed key: 1–6 uppercase letters or digits, starting with a letter. Defaults to a key derived from the name.',
        ),
      color: projectFields.color.optional(),
      icon: projectFields.icon.optional(),
    }),
    output: projectResult,
  },
  update_project: {
    input: z.strictObject({
      operationId: structureOperationId,
      projectId: structureId,
      changes: z
        .strictObject({
          name: change(projectFields.name),
          key: z.strictObject({ before: storedProjectKeySchema, after: projectKeySchema }),
          color: change(projectFields.color),
          icon: change(projectFields.icon),
          priorityNames: change(projectFields.priorityNames),
        })
        .partial()
        .refine(nonEmpty, 'Supply a change.'),
    }),
    output: projectResult,
  },
  move_project: {
    input: z.strictObject({
      operationId: structureOperationId,
      projectId: structureId,
      before: z.strictObject({ position: positionSchema }),
      placement: structurePlacement,
    }),
    output: projectResult,
  },
  create_status: {
    input: z.strictObject({
      operationId: structureOperationId,
      projectId: structureId,
      name: statusSchema.shape.name,
      category: statusCategorySchema,
      color: statusSchema.shape.color,
    }),
    output: statusResult,
  },
  update_status: {
    input: z.strictObject({
      operationId: structureOperationId,
      statusId: structureId,
      changes: z
        .strictObject({
          name: change(statusSchema.shape.name),
          color: change(statusSchema.shape.color.unwrap()),
          defaultStatusId: change(structureId).describe(
            'Use the current category default UUID as before, and this status UUID as after.',
          ),
        })
        .partial()
        .refine(nonEmpty, 'Supply a change.'),
    }),
    output: statusResult,
  },
  move_status: {
    input: z.strictObject({
      operationId: structureOperationId,
      statusId: structureId,
      before: z.strictObject({ position: positionSchema }),
      placement: structurePlacement,
    }),
    output: statusResult,
  },
  create_tag: {
    input: z.strictObject({
      operationId: structureOperationId,
      projectId: structureId,
      name: tagFields.name,
      parentId: structureId.nullable().default(null),
      color: tagFields.color.default(null),
      icon: tagFields.icon.default(null),
    }),
    output: tagResult,
  },
  update_tag: {
    input: z.strictObject({
      operationId: structureOperationId,
      tagId: structureId,
      changes: z
        .strictObject({
          name: change(tagFields.name),
          parentId: change(structureId.nullable()),
          color: change(tagFields.color),
          icon: change(tagFields.icon),
        })
        .partial()
        .refine(nonEmpty, 'Supply a change.'),
    }),
    output: tagResult,
  },
  move_tag: {
    input: z.strictObject({
      operationId: structureOperationId,
      tagId: structureId,
      before: z.strictObject({
        position: positionSchema.nullable(),
        parentId: structureId.nullable(),
      }),
      placement: structurePlacement,
    }),
    output: tagResult,
  },
  list_tasks: {
    input: pageInput.extend({
      query: z.string().trim().min(1).max(200).optional(),
      projectId: uuid.optional(),
      statusId: uuid.optional(),
      category: statusCategorySchema.optional(),
      priority: prioritySchema.optional(),
      size: sizeSchema
        .nullable()
        .optional()
        .describe('Filter by size, or pass null for unsized tasks.'),
      tagId: uuid.optional(),
      parent: taskRef.nullable().optional().describe('Use null to return top-level tasks only.'),
      trash: z.enum(['active', 'trashed', 'all']).default('active'),
    }),
    output: uuidPage(task),
  },
  link_github: {
    input: z.strictObject({ task: taskRef, ...linkGithubRequestSchema.shape }),
    output: z.object({ link: taskGithubLinkSchema, txid: z.number().nullable() }),
  },
  unlink_github: {
    input: z.strictObject({ task: taskRef, linkId: uuid }),
    output: z.object({ txid: z.number().nullable() }),
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
        blocked: z
          .boolean()
          .describe('A blocking task is still open and out of the trash. Informational only.'),
      }),
      relations: z.array(relation),
      githubLinks: z.array(taskGithubLinkSchema).default([]),
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
      size: sizeSchema
        .nullable()
        .optional()
        .describe('T-shirt size (1–5: XS, S, M, L, XL), or null.'),
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
  add_task_relation: {
    input: z.strictObject({
      operationId,
      task: taskRef,
      relation: relationRole,
      other: taskRef.describe('Any task in this workspace, in this or another project.'),
    }),
    output: z.object({
      operationId: z.uuidv7(),
      outcome: z
        .enum(['added', 'existing'])
        .describe('existing: the tasks were already linked this way, by another relation.'),
      relation,
    }),
  },
  remove_task_relation: {
    input: z
      .strictObject({
        operationId,
        relationId: uuid.optional().describe('A relation id from get_task.'),
        task: taskRef.optional(),
        relation: relationRole.optional(),
        other: taskRef.optional(),
      })
      .refine(
        (input) => !!input.relationId || !!(input.task && input.relation && input.other),
        'Supply a relationId, or task, relation and other.',
      ),
    output: z.object({
      operationId: z.uuidv7(),
      outcome: z.enum(['removed', 'absent']),
      relationId: uuid.nullable(),
    }),
  },
  add_comment: {
    input: z.strictObject({ operationId, task: taskRef, body: markdown }),
    output: z.object({ task: taskReference, commentId: uuid, operationId: z.uuidv7() }),
  },
};

export type McpToolName = keyof typeof mcpTools;
export type McpInput<T extends McpToolName> = z.output<(typeof mcpTools)[T]['input']>;
export type McpOutput<T extends McpToolName> = z.output<(typeof mcpTools)[T]['output']>;
