import {
  API_PROTOCOL_HEADER,
  type ProtocolError,
  protocolCompatibility,
  SUPPORTED_API_PROTOCOLS,
} from '@throw/shared';
import { createMiddleware } from 'hono/factory';

/** Bootstrap and auth requests must work before a client knows the server's protocol. */
function isExempt(method: string, path: string) {
  if (path.startsWith('/api/auth/')) return true;
  if (method !== 'GET' && method !== 'HEAD') return false;
  return ['/api/health', '/api/compatibility'].includes(path);
}

export const requireCompatibleProtocol = createMiddleware(async (c, next) => {
  if (isExempt(c.req.method, c.req.path)) return next();
  const header = c.req.header(API_PROTOCOL_HEADER) ?? '';
  const version = /^[1-9]\d*$/.test(header) ? Number(header) : NaN;
  if (
    !Number.isSafeInteger(version) ||
    protocolCompatibility(version, SUPPORTED_API_PROTOCOLS) !== null
  ) {
    c.header('Cache-Control', 'no-store');
    return c.json(
      {
        code: 'INCOMPATIBLE_PROTOCOL',
        error: 'This app and server use incompatible API protocols. Update the app or server.',
        protocol: SUPPORTED_API_PROTOCOLS,
      } satisfies ProtocolError,
      426,
    );
  }
  await next();
});
