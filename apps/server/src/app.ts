import { getConnInfo } from '@hono/node-server/conninfo';
import { API_PROTOCOL_HEADER, SUPPORTED_API_PROTOCOLS } from '@throw/shared';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { auth } from './auth';
import { isRestoring } from './backups/service';
import type { AppEnv } from './context';
import { env, NATIVE_APP_ORIGINS } from './env';
import { CLIENT_IP_HEADER, clientIp, proxyList } from './lib/clientIp';
import { requireCompatibleProtocol } from './lib/protocol';
import { requestLogger } from './lib/requestLogger';
import { mcpEndpoint } from './mcp/http';
import { backupDownloadRoutes, backupRoutes } from './routes/backups';
import { commentRoutes } from './routes/comments';
import { mcpTokenRoutes } from './routes/mcpTokens';
import { projectRoutes } from './routes/projects';
import { shapeRoutes } from './routes/shapes';
import { statusRoutes } from './routes/statuses';
import { tagRoutes } from './routes/tags';
import { taskRoutes } from './routes/tasks';
import { updateRoutes } from './routes/updates';
import { webhookRoutes } from './routes/webhooks';
import { workspaceRoutes } from './routes/workspaces';

/** JSON bodies are read into memory whole. */
export const MAX_JSON_BODY_BYTES = 1024 * 1024;

const jsonBodyLimit = bodyLimit({
  maxSize: MAX_JSON_BODY_BYTES,
  onError: (c) => c.json({ error: 'The request is too large' }, 413),
});

const trustedProxies = proxyList(env.TRUSTED_PROXIES);

function clientAddress(c: Context) {
  let peer: string | undefined;
  try {
    peer = getConnInfo(c).remote.address;
  } catch {
    // No socket: a request made in a test.
  }
  return clientIp(peer, c.req.header('x-forwarded-for'), trustedProxies);
}

/** Better Auth trusts only the client address read from the connection and trusted proxies. */
function withClientIp(c: Context) {
  const headers = new Headers(c.req.raw.headers);
  const ip = clientAddress(c);
  headers.delete(CLIENT_IP_HEADER);
  if (ip) headers.set(CLIENT_IP_HEADER, ip);
  return new Request(c.req.raw, { headers });
}

export function createApp() {
  const app = new Hono<AppEnv>();

  if (env.NODE_ENV !== 'test') app.use(requestLogger);

  const appCors = cors({
    origin: [...NATIVE_APP_ORIGINS, ...env.TRUSTED_ORIGINS],
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization', API_PROTOCOL_HEADER],
    exposeHeaders: [
      'set-auth-token',
      'electric-offset',
      'electric-handle',
      'electric-schema',
      'electric-cursor',
      'electric-up-to-date',
    ],
  });
  app.use('/api/*', (c, next) => (c.req.path === '/api/mcp' ? next() : appCors(c, next)));

  app.use('/api/*', async (c, next) => {
    if (isRestoring() && c.req.path !== '/api/health') {
      c.header('Retry-After', '3');
      return c.json({ error: 'The server is restoring a backup.' }, 503);
    }
    await next();
  });
  app.all('/api/mcp', mcpEndpoint(clientAddress, jsonBodyLimit));
  app.route('/api/admin/backups', backupDownloadRoutes);
  app.use('/api/*', requireCompatibleProtocol);
  app.use('/api/*', (c, next) =>
    c.req.path === '/api/admin/backups/upload' ? next() : jsonBodyLimit(c, next),
  );

  app.get('/api/compatibility', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ ...SUPPORTED_API_PROTOCOLS, taskSize: true });
  });

  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(withClientIp(c)));

  app.use('/api/*', async (c, next) => {
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set('user', result?.user ?? null);
    c.set('session', result?.session ?? null);
    await next();
  });

  const api = app
    .basePath('/api')
    .get('/health', (c) => c.json({ ok: true }))
    .route('/updates', updateRoutes)
    .route('/admin/backups', backupRoutes)
    .route('/mcp-tokens', mcpTokenRoutes)
    .route('/webhooks', webhookRoutes)
    .route('/workspaces', workspaceRoutes)
    .route('/projects', projectRoutes)
    .route('/statuses', statusRoutes)
    .route('/tasks', taskRoutes)
    .route('/comments', commentRoutes)
    .route('/tags', tagRoutes)
    .route('/shapes', shapeRoutes);

  return api;
}

export type AppType = ReturnType<typeof createApp>;
