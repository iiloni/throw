import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { fetchClient, registeredRedirect } from './clients';

const { dns, get } = vi.hoisted(() => ({ dns: vi.fn(), get: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: dns }));
vi.mock('node:https', () => ({ get }));
afterEach(() => {
  vi.resetAllMocks();
});

function serve(id: string, metadata: Record<string, unknown> = {}, statusCode = 200) {
  dns.mockResolvedValue([{ address: '1.1.1.1', family: 4 }]);
  get.mockImplementation((_url, options, reply) => {
    options.lookup('connector.example', { all: true }, (err: unknown, addresses: unknown) => {
      expect(err).toBeNull();
      expect(addresses).toEqual([{ address: '1.1.1.1', family: 4 }]);
    });
    const req = Object.assign(new EventEmitter(), {
      destroy: (error: Error) => req.emit('error', error),
    });
    const res = Object.assign(
      Readable.from([
        Buffer.from(
          JSON.stringify({
            client_id: id,
            client_name: 'My connector',
            redirect_uris: ['https://connector.example/callback'],
            ...metadata,
          }),
        ),
      ]),
      { statusCode, headers: { 'content-type': 'application/json' } },
    );
    queueMicrotask(() => reply(res));
    return req;
  });
}
it('uses pinned public addresses, validates the client and caches its document', async () => {
  const id = 'https://connector.example/metadata';
  serve(id, {
    token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
  });
  expect(await fetchClient(id)).toMatchObject({ client_id: id });
  await fetchClient(id);
  expect(get).toHaveBeenCalledTimes(1);
});
it('rejects private answers and mixed DNS records before connecting', async () => {
  dns.mockResolvedValue([
    { address: '1.1.1.1', family: 4 },
    { address: '10.0.0.1', family: 4 },
  ]);
  await expect(fetchClient('https://example.net/client')).rejects.toThrow();
  await expect(fetchClient('https://localhost/client')).rejects.toThrow();
  expect(get).not.toHaveBeenCalled();
});
it.each([
  [{ client_id: 'https://elsewhere.example/id' }, 200],
  [{ redirect_uris: ['javascript:alert(1)'] }, 200],
  [{ token_endpoint_auth_methods_supported: ['private_key_jwt'] }, 200],
  [{ token_endpoint_auth_method: 'private_key_jwt' }, 200],
  [{}, 302],
  [{ client_name: 'x'.repeat(40000) }, 200],
] as const)('refuses invalid CIMD or response', async (metadata, status) => {
  const id = 'https://connector.example/invalid';
  serve(id, metadata, status);
  await expect(fetchClient(id)).rejects.toThrow();
  expect(get).toHaveBeenCalledTimes(1);
});

it('allows native loopback ports while matching the callback host, path and query', () => {
  const registered = ['http://127.0.0.1:4000/cb', 'https://example.net/cb'];
  expect(registeredRedirect('http://127.0.0.1:51234/cb', registered)).toBe(true);
  expect(registeredRedirect('http://127.0.0.1:51234/other', registered)).toBe(false);
  expect(registeredRedirect('https://example.net:4000/cb', registered)).toBe(false);
});
