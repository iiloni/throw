import { createHmac } from 'node:crypto';
import { MAX_GITHUB_WEBHOOK_BYTES } from '@throw/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../db/client';
import { encryptSecret } from '../webhooks/signing';
import type { GithubEventHandler } from './dispatch';
import {
  type GithubReceiverStore,
  githubReceiver,
  type LastDelivery,
  parsePayload,
  RECEIVER_ERRORS,
  type ReceiverConnection,
  repositoryOf,
} from './receive';
import { githubSecretKey, newGithubWebhookSecret, newWebhookToken } from './secrets';

const key = githubSecretKey('server-secret-server-secret-server-secret');
const secret = newGithubWebhookSecret();
const token = newWebhookToken();
const at = new Date('2026-11-26T10:00:00.000Z');

/** The receiver's store in memory, with the database's all-or-nothing transaction. */
function memoryStore(connection: ReceiverConnection) {
  const claimed = new Set<string>();
  const last: LastDelivery[] = [];
  const store: GithubReceiverStore = {
    connection: vi.fn(async (asked: string) => (asked === token ? connection : undefined)),
    async accept(_connection, delivery, handle) {
      if (claimed.has(delivery.id)) return 'duplicate';
      claimed.add(delivery.id);
      try {
        const handled = await handle({} as Transaction);
        last.push({
          at,
          id: delivery.id,
          event: delivery.event,
          status: handled.status,
          detail: handled.status === 'ignored' ? handled.reason : null,
        });
        return handled;
      } catch (error) {
        claimed.delete(delivery.id);
        throw error;
      }
    },
    async record(_id, delivery) {
      last.push(delivery);
    },
  };
  return { store, claimed, last };
}

const baseConnection: ReceiverConnection = {
  id: '019a0000-0000-7000-8000-000000000001',
  workspaceId: '019a0000-0000-7000-8000-000000000002',
  projectId: '019a0000-0000-7000-8000-000000000003',
  repository: 'iiloni/throw',
  enabled: true,
  encryptedWebhookSecret: encryptSecret(secret, key),
  projectTrashed: false,
};

const sign = (body: string, using = secret) =>
  `sha256=${createHmac('sha256', using).update(body).digest('hex')}`;

const ping = JSON.stringify({
  zen: 'Keep it logically awesome.',
  hook_id: 1,
  repository: { full_name: 'iiloni/throw' },
});

function setup(
  connection: Partial<ReceiverConnection> = {},
  handlers?: Record<string, GithubEventHandler>,
) {
  const memory = memoryStore({ ...baseConnection, ...connection });
  const app = githubReceiver({ store: memory.store, key, handlers, now: () => at });
  const deliver = (
    body: string,
    {
      event = 'ping',
      delivery = '72d3162e-cc78-11e3-81ab-4c9367dc0958',
      signature = sign(body),
      contentType = 'application/json',
      path = `/${token}`,
    }: Partial<Record<'event' | 'delivery' | 'signature' | 'contentType' | 'path', string>> = {},
  ) =>
    app.request(path, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'X-GitHub-Event': event,
        'X-GitHub-Delivery': delivery,
        'X-Hub-Signature-256': signature,
      },
      body,
    });
  return { ...memory, deliver };
}

describe('githubReceiver', () => {
  let handled: ReturnType<typeof vi.fn<GithubEventHandler>>;
  beforeEach(() => {
    handled = vi.fn<GithubEventHandler>(async () => ({ status: 'ok' }));
  });

  it('accepts GitHub’s signed ping and records it', async () => {
    const { deliver, last } = setup();
    const response = await deliver(ping);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: true, status: 'ok' });
    expect(last).toEqual([
      {
        at,
        id: '72d3162e-cc78-11e3-81ab-4c9367dc0958',
        event: 'ping',
        status: 'ok',
        detail: null,
      },
    ]);
  });

  it('refuses an unknown or malformed token without reading the body', async () => {
    const { deliver, store, last } = setup();
    expect((await deliver(ping, { path: `/${newWebhookToken()}` })).status).toBe(404);
    expect((await deliver(ping, { path: '/short' })).status).toBe(404);
    expect(store.connection).toHaveBeenCalledTimes(1);
    expect(last).toEqual([]);
  });

  it('refuses and records a missing or wrong signature', async () => {
    const { deliver, claimed, last } = setup({}, { ping: handled });
    for (const signature of ['', sign(ping, 'another secret'), sign(`${ping} `)]) {
      const response = await deliver(ping, { signature });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: RECEIVER_ERRORS.signature });
    }
    expect(handled).not.toHaveBeenCalled();
    expect(claimed.size).toBe(0);
    expect(last.map(({ status, detail }) => [status, detail])).toEqual(
      Array(3).fill(['error', RECEIVER_ERRORS.signature]),
    );
  });

  it('answers a redelivery without handling it twice', async () => {
    const { deliver, last } = setup({}, { pull_request: handled });
    const body = JSON.stringify({ action: 'opened', repository: { full_name: 'iiloni/throw' } });
    const first = await deliver(body, { event: 'pull_request', delivery: 'd-1' });
    expect(first.status).toBe(200);
    const again = await deliver(body, { event: 'pull_request', delivery: 'd-1' });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, duplicate: true });
    expect(handled).toHaveBeenCalledTimes(1);
    expect(handled.mock.calls[0]?.[1]).toMatchObject({
      event: 'pull_request',
      deliveryId: 'd-1',
      payload: { action: 'opened' },
      connection: { id: baseConnection.id, projectId: baseConnection.projectId },
    });
    expect((await deliver(body, { event: 'pull_request', delivery: 'd-2' })).status).toBe(200);
    expect(handled).toHaveBeenCalledTimes(2);
    expect(last[1]).toMatchObject({
      id: 'd-1',
      status: 'ignored',
      detail: 'This delivery was already received.',
    });
    expect(last).toHaveLength(3);
  });

  it('leaves a failed delivery unclaimed, so GitHub’s redelivery is handled', async () => {
    handled.mockRejectedValueOnce(new Error('boom'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { deliver, last } = setup({}, { ping: handled });
      const failed = await deliver(ping);
      expect(failed.status).toBe(500);
      expect(last.at(-1)).toMatchObject({ status: 'error', detail: RECEIVER_ERRORS.failed });
      expect(String(errors.mock.calls[0]?.join(' '))).not.toContain('logically awesome');
      expect((await deliver(ping)).status).toBe(200);
      expect(handled).toHaveBeenCalledTimes(2);
      expect(last.at(-1)).toMatchObject({ status: 'ok' });
    } finally {
      errors.mockRestore();
    }
  });

  it('refuses a delivery for another repository, or none, but not another case', async () => {
    const { deliver, last } = setup({}, { ping: handled });
    const other = await deliver(JSON.stringify({ repository: { full_name: 'iiloni/catch' } }));
    expect(other.status).toBe(422);
    expect(last.at(-1)).toMatchObject({
      status: 'error',
      detail: 'The delivery is for iiloni/catch, not iiloni/throw.',
    });
    // An organization's or app's ping names no repository.
    expect(
      (await deliver(JSON.stringify({ zen: 'hi', hook: { type: 'Organization' } }))).status,
    ).toBe(422);
    expect(last.at(-1)?.detail).toBe('The delivery is for no repository, not iiloni/throw.');
    expect(handled).not.toHaveBeenCalled();
    const cased = await deliver(JSON.stringify({ repository: { full_name: 'IiLoni/Throw' } }));
    expect(cased.status).toBe(200);
  });

  it('reads form-encoded deliveries, whose signature covers the encoded body', async () => {
    const { deliver } = setup({}, { ping: handled });
    const body = new URLSearchParams({ payload: ping }).toString();
    const response = await deliver(body, { contentType: 'application/x-www-form-urlencoded' });
    expect(response.status).toBe(200);
    expect(handled.mock.calls[0]?.[1].payload).toMatchObject({ hook_id: 1 });
  });

  it('refuses signed bodies that are not JSON objects, and bad headers', async () => {
    const { deliver, last } = setup();
    for (const body of ['not json', '[1]', 'null']) expect((await deliver(body)).status).toBe(400);
    expect(last.at(-1)?.detail).toBe(RECEIVER_ERRORS.body);
    expect((await deliver(ping, { event: 'Ping!' })).status).toBe(400);
    expect((await deliver(ping, { delivery: '' })).status).toBe(400);
    expect(last.at(-1)).toMatchObject({ detail: RECEIVER_ERRORS.headers, id: null });
  });

  it('ignores events nothing follows, and records why', async () => {
    const { deliver, claimed, last } = setup();
    const body = JSON.stringify({
      ref: 'refs/heads/main',
      repository: { full_name: 'iiloni/throw' },
    });
    const response = await deliver(body, { event: 'release', delivery: 'p-1' });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      ok: true,
      status: 'ignored',
      reason: 'Throw does not use release events',
    });
    expect(claimed.has('p-1')).toBe(true);
    expect(last.at(-1)).toMatchObject({ status: 'ignored', event: 'release' });
  });

  it('records but does not handle or claim deliveries while off or trashed', async () => {
    for (const [connection, reason] of [
      [{ enabled: false }, 'The connection is off.'],
      [{ projectTrashed: true }, 'The project is in the trash.'],
    ] as const) {
      const { deliver, claimed, last } = setup(connection, { ping: handled });
      const response = await deliver(ping);
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ ok: true, status: 'ignored', reason });
      expect(claimed.size).toBe(0);
      expect(last.at(-1)).toMatchObject({ status: 'ignored', detail: reason });
    }
    expect(handled).not.toHaveBeenCalled();
  });

  it('fails closed when the stored secret cannot be read', async () => {
    const { deliver, last } = setup({
      encryptedWebhookSecret: encryptSecret(
        secret,
        githubSecretKey('a-different-server-secret-xx'),
      ),
    });
    expect((await deliver(ping)).status).toBe(500);
    expect(last.at(-1)?.detail).toBe(RECEIVER_ERRORS.secret);
  });

  it('refuses bodies over GitHub’s 25 MB cap', async () => {
    const { deliver, last } = setup();
    const response = await deliver('x'.repeat(MAX_GITHUB_WEBHOOK_BYTES + 1));
    expect(response.status).toBe(413);
    expect(last).toEqual([]);
  });
});

describe('payload helpers', () => {
  it('read the repository a delivery names', () => {
    expect(repositoryOf({ repository: { full_name: 'o/r' } })).toBe('o/r');
    expect(repositoryOf({ repository: null })).toBeNull();
    expect(repositoryOf({})).toBeNull();
  });

  it('refuse invalid UTF-8 and form bodies without a payload', () => {
    expect(parsePayload(new Uint8Array([0x7b, 0xff, 0x7d]), 'application/json')).toBeNull();
    expect(
      parsePayload(new TextEncoder().encode('other=1'), 'application/x-www-form-urlencoded'),
    ).toBeNull();
  });
});
