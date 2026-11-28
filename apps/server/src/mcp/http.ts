import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Context, MiddlewareHandler } from 'hono';
import { verifyMcpToken } from '../lib/mcpTokens';
import { allowed, publicUrl, requestLimiter } from './boundary';
import { throwMcpServer } from './server';

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
      c.header(
        'WWW-Authenticate',
        `Bearer resource_metadata="${publicUrl.origin}/.well-known/oauth-protected-resource/api/mcp"`,
      );
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
