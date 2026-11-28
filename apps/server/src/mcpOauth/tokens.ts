import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, inArray, lt } from 'drizzle-orm';
import { db, type Transaction } from '../db/client';
import { mcpTokens, oauthTickets } from '../db/schema';
import { memberWorkspaces } from '../lib/workspaces';
import { publicUrl } from '../mcp/boundary';

export const resource = `${publicUrl.origin}/api/mcp`;
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const fresh = (kind: string) => `throw_${kind}_${randomBytes(32).toString('base64url')}`;
export const future = (seconds: number) => new Date(Date.now() + seconds * 1000);
export function matchesChallenge(verifier: string, challenge: string | null) {
  return (
    /^[a-zA-Z0-9._~-]{43,128}$/.test(verifier) &&
    createHash('sha256').update(verifier).digest('base64url') === challenge
  );
}

export async function verifyAccess(token: string) {
  const [actor] = await db
    .select({
      tokenId: mcpTokens.id,
      userId: mcpTokens.userId,
      workspaceId: mcpTokens.workspaceId,
      viaTokenName: mcpTokens.name,
    })
    .from(oauthTickets)
    .innerJoin(mcpTokens, eq(mcpTokens.id, oauthTickets.grantId))
    .where(
      and(
        eq(oauthTickets.digest, digest(token)),
        eq(oauthTickets.kind, 'access'),
        gt(oauthTickets.expiresAt, new Date()),
        eq(mcpTokens.resource, resource),
        inArray(mcpTokens.workspaceId, memberWorkspaces(db, mcpTokens.userId)),
      ),
    );
  return actor ?? null;
}

async function issue(tx: Transaction, grantId: string, familyExpiry: Date) {
  const access = fresh('access');
  const refresh = fresh('refresh');
  const expiresAt = new Date(Math.min(future(900).getTime(), familyExpiry.getTime()));
  await tx.insert(oauthTickets).values([
    { grantId, kind: 'access', digest: digest(access), expiresAt },
    { grantId, kind: 'refresh', digest: digest(refresh), expiresAt: familyExpiry },
  ]);
  return {
    access_token: access,
    token_type: 'Bearer',
    refresh_token: refresh,
    expires_in: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
    scope: 'mcp',
  };
}

export async function exchange(params: URLSearchParams) {
  const code = params.get('grant_type') === 'authorization_code';
  const secret = params.get(code ? 'code' : 'refresh_token');
  if (!secret) return null;
  return db.transaction(async (tx) => {
    const condition = and(
      eq(oauthTickets.digest, digest(secret)),
      eq(oauthTickets.kind, code ? 'code' : 'refresh'),
    );
    const [candidate] = await tx
      .select({ grantId: oauthTickets.grantId })
      .from(oauthTickets)
      .where(condition);
    if (!candidate) return null;
    // Every exchange in this family locks the same parent before checking consumption.
    const [grant] = await tx
      .select()
      .from(mcpTokens)
      .where(
        and(
          eq(mcpTokens.id, candidate.grantId),
          eq(mcpTokens.clientId, params.get('client_id') ?? ''),
          eq(mcpTokens.resource, resource),
          inArray(mcpTokens.workspaceId, memberWorkspaces(tx, mcpTokens.userId)),
        ),
      )
      .for('update');
    if (!grant) return null;
    const [ticket] = await tx.select().from(oauthTickets).where(condition);
    if (!ticket || ticket.expiresAt <= new Date()) return null;
    if (
      code &&
      (params.get('redirect_uri') !== ticket.redirect ||
        !matchesChallenge(params.get('code_verifier') ?? '', ticket.challenge))
    )
      return null;
    if (ticket.used) {
      await tx.delete(mcpTokens).where(eq(mcpTokens.id, grant.id));
      return null;
    }
    await tx.update(oauthTickets).set({ used: true }).where(condition);
    await tx
      .delete(oauthTickets)
      .where(and(eq(oauthTickets.grantId, grant.id), lt(oauthTickets.expiresAt, new Date())));
    return issue(tx, grant.id, code ? future(30 * 86400) : ticket.expiresAt);
  });
}
