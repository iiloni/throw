import { createHash, randomBytes } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { mcpTokens } from '../db/schema';
import { memberWorkspaces } from './workspaces';
import type { WriteActor } from './writeActor';

const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export function newMcpCredential() {
  const token = `throw_mcp_${randomBytes(32).toString('base64url')}`;
  return { token, digest: digest(token) };
}

export type McpActor = Extract<WriteActor, { workspaceId: string }> & { tokenId: string };

export async function verifyMcpToken(authorization: string | undefined): Promise<McpActor | null> {
  const match = /^Bearer (throw_mcp_[A-Za-z0-9_-]{43})$/i.exec(authorization ?? '');
  if (!match) return null;
  const [credential] = await db
    .select({
      tokenId: mcpTokens.id,
      userId: mcpTokens.userId,
      workspaceId: mcpTokens.workspaceId,
      viaTokenName: mcpTokens.name,
    })
    .from(mcpTokens)
    .where(
      and(
        eq(mcpTokens.digest, digest(match[1]!)),
        inArray(mcpTokens.workspaceId, memberWorkspaces(db, mcpTokens.userId)),
      ),
    );
  return credential ?? null;
}
