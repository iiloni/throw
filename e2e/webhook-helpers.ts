import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { expect } from '@playwright/test';
import { z } from 'zod';
import { type WebhookPayload, webhookPayloadSchema } from '../packages/shared/src/webhooks';

const requestLine = z.object({
  method: z.string(),
  url: z.string(),
  headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  body: z.string(),
});

export type ReceivedWebhook = z.infer<typeof requestLine> & { payload: WebhookPayload };

/**
 * Starts a receiver in this worktree's app container, where the dev server may deliver to
 * plain-HTTP loopback (`WEBHOOK_ALLOW_LOOPBACK_HTTP`). Close it at the end of the test.
 */
export async function startReceiver() {
  const child = spawn('./scripts/dev.sh', ['exec', 'node', 'e2e/webhook-receiver.mjs'], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const lines = createInterface({ input: child.stdout });
  const exited = once(child, 'close');
  const received: ReceivedWebhook[] = [];
  let port: number | undefined;
  const ready = new Promise<number>((resolve) => {
    lines.on('line', (line) => {
      const value: unknown = JSON.parse(line);
      const started = z.object({ port: z.number() }).safeParse(value);
      if (started.success) {
        port = started.data.port;
        resolve(port);
        return;
      }
      const request = requestLine.parse(value);
      received.push({ ...request, payload: webhookPayloadSchema.parse(JSON.parse(request.body)) });
    });
  });
  await Promise.race([
    ready,
    exited.then(() => {
      throw new Error('The webhook receiver exited before it started');
    }),
  ]);

  return {
    received,
    url: (path = '/hook') => `http://127.0.0.1:${port}${path}`,
    /** Waits for the first delivery after `skip` that matches. */
    async next(match: (webhook: ReceivedWebhook) => boolean, skip = 0) {
      await expect.poll(() => received.slice(skip).some(match), { timeout: 20_000 }).toBe(true);
      return received.slice(skip).find(match)!;
    },
    async close() {
      child.stdin.end();
      await exited;
    },
  };
}

/** Checks Throw's signature over the exact bytes received. */
export function expectSigned(webhook: ReceivedWebhook, secret: string) {
  const header = (name: string) => {
    const value = webhook.headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const expected = createHmac('sha256', secret).update(webhook.body, 'utf8').digest('hex');
  expect(header('x-throw-signature')).toBe(`sha256=${expected}`);
  expect(header('x-throw-delivery')).toBe(webhook.payload.deliveryId);
  expect(header('x-throw-event')).toBe(webhook.payload.event);
  expect(header('user-agent')).toBe('Throw-Webhooks/1');
  expect(header('content-type')).toBe('application/json');
}
