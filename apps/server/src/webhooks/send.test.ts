import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { policyFrom } from './policy';
import { MAX_DELIVERY_ATTEMPTS, retryDelayMs, sendWebhook } from './send';

const testing = policyFrom({
  WEBHOOK_ALLOWED_HOSTS: [],
  WEBHOOK_ALLOWED_CIDRS: [],
  WEBHOOK_ALLOW_LOOPBACK_HTTP: true,
});
const strict = policyFrom({
  WEBHOOK_ALLOWED_HOSTS: [],
  WEBHOOK_ALLOWED_CIDRS: [],
  WEBHOOK_ALLOW_LOOPBACK_HTTP: false,
});

type Received = { headers: IncomingMessage['headers']; body: string; url: string };

const servers: Server[] = [];

async function receiver(answer: (request: IncomingMessage, response: ServerResponse) => void) {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        url: request.url ?? '',
      });
      answer(request, response);
    });
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return { received, port };
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

const delivery = (url: string) => ({
  url,
  secret: 'throw_whsec_test-secret',
  event: 'task.updated' as const,
  deliveryId: '019a0000-0000-7000-8000-000000000001',
  body: JSON.stringify({ event: 'task.updated', note: 'ünïcode' }),
});

describe('sendWebhook', () => {
  it('posts a signed body with Throw’s headers', async () => {
    const { received, port } = await receiver((_, response) => response.writeHead(204).end());
    const sent = delivery(`http://127.0.0.1:${port}/hook`);
    const result = await sendWebhook(sent, testing);

    expect(result).toEqual({ ok: true, responseStatus: 204, error: null });
    const [request] = received;
    expect(request?.body).toBe(sent.body);
    expect(request?.headers['content-type']).toBe('application/json');
    expect(request?.headers['user-agent']).toBe('Throw-Webhooks/1');
    expect(request?.headers['x-throw-event']).toBe('task.updated');
    expect(request?.headers['x-throw-delivery']).toBe(sent.deliveryId);
    const expected = createHmac('sha256', sent.secret).update(Buffer.from(sent.body)).digest('hex');
    expect(request?.headers['x-throw-signature']).toBe(`sha256=${expected}`);
  });

  it('does not follow redirects', async () => {
    const target = await receiver((_, response) => response.writeHead(204).end());
    const { port } = await receiver((_, response) =>
      response.writeHead(302, { Location: `http://127.0.0.1:${target.port}/elsewhere` }).end(),
    );
    const result = await sendWebhook(delivery(`http://127.0.0.1:${port}/hook`), testing);
    expect(result.ok).toBe(false);
    expect(result.responseStatus).toBe(302);
    expect(result.error).toMatch(/redirect/);
    expect(target.received).toHaveLength(0);
  });

  it('reports an error status', async () => {
    const { port } = await receiver((_, response) => response.writeHead(500).end('nope'));
    expect(await sendWebhook(delivery(`http://127.0.0.1:${port}/`), testing)).toEqual({
      ok: false,
      responseStatus: 500,
      error: 'The receiver answered HTTP 500',
    });
  });

  it('gives up on a receiver that does not answer in time', async () => {
    const { port } = await receiver(() => {});
    const result = await sendWebhook(delivery(`http://127.0.0.1:${port}/`), testing, {
      timeoutMs: 200,
    });
    expect(result).toMatchObject({ ok: false, responseStatus: null });
    expect(result.error).toMatch(/in time/);
  });

  it('connects to the address it checked, not a second lookup', async () => {
    const { received, port } = await receiver((_, response) => response.writeHead(200).end());
    const result = await sendWebhook(delivery(`http://localhost:${port}/pinned`), testing, {
      resolve: async () => [{ address: '127.0.0.1', family: 4 }],
    });
    expect(result.ok).toBe(true);
    expect(received[0]?.url).toBe('/pinned');
  });

  it('refuses a public-looking name that resolves to a private address', async () => {
    let resolved = 0;
    const result = await sendWebhook(delivery('https://rebind.example.com/hook'), strict, {
      resolve: async () => {
        resolved += 1;
        return [{ address: '10.0.0.7', family: 4 }];
      },
    });
    expect(resolved).toBe(1);
    expect(result).toEqual({
      ok: false,
      responseStatus: null,
      error: 'The receiver’s name resolves to a private address',
    });
  });

  it('refuses loopback and plain HTTP outside test mode without connecting', async () => {
    const { received, port } = await receiver((_, response) => response.writeHead(204).end());
    expect((await sendWebhook(delivery(`http://127.0.0.1:${port}/`), strict)).error).toMatch(
      /https/,
    );
    expect((await sendWebhook(delivery(`https://127.0.0.1:${port}/`), strict)).error).toMatch(
      /private/,
    );
    expect(received).toHaveLength(0);
  });
});

describe('retryDelayMs', () => {
  it('backs off over a few minutes and then stops', () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([10_000, 30_000, 120_000, 300_000]);
    expect(retryDelayMs(MAX_DELIVERY_ATTEMPTS)).toBeNull();
    expect(retryDelayMs(MAX_DELIVERY_ATTEMPTS + 1)).toBeNull();
  });
});
