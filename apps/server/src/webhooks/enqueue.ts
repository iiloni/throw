import type { StatusCategory, WebhookEvent, WebhookPayload } from '@throw/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Transaction } from '../db/client';
import { projects, webhookDeliveries, webhooks, workspaceMembers } from '../db/schema';
import type { WriteActor } from '../lib/writeActor';

export const WEBHOOK_CHANNEL = 'throw_webhooks';

export type WebhookChange = {
  event: WebhookEvent;
  workspaceId: string;
  projectId: string | null;
  /** Supplied when the project may already be gone, as in a purge. Looked up otherwise. */
  projectKey?: string | null;
  entityType: WebhookPayload['entityType'];
  kind: string;
  taskId?: string;
  taskNumber?: number;
  changedFields?: string[];
  statusTo?: { id: string; name: string; category: StatusCategory } | null;
};

export function buildPayload(
  deliveryId: string,
  change: WebhookChange,
  actor: WriteActor,
  projectKey: string | null,
  occurredAt: Date,
): WebhookPayload {
  const { taskNumber, projectKey: _key, ...rest } = change;
  return {
    deliveryId,
    event: rest.event,
    workspaceId: rest.workspaceId,
    projectId: rest.projectId,
    projectKey,
    entityType: rest.entityType,
    kind: rest.kind,
    ...(rest.taskId === undefined
      ? {}
      : {
          taskId: rest.taskId,
          taskKey:
            projectKey !== null && taskNumber !== undefined ? `${projectKey}-${taskNumber}` : null,
        }),
    actor: actor.tokenId
      ? { kind: 'token', viaTokenName: actor.viaTokenName }
      : { kind: 'user', viaTokenName: null },
    ...(rest.changedFields === undefined ? {} : { changedFields: rest.changedFields }),
    ...(rest.statusTo === undefined ? {} : { statusTo: rest.statusTo }),
    occurredAt: occurredAt.toISOString(),
  };
}

/** Whether an enabled webhook whose owner can reach the workspace announces a change. */
export function followsChange(
  webhook: { projectId: string | null; ignoreTokenWrites: boolean; projectTrashed: boolean },
  change: Pick<WebhookChange, 'projectId' | 'kind'>,
  actor: WriteActor,
) {
  if (actor.tokenId && webhook.ignoreTokenWrites) return false;
  if (webhook.projectId === null) return true;
  // A project in the trash is quiet, apart from the change that put it there.
  return (
    webhook.projectId === change.projectId && (!webhook.projectTrashed || change.kind === 'trashed')
  );
}

/** Structure writes record one entry per row. A transaction announces each project once. */
const structureDeliveries = new WeakMap<
  Transaction,
  Map<string, { ids: string[]; fields: string[] }>
>();

/**
 * Queues a delivery for each webhook that follows this change, in the write's transaction:
 * the change and its announcement commit or roll back together. The worker is woken when
 * the transaction commits.
 */
export async function enqueueWebhooks(tx: Transaction, actor: WriteActor, change: WebhookChange) {
  const structureKey = change.event === 'structure.updated' ? (change.projectId ?? '') : null;
  const merged = structureKey === null ? undefined : structureDeliveries.get(tx)?.get(structureKey);
  if (merged) {
    const fields = [...new Set([...merged.fields, ...(change.changedFields ?? [])])];
    if (fields.length !== merged.fields.length && merged.ids.length) {
      merged.fields = fields;
      await tx
        .update(webhookDeliveries)
        .set({
          payload: sql`jsonb_set(${webhookDeliveries.payload}, '{changedFields}', ${JSON.stringify(fields)}::jsonb)`,
        })
        .where(inArray(webhookDeliveries.id, merged.ids));
    }
    return;
  }

  const targets = await tx
    .select({
      id: webhooks.id,
      projectId: webhooks.projectId,
      ignoreTokenWrites: webhooks.ignoreTokenWrites,
      projectTrashed: sql<boolean>`${projects.deletedAt} IS NOT NULL`,
    })
    .from(webhooks)
    // The owner must still belong to the workspace.
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, webhooks.workspaceId),
        eq(workspaceMembers.userId, webhooks.userId),
      ),
    )
    .leftJoin(projects, eq(projects.id, webhooks.projectId))
    .where(and(eq(webhooks.workspaceId, change.workspaceId), eq(webhooks.enabled, true)));
  const matching = targets.filter((target) => followsChange(target, change, actor));

  let projectKey = change.projectKey ?? null;
  if (matching.length && change.projectKey === undefined && change.projectId !== null) {
    const [project] = await tx
      .select({ key: projects.key })
      .from(projects)
      .where(eq(projects.id, change.projectId));
    projectKey = project?.key ?? null;
  }
  const occurredAt = new Date();
  const rows = matching.map((target) => {
    const id = uuidv7();
    return {
      id,
      webhookId: target.id,
      event: change.event,
      payload: buildPayload(id, change, actor, projectKey, occurredAt),
    };
  });
  if (structureKey !== null) {
    const byProject = structureDeliveries.get(tx) ?? new Map();
    byProject.set(structureKey, {
      ids: rows.map((row) => row.id),
      fields: change.changedFields ?? [],
    });
    structureDeliveries.set(tx, byProject);
  }
  if (!rows.length) return;
  await tx.insert(webhookDeliveries).values(rows);
  // Postgres sends notifications at commit, and folds repeats within a transaction.
  await tx.execute(sql`SELECT pg_notify(${WEBHOOK_CHANNEL}, '')`);
}
