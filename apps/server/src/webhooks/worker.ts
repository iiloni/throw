import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { sql as client, db } from '../db/client';
import { webhookDeliveries, webhooks, workspaceMembers } from '../db/schema';
import { webhookPolicy, webhookSecretKey } from './config';
import { WEBHOOK_CHANNEL } from './enqueue';
import { retryDelayMs, type SendResult, sendWebhook } from './send';
import { decryptSecret } from './signing';

/** A claimed delivery is someone's for this long; a crash mid-send frees it after. */
const LEASE = sql`interval '2 minutes'`;
const BATCH = 20;
const IDLE_POLL_MS = 30_000;
const KEEP_FINISHED = sql`interval '1 day'`;

type Delivery = typeof webhookDeliveries.$inferSelect;

async function claim(): Promise<Delivery[]> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE ${webhookDeliveries} AS d
    SET attempts = d.attempts + 1, next_attempt_at = now() + ${LEASE}
    FROM (
      SELECT id FROM ${webhookDeliveries}
      WHERE status = 'pending' AND next_attempt_at <= now()
      ORDER BY next_attempt_at, id
      LIMIT ${BATCH}
      FOR UPDATE SKIP LOCKED
    ) AS due
    WHERE d.id = due.id
    RETURNING d.id`);
  if (!rows.length) return [];
  return db
    .select()
    .from(webhookDeliveries)
    .where(
      inArray(
        webhookDeliveries.id,
        rows.map((row) => row.id),
      ),
    );
}

/** Records how a send went on the webhook, for its Settings row. */
export function recordOutcome(webhookId: string, result: SendResult) {
  return db
    .update(webhooks)
    .set({
      lastDeliveryAt: sql`now()`,
      lastDeliveryStatus: result.ok ? 'ok' : 'error',
      lastResponseStatus: result.responseStatus,
      lastError: result.error,
    })
    .where(eq(webhooks.id, webhookId));
}

function finish(id: string, set: PgUpdateSetSource<typeof webhookDeliveries>) {
  return db.update(webhookDeliveries).set(set).where(eq(webhookDeliveries.id, id));
}

async function deliver(delivery: Delivery) {
  // Checked at send time too: the owner may have left the workspace since the change.
  const [hook] = await db
    .select({
      url: webhooks.url,
      enabled: webhooks.enabled,
      encryptedSecret: webhooks.encryptedSecret,
      member: workspaceMembers.userId,
    })
    .from(webhooks)
    .leftJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, webhooks.workspaceId),
        eq(workspaceMembers.userId, webhooks.userId),
      ),
    )
    .where(eq(webhooks.id, delivery.webhookId));
  if (!hook) return;
  const refusal = !hook.enabled
    ? 'The webhook was turned off'
    : !hook.member
      ? 'Workspace access ended'
      : null;
  if (refusal) {
    await finish(delivery.id, { status: 'failed', lastError: refusal });
    return;
  }
  const secret = decryptSecret(hook.encryptedSecret, webhookSecretKey);
  if (!secret) {
    const result = {
      ok: false,
      responseStatus: null,
      error: 'The signing secret cannot be read. Make a new secret.',
    };
    await finish(delivery.id, { status: 'failed', lastError: result.error });
    await recordOutcome(delivery.webhookId, result);
    return;
  }

  const result = await sendWebhook(
    {
      url: hook.url,
      secret,
      event: delivery.payload.event,
      deliveryId: delivery.id,
      body: JSON.stringify(delivery.payload),
    },
    webhookPolicy,
  );
  if (result.ok) {
    await finish(delivery.id, { status: 'delivered', deliveredAt: sql`now()`, lastError: null });
  } else {
    const delay = retryDelayMs(delivery.attempts);
    await finish(
      delivery.id,
      delay === null
        ? { status: 'failed', lastError: result.error }
        : {
            lastError: result.error,
            nextAttemptAt: sql`now() + ${`${delay} milliseconds`}::interval`,
          },
    );
  }
  await recordOutcome(delivery.webhookId, result);
}

async function nextDueInMs() {
  const [row] = await db.execute<{ wait: number | null }>(sql`
    SELECT (extract(epoch FROM min(next_attempt_at) - now()) * 1000)::float8 AS wait
    FROM ${webhookDeliveries} WHERE status = 'pending'`);
  return row?.wait === null || row?.wait === undefined ? null : Math.max(0, Number(row.wait));
}

async function prune() {
  await db.execute(sql`
    DELETE FROM ${webhookDeliveries}
    WHERE status <> 'pending' AND created_at < now() - ${KEEP_FINISHED}`);
}

/**
 * Sends queued deliveries in the background. A commit that queues one wakes it through
 * LISTEN; retries and deliveries waiting out a quiet window wake it when they are due (every
 * queueing or folding commit notifies, so a sooner due time is picked up at once). It pauses
 * while a backup or restore runs.
 */
export function startWebhookWorker({ paused }: { paused: () => boolean }) {
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let again = false;
  let stopped = false;
  let lastPrune = 0;
  let unlisten: (() => Promise<void>) | undefined;

  const schedule = (ms: number) => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(run, Math.min(ms, IDLE_POLL_MS));
    timer.unref();
  };

  function wake() {
    if (stopped) return;
    if (running) again = true;
    else schedule(0);
  }

  async function run() {
    if (running || stopped) return;
    running = true;
    let wait = IDLE_POLL_MS;
    try {
      if (paused()) {
        wait = 5_000;
        return;
      }
      for (let batch = await claim(); batch.length && !stopped; batch = await claim()) {
        await Promise.all(
          batch.map((delivery) =>
            deliver(delivery).catch((error: unknown) =>
              console.error('Webhook delivery failed', error),
            ),
          ),
        );
      }
      if (Date.now() - lastPrune > 3_600_000) {
        lastPrune = Date.now();
        await prune();
      }
      wait = (await nextDueInMs()) ?? IDLE_POLL_MS;
    } catch (error) {
      console.error('Webhook worker failed', error);
    } finally {
      running = false;
      if (again) {
        again = false;
        schedule(0);
      } else schedule(wait);
    }
  }

  client
    .listen(WEBHOOK_CHANNEL, wake)
    .then((listener) => {
      unlisten = listener.unlisten;
      if (stopped) void unlisten();
    })
    .catch((error: unknown) => console.error('Webhook worker could not listen', error));
  schedule(0);

  return {
    wake,
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await unlisten?.();
    },
  };
}
