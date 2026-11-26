import { API_PROTOCOL_HEADER, API_PROTOCOL_VERSION, githubConnectionSchema } from '@throw/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import type { githubConnections } from '../db/schema';
import { connectionMetadata } from './github';

const app = createApp();
const projectId = '019a0000-0000-7000-8000-000000000003';
const withProtocol = { [API_PROTOCOL_HEADER]: String(API_PROTOCOL_VERSION) };

describe('GitHub connection routes', () => {
  it('need a session for every management route', async () => {
    const base = `/api/integrations/github/projects/${projectId}`;
    for (const [method, path] of [
      ['GET', base],
      ['POST', base],
      ['PATCH', base],
      ['DELETE', base],
      ['POST', `${base}/secret`],
      ['POST', `${base}/url`],
    ] as const) {
      const response = await app.request(path, {
        method,
        headers: { ...withProtocol, 'Content-Type': 'application/json' },
        body: method === 'GET' || method === 'DELETE' ? undefined : '{"enabled":true}',
      });
      expect(response.status, `${method} ${path}`).toBe(401);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('are behind the protocol gate, while GitHub’s receiver is not', async () => {
    const managed = await app.request(`/api/integrations/github/projects/${projectId}`);
    expect(managed.status).toBe(426);
    // GitHub sends no protocol header. A malformed token is refused before the database.
    const inbound = await app.request('/api/integrations/github/webhooks/not-a-token', {
      method: 'POST',
      body: '{}',
    });
    expect(inbound.status).toBe(404);
  });
});

describe('connectionMetadata', () => {
  it('says whether a token is stored without returning it or the webhook secret', () => {
    const row: typeof githubConnections.$inferSelect = {
      id: '019a0000-0000-7000-8000-000000000001',
      workspaceId: '019a0000-0000-7000-8000-000000000002',
      projectId,
      repository: 'iiloni/throw',
      authMode: 'token',
      enabled: true,
      webhookToken: 'abcdefghijklmnopqrstuvwxyz012345',
      encryptedWebhookSecret: 'v1.secret-ciphertext',
      encryptedToken: 'v1.token-ciphertext',
      createdBy: 'user-1',
      lastDeliveryAt: new Date('2026-11-26T10:00:00.000Z'),
      lastDeliveryId: 'd-1',
      lastDeliveryEvent: 'ping',
      lastDeliveryStatus: 'ok',
      lastDeliveryDetail: null,
      createdAt: new Date('2026-11-25T10:00:00.000Z'),
      updatedAt: new Date('2026-11-26T10:00:00.000Z'),
    };
    const metadata = connectionMetadata(row);
    expect(githubConnectionSchema.parse(metadata)).toEqual(metadata);
    expect(metadata).toMatchObject({
      hasToken: true,
      webhookUrl:
        'http://localhost:3000/api/integrations/github/webhooks/abcdefghijklmnopqrstuvwxyz012345',
      lastDelivery: { id: 'd-1', event: 'ping', status: 'ok', detail: null },
    });
    const text = JSON.stringify(metadata);
    expect(text).not.toContain('ciphertext');
    expect(text).not.toContain('createdBy');
    expect(connectionMetadata({ ...row, authMode: 'webhook', encryptedToken: null }).hasToken).toBe(
      false,
    );
  });
});
