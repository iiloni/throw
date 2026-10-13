import { API_PROTOCOL_HEADER, API_PROTOCOL_VERSION, SUPPORTED_API_PROTOCOLS } from '@throw/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';

const app = createApp();
const request = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set(API_PROTOCOL_HEADER, String(API_PROTOCOL_VERSION));
  return app.request(path, { ...init, headers });
};
const json = { 'Content-Type': 'application/json' };
const id = '0199a0a0-0000-7000-8000-000000000000';

describe('api', () => {
  it('reports health', async () => {
    const res = await request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rejects unauthenticated workspace and project writes', async () => {
    const workspace = { id, name: 'Work', position: 'a0' };
    const project = {
      id,
      workspaceId: id,
      name: 'Site',
      color: 'amber',
      icon: null,
      position: 'a0',
    };
    for (const [path, body] of [
      ['/api/workspaces', workspace],
      ['/api/projects', project],
    ] as const) {
      const create = await request(path, {
        method: 'POST',
        headers: json,
        body: JSON.stringify(body),
      });
      expect(create.status).toBe(401);
      const update = await request(`${path}/${id}`, {
        method: 'PATCH',
        headers: json,
        body: JSON.stringify({ name: 'Renamed' }),
      });
      expect(update.status).toBe(401);
      expect((await request(`${path}/${id}`, { method: 'DELETE' })).status).toBe(401);
    }
  });

  it('rejects unauthenticated shape requests', async () => {
    expect((await request('/api/shapes/workspaces?offset=-1')).status).toBe(401);
    expect((await request('/api/shapes/projects?offset=-1')).status).toBe(401);
  });
});

describe('protocol gate', () => {
  it('advertises the supported range without a protocol header', async () => {
    const res = await app.request('/api/compatibility');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SUPPORTED_API_PROTOCOLS);
  });

  it('answers health checks without a protocol header', async () => {
    expect((await app.request('/api/health')).status).toBe(200);
  });

  it.each([
    ['a missing header', undefined],
    ['a newer client', String(SUPPORTED_API_PROTOCOLS.max + 1)],
    ['a malformed header', '1.5'],
  ])('refuses data requests from %s', async (_name, header) => {
    const res = await app.request('/api/shapes/projects?offset=-1', {
      headers: header === undefined ? {} : { [API_PROTOCOL_HEADER]: header },
    });
    expect(res.status).toBe(426);
    expect(await res.json()).toMatchObject({
      code: 'INCOMPATIBLE_PROTOCOL',
      protocol: SUPPORTED_API_PROTOCOLS,
    });
  });
});
