import { Hono } from 'hono';
import { afterEach, expect, test, vi } from 'vitest';
import { verifyMcpToken } from '../lib/mcpTokens';
import { mcpEndpoint } from './http';

vi.mock('../env', () => ({ env: { BETTER_AUTH_URL: 'https://throw.example', NODE_ENV: 'test' } }));
vi.mock('../lib/mcpTokens', () => ({ verifyMcpToken: vi.fn() }));
vi.mock('./server', () => ({ throwMcpServer: vi.fn() }));

const verify = vi.mocked(verifyMcpToken);

function testClient() {
  const app = new Hono().get(
    '/api/mcp',
    mcpEndpoint(
      (c) => c.req.header('test-ip') ?? null,
      async (_c, next) => await next(),
    ),
  );
  return (address: string, token?: string) =>
    app.request('/api/mcp', {
      headers: {
        Host: 'throw.example',
        'test-ip': address,
        ...(token ? { Authorization: token } : {}),
      },
    });
}

afterEach(() => {
  vi.restoreAllMocks();
  verify.mockReset();
});

test('limits one IP before looking up credentials and expires its request count', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(30_000);
  verify.mockResolvedValue(null);
  const request = testClient();
  for (let count = 0; count < 240; count++) expect((await request('192.0.2.1')).status).toBe(401);
  const limited = await request('192.0.2.1');
  expect(limited.status).toBe(429);
  expect(limited.headers.get('Retry-After')).toBe('30');
  expect(verify).toHaveBeenCalledTimes(240);
  expect((await request('192.0.2.2')).status).toBe(401);
  clock.mockReturnValue(60_000);
  expect((await request('192.0.2.1')).status).toBe(401);
});

test('limits a token across IPs without limiting other tokens on the same IP', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(0);
  verify.mockImplementation(async (token) => ({
    tokenId: token!,
    userId: 'user',
    workspaceId: 'workspace',
    viaTokenName: 'Agent',
  }));
  const request = testClient();
  for (let count = 0; count < 120; count++)
    expect((await request('192.0.2.1', 'first')).status).toBe(405);
  expect((await request('192.0.2.2', 'first')).status).toBe(429);
  expect((await request('192.0.2.2', 'second')).status).toBe(405);
});
