import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Context, MiddlewareHandler } from 'hono';
import { env } from '../env';
import { verifyMcpToken } from '../lib/mcpTokens';
import { throwMcpServer } from './server';

const publicUrl = new URL(env.BETTER_AUTH_URL);
const allowed = new Map([[publicUrl.host, publicUrl.origin]]);
if (env.NODE_ENV === 'development') {
  // dev.sh advertises both its public hostname and localhost on the mapped port.
  const local = new URL(publicUrl);
  local.hostname = 'localhost';
  allowed.set(local.host, local.origin);
}

const WINDOW_MS = 60_000;

/** Bounds the counter memory and gives every key the same expiry. */
function requestLimiter(maxRequests: number, maxKeys: number) {
  let window = -1;
  const counts = new Map<string, number>();
  return (key: string, now = Date.now()) => {
    const current = Math.floor(now / WINDOW_MS);
    if (current !== window) {
      window = current;
      counts.clear();
    }
    const count = counts.get(key);
    if ((count ?? 0) >= maxRequests || (count === undefined && counts.size >= maxKeys)) {
      return Math.ceil(((window + 1) * WINDOW_MS - now) / 1000);
    }
    counts.set(key, (count ?? 0) + 1);
    return null;
  };
}

export function mcpEndpoint(
  clientAddress: (context: Context) => string | null,
  limitBody: MiddlewareHandler,
) {
  const limitIp = requestLimiter(240, 10_000);
  const limitToken = requestLimiter(120, 10_000);

  return async (c: Context) => {
    c.header('Cache-Control', 'no-store');
    const host = allowed.get(c.req.header('host')?.toLowerCase() ?? '');
    const origin = c.req.header('origin');
    if (!host || (origin !== undefined && origin !== host)) {
      return c.json({ error: 'Invalid Host or Origin.' }, 403);
    }

    function limited(seconds: number) {
      c.header('Retry-After', String(seconds));
      return c.json({ error: 'Too many MCP requests.' }, 429);
    }
    const ipWait = limitIp(clientAddress(c) ?? 'unknown');
    if (ipWait !== null) return limited(ipWait);

    let actor: Awaited<ReturnType<typeof verifyMcpToken>>;
    try {
      actor = await verifyMcpToken(c.req.header('authorization'));
    } catch {
      console.error('Throw MCP credential lookup failed.');
      return c.json({ error: 'Throw could not verify the credential.' }, 500);
    }
    if (!actor) {
      c.header('WWW-Authenticate', 'Bearer realm="Throw MCP"');
      return c.json({ error: 'A valid Throw MCP token is required.' }, 401);
    }
    const tokenWait = limitToken(actor.tokenId);
    if (tokenWait !== null) return limited(tokenWait);

    if (c.req.method !== 'POST') {
      c.header('Allow', 'POST');
      return c.json({ error: 'Send MCP messages with POST.' }, 405);
    }

    const response = await limitBody(c, async () => {
      let message: unknown;
      try {
        message = await c.req.json();
      } catch {
        c.res = c.json(
          { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON.' } },
          400,
        );
        return;
      }
      if (Array.isArray(message)) {
        c.res = c.json(
          {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32600, message: 'Send one MCP message at a time.' },
          },
          400,
        );
        return;
      }

      const server = throwMcpServer(actor);
      const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
      try {
        await server.connect(transport);
        c.res = await transport.handleRequest(c.req.raw, { parsedBody: message });
      } finally {
        await server.close();
      }
    });
    return response ?? c.res;
  };
}
