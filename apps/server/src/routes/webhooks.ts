import { zValidator } from '@hono/zod-validator';
import {
  createWebhookSchema,
  updateWebhookSchema,
  type Webhook,
  webhookResponseSchema,
  webhookSecretResponseSchema,
  webhooksResponseSchema,
  webhookTestResponseSchema,
} from '@throw/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { type Db, db, type Transaction } from '../db/client';
import { projects, webhooks, workspaces } from '../db/schema';
import { requireUser } from '../lib/requireUser';
import { isMember, memberWorkspaces } from '../lib/workspaces';
import { webhookPolicy, webhookSecretKey } from '../webhooks/config';
import { buildPayload, shortenWaiting } from '../webhooks/enqueue';
import { checkWebhookUrl } from '../webhooks/policy';
import { sendWebhook } from '../webhooks/send';
import { decryptSecret, encryptSecret, newWebhookSecret } from '../webhooks/signing';
import { recordOutcome } from '../webhooks/worker';

type Row = typeof webhooks.$inferSelect;

/** Metadata only: the secret is shown when it is made and never again. */
function metadata(row: Row): Webhook {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    name: row.name,
    url: row.url,
    ignoreTokenWrites: row.ignoreTokenWrites,
    enabled: row.enabled,
    quietWindowSeconds: row.quietWindowSeconds,
    createdAt: row.createdAt.toISOString(),
    lastDeliveryAt: row.lastDeliveryAt?.toISOString() ?? null,
    lastDeliveryStatus: row.lastDeliveryStatus ?? null,
    lastResponseStatus: row.lastResponseStatus ?? null,
    lastError: row.lastError ?? null,
  };
}

/** A project the user can reach, active, in the given workspace. */
async function activeProject(
  queryable: Db | Transaction,
  userId: string,
  workspaceId: string,
  projectId: string,
) {
  const [project] = await queryable
    .select({ id: projects.id, key: projects.key })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.workspaceId, workspaceId),
        isNull(projects.deletedAt),
        inArray(projects.workspaceId, memberWorkspaces(queryable, userId)),
      ),
    );
  return project;
}

const ownWebhook = (userId: string, id: string) =>
  db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.userId, userId)))
    .then(([row]) => row);

const idParam = zValidator('param', z.object({ id: z.uuid() }));

export const webhookRoutes = new Hono<AppEnv>()
  .use(async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  })
  .use(requireUser)
  .get('/', async (c) => {
    const userId = c.get('user')!.id;
    const [rows, reachable, active] = await Promise.all([
      db
        .select()
        .from(webhooks)
        .where(eq(webhooks.userId, userId))
        .orderBy(webhooks.createdAt, webhooks.id),
      db
        .select({ id: workspaces.id, name: workspaces.name })
        .from(workspaces)
        .where(inArray(workspaces.id, memberWorkspaces(db, userId)))
        .orderBy(workspaces.name, workspaces.id),
      db
        .select({
          id: projects.id,
          workspaceId: projects.workspaceId,
          name: projects.name,
          key: projects.key,
        })
        .from(projects)
        .where(
          and(
            inArray(projects.workspaceId, memberWorkspaces(db, userId)),
            isNull(projects.deletedAt),
          ),
        )
        .orderBy(projects.position, projects.id),
    ]);
    return c.json(
      webhooksResponseSchema.parse({
        webhooks: rows.map(metadata),
        quietWindow: true,
        workspaces: reachable.map((workspace) => ({
          ...workspace,
          projects: active
            .filter((project) => project.workspaceId === workspace.id)
            .map(({ id, name, key }) => ({ id, name, key })),
        })),
      }),
    );
  })
  .post('/', zValidator('json', createWebhookSchema), async (c) => {
    const userId = c.get('user')!.id;
    const body = c.req.valid('json');
    const url = checkWebhookUrl(body.url, webhookPolicy);
    if (!url.ok) return c.json({ error: url.reason }, 400);
    const secret = newWebhookSecret();
    const row = await db.transaction(async (tx) => {
      const [workspace] = await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(
          and(
            eq(workspaces.id, body.workspaceId),
            inArray(workspaces.id, memberWorkspaces(tx, userId)),
          ),
        )
        .for('key share');
      if (!workspace) return 'workspace';
      if (body.projectId && !(await activeProject(tx, userId, body.workspaceId, body.projectId)))
        return 'project';
      const [inserted] = await tx
        .insert(webhooks)
        .values({
          id: uuidv7(),
          userId,
          workspaceId: body.workspaceId,
          projectId: body.projectId,
          name: body.name,
          url: url.checked.url.toString(),
          encryptedSecret: encryptSecret(secret, webhookSecretKey),
          ignoreTokenWrites: body.ignoreTokenWrites,
          quietWindowSeconds: body.quietWindowSeconds ?? 0,
        })
        .returning();
      return inserted!;
    });
    if (row === 'workspace') return c.json({ error: 'Workspace not found' }, 404);
    if (row === 'project') return c.json({ error: 'Project not found' }, 404);
    return c.json(webhookSecretResponseSchema.parse({ secret, webhook: metadata(row) }), 201);
  })
  .patch('/:id', idParam, zValidator('json', updateWebhookSchema), async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const current = await ownWebhook(userId, id);
    // A webhook for a workspace the owner has left can still be listed and deleted.
    if (!current || !(await isMember(db, userId, current.workspaceId)))
      return c.json({ error: 'Webhook not found' }, 404);
    let url: string | undefined;
    if (body.url !== undefined) {
      const checked = checkWebhookUrl(body.url, webhookPolicy);
      if (!checked.ok) return c.json({ error: checked.reason }, 400);
      url = checked.checked.url.toString();
    }
    if (body.projectId && !(await activeProject(db, userId, current.workspaceId, body.projectId)))
      return c.json({ error: 'Project not found' }, 404);
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(webhooks)
        .set({ ...body, ...(url === undefined ? {} : { url }) })
        .where(and(eq(webhooks.id, id), eq(webhooks.userId, userId)))
        .returning();
      if (row && body.quietWindowSeconds !== undefined)
        await shortenWaiting(tx, row.id, body.quietWindowSeconds);
      return row;
    });
    if (!updated) return c.json({ error: 'Webhook not found' }, 404);
    return c.json(webhookResponseSchema.parse({ webhook: metadata(updated) }));
  })
  .delete('/:id', idParam, async (c) => {
    const { id } = c.req.valid('param');
    await db
      .delete(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.userId, c.get('user')!.id)));
    return c.body(null, 204);
  })
  /** Replaces the signing secret, which is shown once. */
  .post('/:id/secret', idParam, async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const current = await ownWebhook(userId, id);
    if (!current || !(await isMember(db, userId, current.workspaceId)))
      return c.json({ error: 'Webhook not found' }, 404);
    const secret = newWebhookSecret();
    const [updated] = await db
      .update(webhooks)
      .set({ encryptedSecret: encryptSecret(secret, webhookSecretKey) })
      .where(and(eq(webhooks.id, id), eq(webhooks.userId, userId)))
      .returning();
    if (!updated) return c.json({ error: 'Webhook not found' }, 404);
    return c.json(webhookSecretResponseSchema.parse({ secret, webhook: metadata(updated) }));
  })
  /** Sends a `webhook.test` delivery now and answers with how it went. */
  .post('/:id/test', idParam, async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const hook = await ownWebhook(userId, id);
    if (!hook || !(await isMember(db, userId, hook.workspaceId)))
      return c.json({ error: 'Webhook not found' }, 404);
    const deliveryId = uuidv7();
    const project = hook.projectId
      ? await activeProject(db, userId, hook.workspaceId, hook.projectId)
      : undefined;
    const payload = buildPayload(
      deliveryId,
      {
        event: 'webhook.test',
        workspaceId: hook.workspaceId,
        projectId: hook.projectId,
        entityType: 'webhook',
        kind: 'test',
      },
      { userId },
      project?.key ?? null,
      new Date(),
    );
    const secret = decryptSecret(hook.encryptedSecret, webhookSecretKey);
    const result = secret
      ? await sendWebhook(
          {
            url: hook.url,
            secret,
            event: 'webhook.test',
            deliveryId,
            body: JSON.stringify(payload),
          },
          webhookPolicy,
        )
      : {
          ok: false,
          responseStatus: null,
          error: 'The signing secret cannot be read. Make a new secret.',
        };
    await recordOutcome(hook.id, result);
    const updated = await ownWebhook(userId, id);
    return c.json(
      webhookTestResponseSchema.parse({
        deliveryId,
        ...result,
        webhook: metadata(updated ?? hook),
      }),
    );
  });
