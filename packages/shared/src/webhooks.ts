import { z } from 'zod';
import { statusCategorySchema } from './statuses';
import { timestampSchema } from './sync';

/** Outbound webhooks: a thin signal that a workspace changed (ADR 0015). */

export const WEBHOOK_EVENTS = [
  'task.created',
  'task.updated',
  'task.deleted',
  'comment.created',
  'comment.updated',
  'comment.deleted',
  'structure.updated',
  'webhook.test',
] as const;

export const webhookEventSchema = z.enum(WEBHOOK_EVENTS);
export type WebhookEvent = z.infer<typeof webhookEventSchema>;

export const WEBHOOK_HEADERS = {
  event: 'X-Throw-Event',
  delivery: 'X-Throw-Delivery',
  signature: 'X-Throw-Signature',
} as const;

export const WEBHOOK_USER_AGENT = 'Throw-Webhooks/1';
export const WEBHOOK_SECRET_PREFIX = 'throw_whsec_';
export const MAX_WEBHOOK_URL_LENGTH = 2048;

/**
 * A webhook may wait until changes pause before it sends (ADR 0015). The wait is the
 * webhook's: any change it follows, to any task, comment or project's structure, restarts it
 * for everything waiting. Only `webhook.test` is sent at once.
 */
export const MAX_WEBHOOK_QUIET_WINDOW_SECONDS = 600;
export const WEBHOOK_QUIET_WINDOW_PRESETS = [0, 30, 60, 120, 300, 600] as const;

export const webhookQuietWindowSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_WEBHOOK_QUIET_WINDOW_SECONDS);

const webhookNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[^\p{Cc}\p{Cf}]+$/u);

/** Syntax only. The server applies its delivery policy, including DNS, separately. */
export const webhookUrlSchema = z
  .string()
  .trim()
  .max(MAX_WEBHOOK_URL_LENGTH)
  .pipe(z.url({ protocol: /^https?$/ }));

export const createWebhookSchema = z.strictObject({
  workspaceId: z.uuid(),
  /** Limits events to one project in the workspace. Null follows the whole workspace. */
  projectId: z.uuid().nullable().default(null),
  name: webhookNameSchema,
  url: webhookUrlSchema,
  /** Skips writes made through MCP tokens, so an agent is not woken by its own changes. */
  ignoreTokenWrites: z.boolean().default(true),
  /**
   * Seconds without changes before a delivery is sent. Left out means 0, so a client only
   * sends it to a server that lists `quietWindow` support and older servers keep accepting
   * the body.
   */
  quietWindowSeconds: webhookQuietWindowSchema.optional(),
});

export const updateWebhookSchema = z
  .strictObject({
    name: webhookNameSchema,
    url: webhookUrlSchema,
    projectId: z.uuid().nullable(),
    ignoreTokenWrites: z.boolean(),
    enabled: z.boolean(),
    quietWindowSeconds: webhookQuietWindowSchema,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Change at least one field');

export const webhookDeliveryStatusSchema = z.enum(['ok', 'error']);

export const webhookSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid().nullable(),
  name: z.string(),
  url: z.string(),
  ignoreTokenWrites: z.boolean(),
  enabled: z.boolean(),
  /** Absent from servers before quiet windows, which send at once. */
  quietWindowSeconds: z.number().int().min(0).default(0),
  createdAt: timestampSchema,
  lastDeliveryAt: timestampSchema.nullable(),
  lastDeliveryStatus: webhookDeliveryStatusSchema.nullable(),
  /** The receiver's HTTP status, when it answered. */
  lastResponseStatus: z.number().int().nullable(),
  lastError: z.string().nullable(),
});

export const webhooksResponseSchema = z.object({
  webhooks: z.array(webhookSchema),
  /** The server accepts `quietWindowSeconds`. Older servers leave it out and refuse the field. */
  quietWindow: z.boolean().default(false),
  workspaces: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      projects: z.array(z.object({ id: z.uuid(), name: z.string(), key: z.string() })),
    }),
  ),
});

export const webhookResponseSchema = z.object({ webhook: webhookSchema });

/** The signing secret is returned once, when it is made. */
export const webhookSecretResponseSchema = z.object({
  secret: z.string(),
  webhook: webhookSchema,
});

export const webhookTestResponseSchema = z.object({
  deliveryId: z.uuid(),
  ok: z.boolean(),
  responseStatus: z.number().int().nullable(),
  error: z.string().nullable(),
  webhook: webhookSchema,
});

/**
 * The delivered body. It names what changed and leaves the content to MCP `list_changes`,
 * which a receiver calls with its saved cursor.
 */
export const webhookPayloadSchema = z.object({
  deliveryId: z.uuid(),
  event: webhookEventSchema,
  workspaceId: z.uuid(),
  projectId: z.uuid().nullable(),
  projectKey: z.string().nullable(),
  entityType: z.enum(['task', 'comment', 'project', 'status', 'tag', 'webhook']),
  kind: z.string(),
  taskId: z.uuid().optional(),
  taskKey: z.string().nullable().optional(),
  actor: z.object({
    kind: z.enum(['user', 'token']),
    viaTokenName: z.string().nullable().optional(),
  }),
  changedFields: z.array(z.string()).optional(),
  statusTo: z
    .object({ id: z.uuid(), name: z.string(), category: statusCategorySchema })
    .nullable()
    .optional(),
  occurredAt: timestampSchema,
});

export type CreateWebhook = z.input<typeof createWebhookSchema>;
export type UpdateWebhook = z.infer<typeof updateWebhookSchema>;
export type Webhook = z.infer<typeof webhookSchema>;
export type WebhooksResponse = z.infer<typeof webhooksResponseSchema>;
export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;
export type WebhookTestResponse = z.infer<typeof webhookTestResponseSchema>;
