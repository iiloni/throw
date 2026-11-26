import {
  GITHUB_HEADERS,
  type GithubDeliveryStatus,
  MAX_GITHUB_WEBHOOK_BYTES,
  sameGithubRepository,
} from '@throw/shared';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { Transaction } from '../db/client';
import { decryptSecret } from '../webhooks/signing';
import { dispatchGithubEvent, type GithubHandled, type GithubHandlers } from './dispatch';
import { verifyGithubSignature, WEBHOOK_TOKEN } from './secrets';

/** What the receiver needs of a connection, found by its URL token. */
export type ReceiverConnection = {
  id: string;
  workspaceId: string;
  projectId: string;
  repository: string;
  enabled: boolean;
  encryptedWebhookSecret: string;
  projectTrashed: boolean;
};

export type LastDelivery = {
  at: Date;
  id: string | null;
  event: string | null;
  status: GithubDeliveryStatus;
  /** Why it was ignored or refused. */
  detail: string | null;
};

export interface GithubReceiverStore {
  connection(token: string): Promise<ReceiverConnection | undefined>;
  /**
   * In one transaction: claims the delivery ID, runs `handle`, and records the outcome as the
   * connection's last delivery. `duplicate` when the ID was claimed before, by an earlier
   * delivery or a concurrent one that committed.
   */
  accept(
    connection: ReceiverConnection,
    delivery: { id: string; event: string },
    handle: (tx: Transaction) => Promise<GithubHandled>,
  ): Promise<GithubHandled | 'duplicate'>;
  /** Records a delivery that was refused or not handled. */
  record(connectionId: string, delivery: LastDelivery): Promise<void>;
}

// GitHub's event names are snake_case words; delivery IDs are GUIDs. Anything else is refused
// before it is stored or shown.
const EVENT = /^[a-z][a-z0-9_]{0,63}$/;
const DELIVERY = /^[A-Za-z0-9-]{1,100}$/;

const repositorySchema = z.object({ repository: z.object({ full_name: z.string() }) });

/**
 * The body as an object. GitHub sends JSON, or a form with a `payload` field when the webhook's
 * content type is `application/x-www-form-urlencoded`.
 */
export function parsePayload(
  body: Uint8Array,
  contentType: string | undefined,
): Record<string, unknown> | null {
  try {
    let text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    if (contentType?.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
      const field = new URLSearchParams(text).get('payload');
      if (field === null) return null;
      text = field;
    }
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The `owner/repo` a delivery is about, or null when it names none (an organization's ping). */
export function repositoryOf(payload: Record<string, unknown>) {
  const parsed = repositorySchema.safeParse(payload);
  return parsed.success ? parsed.data.repository.full_name : null;
}

export const RECEIVER_ERRORS = {
  secret: 'Throw cannot read this connection’s webhook secret. Make a new secret.',
  signature: 'The signature did not match. Check the secret in the GitHub webhook’s settings.',
  headers: 'The delivery had no valid X-GitHub-Event or X-GitHub-Delivery header.',
  body: 'The body was not a JSON object.',
  failed: 'Throw could not handle this delivery.',
} as const;

/**
 * GitHub's signed webhooks for one connection, at `…/:token`. No session: the token finds the
 * connection and the signature proves GitHub sent the body. A redelivery of an accepted
 * `X-GitHub-Delivery` is answered without being handled again.
 */
export function githubReceiver({
  store,
  key,
  handlers,
  now = () => new Date(),
}: {
  store: GithubReceiverStore;
  key: Buffer;
  handlers?: GithubHandlers;
  now?: () => Date;
}) {
  return new Hono().post(
    '/:token',
    async (c, next) => {
      c.header('Cache-Control', 'no-store');
      await next();
    },
    bodyLimit({
      maxSize: MAX_GITHUB_WEBHOOK_BYTES,
      onError: (c) => c.json({ error: 'The delivery is too large' }, 413),
    }),
    async (c) => {
      const token = c.req.param('token');
      const connection = WEBHOOK_TOKEN.test(token) ? await store.connection(token) : undefined;
      // Unknown tokens are refused before the body is read.
      if (!connection) return c.json({ error: 'Not found' }, 404);

      const eventHeader = c.req.header(GITHUB_HEADERS.event) ?? '';
      const deliveryHeader = c.req.header(GITHUB_HEADERS.delivery) ?? '';
      const event = EVENT.test(eventHeader) ? eventHeader : null;
      const deliveryId = DELIVERY.test(deliveryHeader) ? deliveryHeader : null;
      const record = (status: GithubDeliveryStatus, detail: string | null) =>
        store.record(connection.id, { at: now(), id: deliveryId, event, status, detail });
      const refuse = async (error: string, status: 400 | 401 | 422 | 500) => {
        await record('error', error);
        return c.json({ error }, status);
      };

      const body = new Uint8Array(await c.req.arrayBuffer());
      const secret = decryptSecret(connection.encryptedWebhookSecret, key);
      if (!secret) return refuse(RECEIVER_ERRORS.secret, 500);
      if (!verifyGithubSignature(secret, body, c.req.header(GITHUB_HEADERS.signature)))
        return refuse(RECEIVER_ERRORS.signature, 401);
      if (!event || !deliveryId) return refuse(RECEIVER_ERRORS.headers, 400);
      const payload = parsePayload(body, c.req.header('content-type'));
      if (!payload) return refuse(RECEIVER_ERRORS.body, 400);
      const repository = repositoryOf(payload);
      if (!repository || !sameGithubRepository(repository, connection.repository))
        return refuse(
          `The delivery is for ${repository ?? 'no repository'}, not ${connection.repository}.`,
          422,
        );

      // Not claimed, so a delivery redelivered once the connection is back on is handled.
      const quiet = !connection.enabled
        ? 'The connection is off.'
        : connection.projectTrashed
          ? 'The project is in the trash.'
          : null;
      if (quiet) {
        await record('ignored', quiet);
        return c.json({ ok: true, status: 'ignored', reason: quiet }, 202);
      }

      let handled: GithubHandled | 'duplicate';
      try {
        handled = await store.accept(connection, { id: deliveryId, event }, (tx) =>
          dispatchGithubEvent(
            tx,
            {
              connection: {
                id: connection.id,
                workspaceId: connection.workspaceId,
                projectId: connection.projectId,
                repository: connection.repository,
              },
              event,
              deliveryId,
              payload,
            },
            handlers,
          ),
        );
      } catch (error) {
        // The payload can hold private repository content, so only the failure is logged.
        console.error(
          `GitHub delivery ${deliveryId} (${event}) failed:`,
          error instanceof Error ? error.message : error,
        );
        await record('error', RECEIVER_ERRORS.failed);
        return c.json({ error: RECEIVER_ERRORS.failed }, 500);
      }
      if (handled === 'duplicate') return c.json({ ok: true, duplicate: true });
      return handled.status === 'ok'
        ? c.json({ ok: true, status: 'ok' })
        : c.json({ ok: true, status: 'ignored', reason: handled.reason }, 202);
    },
  );
}
