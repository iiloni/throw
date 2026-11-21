import { zValidator } from '@hono/zod-validator';
import {
  createMcpTokenResponseSchema,
  createMcpTokenSchema,
  mcpTokensResponseSchema,
} from '@throw/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { db } from '../db/client';
import { mcpTokens, workspaces } from '../db/schema';
import { newMcpCredential } from '../lib/mcpTokens';
import { requireUser } from '../lib/requireUser';
import { memberWorkspaces } from '../lib/workspaces';

const metadata = {
  id: mcpTokens.id,
  name: mcpTokens.name,
  workspaceId: mcpTokens.workspaceId,
  createdAt: mcpTokens.createdAt,
};

export const mcpTokenRoutes = new Hono<AppEnv>()
  .use(async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  })
  .use(requireUser)
  .get('/', async (c) => {
    const userId = c.get('user')!.id;
    const [tokens, accessibleWorkspaces] = await Promise.all([
      db
        .select(metadata)
        .from(mcpTokens)
        .where(eq(mcpTokens.userId, userId))
        .orderBy(mcpTokens.createdAt, mcpTokens.id),
      db
        .select({ id: workspaces.id, name: workspaces.name })
        .from(workspaces)
        .where(inArray(workspaces.id, memberWorkspaces(db, userId)))
        .orderBy(workspaces.name, workspaces.id),
    ]);
    return c.json(
      mcpTokensResponseSchema.parse({
        tokens: tokens.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
        workspaces: accessibleWorkspaces,
      }),
    );
  })
  .post('/', zValidator('json', createMcpTokenSchema), async (c) => {
    const userId = c.get('user')!.id;
    const { workspaceId, name } = c.req.valid('json');
    const result = await db.transaction(async (tx) => {
      const [workspace] = await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(
          and(eq(workspaces.id, workspaceId), inArray(workspaces.id, memberWorkspaces(tx, userId))),
        )
        .for('key share');
      if (!workspace) return null;
      const { token, digest } = newMcpCredential();
      const [row] = await tx
        .insert(mcpTokens)
        .values({ id: uuidv7(), userId, workspaceId, name, digest })
        .returning(metadata);
      return { token, metadata: { ...row!, createdAt: row!.createdAt.toISOString() } };
    });
    return result
      ? c.json(createMcpTokenResponseSchema.parse(result), 201)
      : c.json({ error: 'Workspace not found' }, 404);
  })
  .delete('/:id', zValidator('param', z.object({ id: z.uuid() })), async (c) => {
    const { id } = c.req.valid('param');
    await db
      .delete(mcpTokens)
      .where(and(eq(mcpTokens.id, id), eq(mcpTokens.userId, c.get('user')!.id)));
    return c.body(null, 204);
  });
