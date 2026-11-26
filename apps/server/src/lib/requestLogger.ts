import { GITHUB_WEBHOOK_PATH } from '@throw/shared';
import type { MiddlewareHandler } from 'hono';

/** Query parameters that carry a credential, such as a backup download ticket. */
const SECRET_PARAMS = ['access'];

/** The request's path and query, with credentials replaced, so a log line never holds one. */
export function loggedPath(url: string) {
  const { pathname, searchParams } = new URL(url);
  // MCP has no query parameters. A misplaced bearer credential must stay out of logs.
  if (/^\/api\/mcp\/*$/.test(pathname)) return pathname;
  // A GitHub webhook's URL token finds its connection, so it is kept out of logs too.
  if (pathname.startsWith(`${GITHUB_WEBHOOK_PATH}/`)) return `${GITHUB_WEBHOOK_PATH}/redacted`;
  for (const name of SECRET_PARAMS) if (searchParams.has(name)) searchParams.set(name, 'redacted');
  const query = searchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * Logs each request and its response, as Hono's logger does, built from the request rather
 * than from that logger's text, so a credential in the query never reaches the log. Shape
 * parameters such as `offset` and `handle` are kept for debugging sync.
 */
export const requestLogger: MiddlewareHandler = async (c, next) => {
  const path = loggedPath(c.req.url);
  const start = performance.now();
  console.log(`<-- ${c.req.method} ${path}`);
  await next();
  const elapsed = Math.round(performance.now() - start);
  console.log(`--> ${c.req.method} ${path} ${c.res.status} ${elapsed}ms`);
};
