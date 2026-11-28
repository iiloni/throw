import { randomUUID } from 'node:crypto';
import { zValidator } from '@hono/zod-validator';
import {
  oauthApprovalSchema,
  oauthCallbackSchema,
  oauthConsentSchema,
  oauthGrantsSchema,
} from '@throw/shared';
import { and, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { db } from '../db/client';
import { mcpTokens, oauthRequests, oauthTickets, workspaces } from '../db/schema';
import { requireUser } from '../lib/requireUser';
import { memberWorkspaces } from '../lib/workspaces';
import { digest, fresh, future, resource } from './tokens';

const idParam = zValidator('param', z.object({ id: z.uuid() }));
function pending(c: Context, id: string) {
  return and(
    eq(oauthRequests.id, id),
    eq(oauthRequests.resource, resource),
    gt(oauthRequests.expiresAt, new Date()),
    eq(oauthRequests.browserDigest, digest(getCookie(c, 'throw_consent') ?? '')),
  );
}
function callback(request: typeof oauthRequests.$inferSelect, code?: string) {
  const url = new URL(request.redirect);
  url.searchParams.delete('code');
  url.searchParams.delete('error');
  url.searchParams.delete('state');
  if (code) url.searchParams.set('code', code);
  else url.searchParams.set('error', 'access_denied');
  if (request.state !== null) url.searchParams.set('state', request.state);
  return oauthCallbackSchema.parse({ callbackUrl: url.href });
}
export const oauthManagement = new Hono<AppEnv>()
  .use(async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  })
  .use(requireUser)
  .get('/requests/:id', idParam, async (c) => {
    const [row] = await db
      .select()
      .from(oauthRequests)
      .where(pending(c, c.req.valid('param').id));
    if (!row) return c.json({ error: 'Request expired or unavailable' }, 404);
    const available = await db
      .select({ id: workspaces.id, name: workspaces.name })
      .from(workspaces)
      .where(inArray(workspaces.id, memberWorkspaces(db, c.get('user')!.id)))
      .orderBy(workspaces.name, workspaces.id);
    return c.json(
      oauthConsentSchema.parse({
        clientId: row.clientId,
        clientName: row.clientName,
        clientDomain: row.clientId.startsWith('https://') ? new URL(row.clientId).host : null,
        redirectHost: new URL(row.redirect).host,
        scope: 'mcp',
        workspaces: available,
      }),
    );
  })
  .post('/requests/:id/deny', idParam, async (c) => {
    const [row] = await db
      .delete(oauthRequests)
      .where(pending(c, c.req.valid('param').id))
      .returning();
    return row ? c.json(callback(row)) : c.json({ error: 'Request expired or unavailable' }, 404);
  })
  .post('/requests/:id/approve', idParam, zValidator('json', oauthApprovalSchema), async (c) => {
    const userId = c.get('user')!.id;
    const { name, workspaceId } = c.req.valid('json');
    const result = await db.transaction(async (tx) => {
      const [workspace] = await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(
          and(eq(workspaces.id, workspaceId), inArray(workspaces.id, memberWorkspaces(tx, userId))),
        )
        .for('key share');
      if (!workspace) return null;
      const [row] = await tx
        .delete(oauthRequests)
        .where(pending(c, c.req.valid('param').id))
        .returning();
      if (!row) return null;
      const grantId = randomUUID();
      await tx.insert(mcpTokens).values({
        id: grantId,
        userId,
        workspaceId,
        name,
        clientId: row.clientId,
        clientName: row.clientName,
        resource,
      });
      const code = fresh('code');
      await tx.insert(oauthTickets).values({
        grantId,
        kind: 'code',
        digest: digest(code),
        redirect: row.redirect,
        challenge: row.challenge,
        expiresAt: future(120),
      });
      return callback(row, code);
    });
    return result ? c.json(result) : c.json({ error: 'Request or workspace unavailable' }, 404);
  })
  .get('/grants', async (c) => {
    const rows = await db
      .select({
        id: mcpTokens.id,
        name: mcpTokens.name,
        workspaceId: mcpTokens.workspaceId,
        clientId: mcpTokens.clientId,
        clientName: mcpTokens.clientName,
        createdAt: mcpTokens.createdAt,
      })
      .from(mcpTokens)
      .where(and(eq(mcpTokens.userId, c.get('user')!.id), isNotNull(mcpTokens.clientId)))
      .orderBy(mcpTokens.createdAt);
    return c.json(
      oauthGrantsSchema.parse({
        grants: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      }),
    );
  })
  .delete('/grants/:id', idParam, async (c) => {
    await db
      .delete(mcpTokens)
      .where(
        and(
          eq(mcpTokens.userId, c.get('user')!.id),
          isNotNull(mcpTokens.clientId),
          eq(mcpTokens.id, c.req.valid('param').id),
        ),
      );
    return c.body(null, 204);
  });
