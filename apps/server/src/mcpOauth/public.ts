import { randomBytes, randomUUID } from 'node:crypto';
import { and, count, eq, gt, lt, sql } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { setCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { db } from '../db/client';
import { oauthClients, oauthRequests } from '../db/schema';
import { allowed, publicUrl, requestLimiter } from '../mcp/boundary';
import { clientMetadata, fetchClient, registeredRedirect } from './clients';
import { digest, exchange, future, resource } from './tokens';

const issuer = publicUrl.origin;
const endpoint = `${issuer}/api/oauth`;
const grants = ['authorization_code', 'refresh_token'];
const discovery = {
  issuer,
  authorization_endpoint: `${endpoint}/authorize`,
  token_endpoint: `${endpoint}/token`,
  registration_endpoint: `${endpoint}/register`,
  client_id_metadata_document_supported: true,
  token_endpoint_auth_methods_supported: ['none'],
  code_challenge_methods_supported: ['S256'],
  grant_types_supported: grants,
  response_types_supported: ['code'],
  scopes_supported: ['mcp'],
};

function hasRepeatedParameter(params: URLSearchParams) {
  const names = new Set<string>();
  for (const name of params.keys()) {
    if (names.has(name)) return true;
    names.add(name);
  }
  return false;
}

export function publicOauth(clientAddress: (c: Context) => string | null) {
  const routes = new Hono();
  const endpointLimit = requestLimiter(600, 1);
  const limit = requestLimiter(90, 4096);
  const registerLimit = requestLimiter(8, 1024);
  for (const path of [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/api/mcp',
    '/.well-known/oauth-authorization-server',
    '/api/oauth/*',
  ]) {
    routes.use(
      path,
      async (c, next) => {
        if (!allowed.has(c.req.header('host')?.toLowerCase() ?? ''))
          return c.json({ error: 'invalid_request' }, 403);
        c.header('Cache-Control', 'no-store');
        return next();
      },
      cors({
        origin: '*',
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['Content-Type'],
      }),
    );
  }
  const protectedResource = (c: Context) =>
    c.json({
      resource,
      authorization_servers: [issuer],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp'],
    });
  routes.get('/.well-known/oauth-protected-resource', protectedResource);
  routes.get('/.well-known/oauth-protected-resource/api/mcp', protectedResource);
  routes.get('/.well-known/oauth-authorization-server', (c) => c.json(discovery));
  routes.use('/api/oauth/*', bodyLimit({ maxSize: 32768 }), async (c, next) => {
    const key = clientAddress(c) ?? 'unknown';
    const wait =
      limit(key) ??
      endpointLimit('all') ??
      (c.req.path.endsWith('/register') ? registerLimit(key) : null);
    if (wait) {
      c.header('Retry-After', String(wait));
      return c.json({ error: 'temporarily_unavailable' }, 429);
    }
    return next();
  });
  routes.post('/api/oauth/register', async (c) => {
    const meta = clientMetadata.safeParse(await c.req.json().catch(() => null));
    if (!meta.success) return c.json({ error: 'invalid_client_metadata' }, 400);
    const { client_name, redirect_uris } = meta.data;
    const id = randomUUID();
    const saved = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(21734, 1)`);
      await tx.delete(oauthClients).where(lt(oauthClients.expiresAt, new Date()));
      const [total] = await tx.select({ n: count() }).from(oauthClients);
      if (total!.n >= 4096) return false;
      await tx.insert(oauthClients).values({
        id,
        name: client_name ?? new URL(redirect_uris[0]!).host,
        redirects: redirect_uris,
        expiresAt: future(90 * 86400),
      });
      return true;
    });
    return saved
      ? c.json(
          {
            ...meta.data,
            client_id: id,
            token_endpoint_auth_method: 'none',
            response_types: ['code'],
            grant_types: grants,
          },
          201,
        )
      : c.json({ error: 'temporarily_unavailable' }, 503);
  });
  routes.get('/api/oauth/authorize', async (c) => {
    const p = new URL(c.req.url).searchParams;
    const id = p.get('client_id') ?? '';
    const redirect = p.get('redirect_uri') ?? '';
    const challenge = p.get('code_challenge') ?? '';
    if (
      hasRepeatedParameter(p) ||
      p.toString().length > 8192 ||
      p.get('response_type') !== 'code' ||
      p.get('code_challenge_method') !== 'S256' ||
      !/^[\w-]{43}$/.test(challenge)
    )
      return c.json({ error: 'invalid_request' }, 400);
    if (p.get('resource') !== resource) return c.json({ error: 'invalid_target' }, 400);
    if (p.has('scope') && p.get('scope') !== 'mcp') return c.json({ error: 'invalid_scope' }, 400);
    let client: { name: string; redirects: string[] } | undefined;
    if (id.startsWith('https://')) {
      const doc = await fetchClient(id).catch(() => null);
      if (doc) client = { name: doc.client_name, redirects: doc.redirect_uris };
    } else {
      [client] = await db
        .select()
        .from(oauthClients)
        .where(and(eq(oauthClients.id, id), gt(oauthClients.expiresAt, new Date())));
    }
    if (!client || !registeredRedirect(redirect, client.redirects))
      return c.json({ error: 'invalid_request' }, 400);
    const requestId = randomUUID();
    const browserKey = randomBytes(32).toString('base64url');
    await db.delete(oauthRequests).where(lt(oauthRequests.expiresAt, new Date()));
    await db.insert(oauthRequests).values({
      id: requestId,
      clientId: id,
      clientName: client.name,
      redirect,
      challenge,
      resource,
      state: p.get('state'),
      browserDigest: digest(browserKey),
      expiresAt: future(600),
    });
    setCookie(c, 'throw_consent', browserKey, {
      path: `/api/mcp-oauth/requests/${requestId}`,
      maxAge: 600,
      httpOnly: true,
      sameSite: 'Lax',
      secure: publicUrl.protocol === 'https:',
    });
    return c.redirect(`${issuer}/oauth/consent?requestId=${requestId}`);
  });
  routes.post('/api/oauth/token', async (c) => {
    if (c.req.header('content-type')?.split(';')[0] !== 'application/x-www-form-urlencoded')
      return c.json({ error: 'invalid_request' }, 400);
    const p = new URLSearchParams(await c.req.text());
    if (c.req.header('authorization') || p.has('client_assertion') || p.has('client_secret'))
      return c.json({ error: 'invalid_client' }, 400);
    if (hasRepeatedParameter(p)) return c.json({ error: 'invalid_request' }, 400);
    if (!grants.includes(p.get('grant_type') ?? ''))
      return c.json({ error: 'unsupported_grant_type' }, 400);
    if (p.get('resource') !== resource) return c.json({ error: 'invalid_target' }, 400);
    if (p.has('scope') && p.get('scope') !== 'mcp') return c.json({ error: 'invalid_scope' }, 400);
    const result = await exchange(p);
    return result ? c.json(result) : c.json({ error: 'invalid_grant' }, 400);
  });
  return routes;
}
