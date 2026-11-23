import type { ActivityChange, StatusCategory, WebhookEvent, WebhookPayload } from '@throw/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Transaction } from '../db/client';
import { projects, webhookDeliveries, webhooks, workspaceMembers } from '../db/schema';
import { memberWorkspaces } from '../lib/workspaces';
import type { WriteActor } from '../lib/writeActor';
import {
  coalesceKeyOf,
  type Folded,
  type FoldOutcome,
  fieldValues,
  foldStructure,
  foldTask,
  type WebhookFold,
} from './fold';

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
  /**
   * The activity items a task change applied, with their values before and after. A quiet
   * window compares them to tell a net change from one that was undone.
   */
  values?: readonly ActivityChange[];
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
  change: Pick<WebhookChange, 'projectId' | 'entityType' | 'kind'>,
  actor: WriteActor,
) {
  if (actor.tokenId && webhook.ignoreTokenWrites) return false;
  if (webhook.projectId === null) return true;
  // A project in the trash is quiet, apart from the change that put it there.
  const trashingProject = change.entityType === 'project' && change.kind === 'trashed';
  return webhook.projectId === change.projectId && (!webhook.projectTrashed || trashingProject);
}

type Target = { id: string; quietWindowSeconds: number };
type Fold = (
  waiting: { payload: WebhookPayload; fold: WebhookFold | null } | undefined,
  deliveryId: string,
) => Folded;

const now = sql`clock_timestamp()`;
const waitingRows = (webhookIds: string[], key: string) =>
  and(
    inArray(webhookDeliveries.webhookId, webhookIds),
    eq(webhookDeliveries.coalesceKey, key),
    inArray(webhookDeliveries.status, ['pending', 'held']),
    eq(webhookDeliveries.attempts, 0),
  );

/** Where a folded delivery goes: sent after the window from now, sent at once, or held. */
function scheduled(target: Target, outcome: Exclude<FoldOutcome, 'drop'>) {
  if (outcome === 'hold') return { status: 'held' as const };
  return {
    status: 'pending' as const,
    nextAttemptAt:
      outcome === 'now' ? now : sql`${now} + make_interval(secs => ${target.quietWindowSeconds})`,
  };
}

/**
 * Queues a change for webhooks with a quiet window. It folds into the webhook's waiting
 * delivery for the same task or project, whose window starts again, or starts one. The partial
 * unique index keeps one waiting delivery per key, so when a concurrent write inserts first
 * this one folds into it on the next round. A delivery the worker has claimed has left the
 * index and is not changed, so the change starts a new one.
 */
async function queueWaiting(tx: Transaction, targets: Target[], key: string, foldInto: Fold) {
  let pending = targets;
  for (let round = 0; pending.length && round < 3; round++) {
    const waiting = await tx
      .select({
        id: webhookDeliveries.id,
        webhookId: webhookDeliveries.webhookId,
        payload: webhookDeliveries.payload,
        fold: webhookDeliveries.fold,
      })
      .from(webhookDeliveries)
      .where(
        waitingRows(
          pending.map((target) => target.id),
          key,
        ),
      )
      .for('update');
    const byWebhook = new Map(waiting.map((row) => [row.webhookId, row]));
    for (const target of pending) {
      const row = byWebhook.get(target.id);
      if (!row) continue;
      const { payload, fold, outcome } = foldInto(row, row.id);
      await (outcome === 'drop'
        ? tx.delete(webhookDeliveries).where(eq(webhookDeliveries.id, row.id))
        : tx
            .update(webhookDeliveries)
            .set({ event: payload.event, payload, fold, ...scheduled(target, outcome) })
            .where(eq(webhookDeliveries.id, row.id)));
    }
    const missing = pending.filter((target) => !byWebhook.has(target.id));
    const rows = missing.flatMap((target) => {
      const id = uuidv7();
      const { payload, fold, outcome } = foldInto(undefined, id);
      if (outcome === 'drop') return [];
      return [
        {
          id,
          webhookId: target.id,
          event: payload.event,
          payload,
          fold,
          coalesceKey: key,
          ...scheduled(target, outcome),
        },
      ];
    });
    if (!rows.length) return;
    const inserted = await tx
      .insert(webhookDeliveries)
      .values(rows)
      .onConflictDoNothing()
      .returning({ webhookId: webhookDeliveries.webhookId });
    const done = new Set(inserted.map((row) => row.webhookId));
    pending = missing.filter((target) => !done.has(target.id));
  }
  // Never lose a change to contention: announce it on its own instead.
  const rows = pending.flatMap((target) => {
    const id = uuidv7();
    const { payload, outcome } = foldInto(undefined, id);
    return outcome === 'drop' || outcome === 'hold'
      ? []
      : [{ id, webhookId: target.id, event: payload.event, payload }];
  });
  if (rows.length) await tx.insert(webhookDeliveries).values(rows);
}

/** Structure writes record one entry per row. A transaction announces each project once. */
const structureDeliveries = new WeakMap<
  Transaction,
  Map<string, { ids: string[]; fields: string[]; waiting: Target[]; projectKey: string | null }>
>();

/**
 * Queues a delivery for each webhook that follows this change, in the write's transaction:
 * the change and its announcement commit or roll back together. A webhook with a quiet window
 * folds task and structure changes into its waiting delivery for the same task or project
 * (`queueWaiting`, `fold.ts`). The worker is woken when the transaction commits.
 */
export async function enqueueWebhooks(tx: Transaction, actor: WriteActor, change: WebhookChange) {
  const key = coalesceKeyOf(change);
  const occurredAt = new Date();
  const structureKey = change.event === 'structure.updated' ? (change.projectId ?? '') : null;
  const merged = structureKey === null ? undefined : structureDeliveries.get(tx)?.get(structureKey);
  if (merged) {
    const fields = [...new Set([...merged.fields, ...(change.changedFields ?? [])])];
    if (fields.length !== merged.fields.length) {
      merged.fields = fields;
      if (merged.ids.length)
        await tx
          .update(webhookDeliveries)
          .set({
            payload: sql`jsonb_set(${webhookDeliveries.payload}, '{changedFields}', ${JSON.stringify(fields)}::jsonb)`,
          })
          .where(inArray(webhookDeliveries.id, merged.ids));
      if (merged.waiting.length && key !== null)
        await queueWaiting(tx, merged.waiting, key, (waiting, id) =>
          foldStructure(waiting, buildPayload(id, change, actor, merged.projectKey, occurredAt)),
        );
    }
    return;
  }

  const targets = await tx
    .select({
      id: webhooks.id,
      projectId: webhooks.projectId,
      ignoreTokenWrites: webhooks.ignoreTokenWrites,
      quietWindowSeconds: webhooks.quietWindowSeconds,
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
    .where(and(eq(webhooks.workspaceId, change.workspaceId), eq(webhooks.enabled, true)))
    // A webhook deleted before this write commits would break the deliveries' foreign key.
    // Holding its key makes the delete wait for this transaction instead.
    .for('key share', { of: webhooks });
  const matching = targets.filter((target) => followsChange(target, change, actor));

  let projectKey = change.projectKey ?? null;
  if (matching.length && change.projectKey === undefined && change.projectId !== null) {
    const [project] = await tx
      .select({ key: projects.key })
      .from(projects)
      .where(
        and(
          eq(projects.id, change.projectId),
          inArray(projects.workspaceId, memberWorkspaces(tx, actor.userId, actor.workspaceId)),
        ),
      );
    projectKey = project?.key ?? null;
  }
  const payloadFor = (id: string) => buildPayload(id, change, actor, projectKey, occurredAt);
  const waiting = key === null ? [] : matching.filter((target) => target.quietWindowSeconds > 0);
  const rows = matching
    .filter((target) => !waiting.includes(target))
    .map((target) => {
      const id = uuidv7();
      return { id, webhookId: target.id, event: change.event, payload: payloadFor(id) };
    });
  if (structureKey !== null) {
    const byProject = structureDeliveries.get(tx) ?? new Map();
    byProject.set(structureKey, {
      ids: rows.map((row) => row.id),
      fields: change.changedFields ?? [],
      waiting,
      projectKey,
    });
    structureDeliveries.set(tx, byProject);
  }
  if (!matching.length) return;
  if (rows.length) await tx.insert(webhookDeliveries).values(rows);
  if (key !== null && waiting.length) {
    const values = change.values && fieldValues(change.values);
    await queueWaiting(tx, waiting, key, (prior, id) =>
      change.event === 'structure.updated'
        ? foldStructure(prior, payloadFor(id))
        : foldTask(prior, payloadFor(id), values),
    );
  }
  // Postgres sends notifications at commit, and folds repeats within a transaction. A delayed
  // delivery wakes the worker too, so it can schedule itself for when the delivery is due.
  await tx.execute(sql`SELECT pg_notify(${WEBHOOK_CHANNEL}, '')`);
}

/**
 * A shorter quiet window applies to deliveries already waiting: none waits longer than the new
 * window from now, and with no window they are sent at once. A longer one leaves them be.
 */
export async function shortenWaiting(tx: Transaction, webhookId: string, seconds: number) {
  const until = sql`clock_timestamp() + make_interval(secs => ${seconds})`;
  const shortened = await tx
    .update(webhookDeliveries)
    .set({ nextAttemptAt: until })
    .where(
      and(
        eq(webhookDeliveries.webhookId, webhookId),
        eq(webhookDeliveries.status, 'pending'),
        eq(webhookDeliveries.attempts, 0),
        sql`${webhookDeliveries.nextAttemptAt} > ${until}`,
      ),
    )
    .returning({ id: webhookDeliveries.id });
  if (shortened.length) await tx.execute(sql`SELECT pg_notify(${WEBHOOK_CHANNEL}, '')`);
}
