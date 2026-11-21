import { z } from 'zod';
import { timestampSchema } from './sync';

export const createMcpTokenSchema = z.strictObject({
  workspaceId: z.uuid(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[^\p{Cc}\p{Cf}]+$/u),
});

export const mcpTokenSchema = createMcpTokenSchema.extend({
  id: z.uuid(),
  createdAt: timestampSchema,
});

export const mcpTokensResponseSchema = z.object({
  tokens: z.array(mcpTokenSchema),
  workspaces: z.array(z.object({ id: z.uuid(), name: z.string() })),
});

export const createMcpTokenResponseSchema = z.object({
  token: z.string(),
  metadata: mcpTokenSchema,
});

export type CreateMcpToken = z.infer<typeof createMcpTokenSchema>;
export type McpToken = z.infer<typeof mcpTokenSchema>;
export type McpTokensResponse = z.infer<typeof mcpTokensResponseSchema>;
