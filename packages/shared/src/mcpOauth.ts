import { z } from 'zod';
import { createMcpTokenSchema, mcpTokenSchema, mcpTokensResponseSchema } from './mcpTokens';

export const oauthApprovalSchema = createMcpTokenSchema;
export const oauthCallbackSchema = z.object({ callbackUrl: z.url() });
export const oauthConsentSchema = z.object({
  clientId: z.string(),
  clientName: z.string(),
  clientDomain: z.string().nullable(),
  redirectHost: z.string(),
  scope: z.literal('mcp'),
  workspaces: mcpTokensResponseSchema.shape.workspaces,
});
export const oauthGrantsSchema = z.object({
  grants: z.array(mcpTokenSchema.extend({ clientId: z.string(), clientName: z.string() })),
});
