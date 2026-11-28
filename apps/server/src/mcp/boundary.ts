import { env } from '../env';
export const publicUrl = new URL(env.BETTER_AUTH_URL);
export const allowed = new Map([[publicUrl.host, publicUrl.origin]]);
if (env.NODE_ENV === 'development') {
  // dev.sh advertises both its public hostname and localhost on the mapped port.
  const local = new URL(publicUrl);
  local.hostname = 'localhost';
  allowed.set(local.host, local.origin);
}

const WINDOW_MS = 60_000;

/** Bounds the counter memory and gives every key the same expiry. */
export function requestLimiter(maxRequests: number, maxKeys: number) {
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
