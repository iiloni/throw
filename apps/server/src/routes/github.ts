import { zValidator } from '@hono/zod-validator';
import {
  createGithubConnectionSchema,
  type GithubConnection,
  githubConnectionResponseSchema,
  githubConnectionSecretResponseSchema,
  linkGithubRequestSchema,
  updateGithubConnectionSchema,
} from '@throw/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { db } from '../db/client';
import { githubConnections, projects, statuses } from '../db/schema';
import { githubSecretKey, githubWebhookUrl } from '../github/config';
import { addGithubLink, LinkError, removeGithubLink } from '../github/manualLinks';
import { newGithubWebhookSecret, newWebhookToken } from '../github/secrets';
import { statusRuleSet, statusRulesOf } from '../github/statusRules';
import { requireUser } from '../lib/requireUser';
import { memberWorkspaces } from '../lib/workspaces';
import { encryptSecret } from '../webhooks/signing';

type Row = typeof githubConnections.$inferSelect;

/** Metadata only: the webhook secret is shown when it is made, and the token never. */
export function connectionMetadata(row: Row, url = githubWebhookUrl): GithubConnection {
  return {
    projectId: row.projectId,
    workspaceId: row.workspaceId,
    repository: row.repository,
    authMode: row.authMode,
    enabled: row.enabled,
    hasToken: row.encryptedToken !== null,
    webhookUrl: url(row.webhookToken),
    createdAt: row.createdAt.toISOString(),
    statusRules: statusRulesOf(row),
    lastDelivery: row.lastDeliveryAt
      ? {
          at: row.lastDeliveryAt.toISOString(),
          id: row.lastDeliveryId,
          event: row.lastDeliveryEvent,
          status: row.lastDeliveryStatus ?? 'error',
          detail: row.lastDeliveryDetail,
        }
      : null,
  };
}

/** The project, when it is in one of the user's workspaces. */
const reachableProject = (userId: string, projectId: string) =>
  db
    .select({ id: projects.id, workspaceId: projects.workspaceId, deletedAt: projects.deletedAt })
    .from(projects)
    .where(
      and(eq(projects.id, projectId), inArray(projects.workspaceId, memberWorkspaces(db, userId))),
    )
    .then(([row]) => row);

/** The project's connection, scoped by membership in the same query. */
const ownConnection = (userId: string, projectId: string) =>
  db
    .select()
    .from(githubConnections)
    .where(
      and(
        eq(githubConnections.projectId, projectId),
        inArray(githubConnections.workspaceId, memberWorkspaces(db, userId)),
      ),
    )
    .then(([row]) => row);

const encrypt = (value: string) => encryptSecret(value, githubSecretKey);

const projectParam = zValidator('param', z.object({ projectId: z.uuid() }));
const notFound = { error: 'Project not found' } as const;
const notConnected = { error: 'The project has no GitHub connection' } as const;

/**
 * A project's GitHub connection (ADR 0017), for any member of its workspace. Answers are
 * uncached, and never hold the stored secret or token.
 */
export const githubRoutes = new Hono<AppEnv>()
  .use(async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  })
  .use(requireUser)
  .onError((err, c) => {
    if (err instanceof LinkError) return c.json({ error: err.message }, err.status);
    throw err;
  })
  .post(
    '/tasks/:taskId/links',
    zValidator('param', z.object({ taskId: z.uuid() })),
    zValidator('json', linkGithubRequestSchema),
    async (c) => {
      const result = await addGithubLink(
        { userId: c.get('user')!.id },
        c.req.valid('param').taskId,
        c.req.valid('json'),
      );
      return c.json(result, result.txid === null ? 200 : 201);
    },
  )
  .delete(
    '/tasks/:taskId/links/:linkId',
    zValidator('param', z.object({ taskId: z.uuid(), linkId: z.uuid() })),
    async (c) => {
      const { taskId, linkId } = c.req.valid('param');
      return c.json(await removeGithubLink({ userId: c.get('user')!.id }, taskId, linkId));
    },
  )
  .get('/projects/:projectId', projectParam, async (c) => {
    const userId = c.get('user')!.id;
    const { projectId } = c.req.valid('param');
    if (!(await reachableProject(userId, projectId))) return c.json(notFound, 404);
    const row = await ownConnection(userId, projectId);
    return c.json(
      githubConnectionResponseSchema.parse({ connection: row ? connectionMetadata(row) : null }),
    );
  })
  .post(
    '/projects/:projectId',
    projectParam,
    zValidator('json', createGithubConnectionSchema),
    async (c) => {
      const userId = c.get('user')!.id;
      const { projectId } = c.req.valid('param');
      const body = c.req.valid('json');
      const secret = newGithubWebhookSecret();
      const result = await db.transaction(async (tx) => {
        // The lock keeps the project from being purged before the connection is inserted.
        const [project] = await tx
          .select({ workspaceId: projects.workspaceId })
          .from(projects)
          .where(
            and(
              eq(projects.id, projectId),
              isNull(projects.deletedAt),
              inArray(projects.workspaceId, memberWorkspaces(tx, userId)),
            ),
          )
          .for('key share');
        if (!project) return 'project' as const;
        const [inserted] = await tx
          .insert(githubConnections)
          .values({
            id: uuidv7(),
            workspaceId: project.workspaceId,
            projectId,
            repository: body.repository,
            authMode: body.authMode,
            webhookToken: newWebhookToken(),
            encryptedWebhookSecret: encrypt(secret),
            encryptedToken: body.token === undefined ? null : encrypt(body.token),
            createdBy: userId,
          })
          .onConflictDoNothing({ target: githubConnections.projectId })
          .returning();
        return inserted ?? ('exists' as const);
      });
      if (result === 'project') return c.json(notFound, 404);
      if (result === 'exists')
        return c.json({ error: 'The project is already connected to GitHub' }, 409);
      return c.json(
        githubConnectionSecretResponseSchema.parse({
          secret,
          connection: connectionMetadata(result),
        }),
        201,
      );
    },
  )
  .patch(
    '/projects/:projectId',
    projectParam,
    zValidator('json', updateGithubConnectionSchema),
    async (c) => {
      const userId = c.get('user')!.id;
      const { projectId } = c.req.valid('param');
      const body = c.req.valid('json');
      const result = await db.transaction(async (tx) => {
        // The project first, as a delivery takes it: deleting a status locks the project before
        // its rules are cleared, so the two take turns rather than deadlock.
        await tx
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.id, projectId),
              inArray(projects.workspaceId, memberWorkspaces(tx, userId)),
            ),
          )
          .for('share');
        const [current] = await tx
          .select()
          .from(githubConnections)
          .where(
            and(
              eq(githubConnections.projectId, projectId),
              inArray(githubConnections.workspaceId, memberWorkspaces(tx, userId)),
            ),
          )
          .for('update');
        if (!current) return 'missing' as const;
        // A new token implies token mode; leaving token mode forgets the stored one.
        const authMode = body.authMode ?? (body.token === undefined ? current.authMode : 'token');
        const encryptedToken =
          authMode === 'webhook'
            ? null
            : body.token === undefined
              ? current.encryptedToken
              : encrypt(body.token);
        if (authMode === 'token' && encryptedToken === null) return 'token' as const;
        const targets = [
          ...new Set(
            Object.values(body.statusRules ?? {}).filter((id): id is string => id !== null),
          ),
        ];
        if (targets.length) {
          // Held until commit, so a status cannot be deleted between this check and the write.
          const found = await tx
            .select({ id: statuses.id })
            .from(statuses)
            .innerJoin(projects, eq(projects.id, statuses.projectId))
            .where(
              and(
                inArray(statuses.id, targets),
                eq(statuses.projectId, current.projectId),
                isNull(projects.deletedAt),
              ),
            )
            .for('key share', { of: statuses });
          if (found.length !== targets.length) return 'status' as const;
        }
        const [updated] = await tx
          .update(githubConnections)
          .set({
            ...(body.repository === undefined ? {} : { repository: body.repository }),
            ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
            ...statusRuleSet(body.statusRules ?? {}),
            authMode,
            encryptedToken,
          })
          .where(eq(githubConnections.id, current.id))
          .returning();
        return updated!;
      });
      if (result === 'missing') return c.json(notConnected, 404);
      if (result === 'token') return c.json({ error: 'Paste a token to use token mode' }, 400);
      if (result === 'status')
        return c.json({ error: 'Status rules must use statuses of this project' }, 400);
      return c.json(
        githubConnectionResponseSchema.parse({ connection: connectionMetadata(result) }),
      );
    },
  )
  .delete('/projects/:projectId', projectParam, async (c) => {
    const { projectId } = c.req.valid('param');
    const [deleted] = await db
      .delete(githubConnections)
      .where(
        and(
          eq(githubConnections.projectId, projectId),
          inArray(githubConnections.workspaceId, memberWorkspaces(db, c.get('user')!.id)),
        ),
      )
      .returning({ id: githubConnections.id });
    if (!deleted && !(await reachableProject(c.get('user')!.id, projectId)))
      return c.json(notFound, 404);
    return c.body(null, 204);
  })
  /** Replaces the webhook secret, which is shown once. */
  .post('/projects/:projectId/secret', projectParam, async (c) => {
    const userId = c.get('user')!.id;
    const { projectId } = c.req.valid('param');
    const current = await ownConnection(userId, projectId);
    if (!current) return c.json(notConnected, 404);
    const secret = newGithubWebhookSecret();
    const [updated] = await db
      .update(githubConnections)
      .set({ encryptedWebhookSecret: encrypt(secret) })
      .where(eq(githubConnections.id, current.id))
      .returning();
    if (!updated) return c.json(notConnected, 404);
    return c.json(
      githubConnectionSecretResponseSchema.parse({
        secret,
        connection: connectionMetadata(updated),
      }),
    );
  })
  /** Moves the inbound webhook to a new URL. The old one stops answering at once. */
  .post('/projects/:projectId/url', projectParam, async (c) => {
    const userId = c.get('user')!.id;
    const { projectId } = c.req.valid('param');
    const current = await ownConnection(userId, projectId);
    if (!current) return c.json(notConnected, 404);
    const [updated] = await db
      .update(githubConnections)
      .set({ webhookToken: newWebhookToken() })
      .where(eq(githubConnections.id, current.id))
      .returning();
    if (!updated) return c.json(notConnected, 404);
    return c.json(
      githubConnectionResponseSchema.parse({ connection: connectionMetadata(updated) }),
    );
  });
