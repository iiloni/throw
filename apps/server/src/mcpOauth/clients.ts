import { lookup } from 'node:dns/promises';
import { get } from 'node:https';
import { z } from 'zod';
import { checkWebhookUrl, policyFrom, resolveAllowed } from '../webhooks/policy';
import { pinnedLookup } from '../webhooks/send';

const policy = policyFrom({
  WEBHOOK_ALLOWED_HOSTS: [],
  WEBHOOK_ALLOWED_CIDRS: [],
  WEBHOOK_ALLOW_LOOPBACK_HTTP: false,
});

const redirect = z
  .url()
  .max(2048)
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !value.includes('#') &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    );
  });
/** Native clients may select a free port on an IP-literal loopback callback (RFC 8252). */
export function registeredRedirect(value: string, registered: string[]) {
  if (registered.includes(value)) return true;
  const loopback = /^(http:\/\/(?:127\.0\.0\.1|\[::1\]))(?::[0-9]+)?(?=\/|$)/;
  if (!loopback.test(value) || !redirect.safeParse(value).success) return false;
  return registered.some(
    (uri) => loopback.test(uri) && uri.replace(loopback, '$1') === value.replace(loopback, '$1'),
  );
}

export const clientMetadata = z.object({
  client_name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[^\p{Cc}\p{Cf}]+$/u)
    .optional(),
  redirect_uris: z.array(redirect).min(1).max(16),
  token_endpoint_auth_method: z.literal('none').optional(),
});
const document = clientMetadata
  .extend({
    client_id: z.string(),
    token_endpoint_auth_method: z.string().optional(),
    token_endpoint_auth_methods_supported: z.array(z.string()).min(1).optional(),
    client_name: clientMetadata.shape.client_name.unwrap(),
  })
  .refine((meta) =>
    meta.token_endpoint_auth_methods_supported
      ? meta.token_endpoint_auth_methods_supported.includes('none')
      : (meta.token_endpoint_auth_method ?? 'none') === 'none',
  );
const cache = new Map<string, { expires: number; data: z.infer<typeof document> }>();
let active = 0;

export async function fetchClient(id: string) {
  const checked = checkWebhookUrl(id, policy);
  if (!checked.ok || checked.checked.url.pathname === '/' || id.includes('#') || id.includes('?'))
    throw Error('Invalid metadata URL');
  const cached = cache.get(id);
  if (cached && cached.expires > Date.now()) return cached.data;
  if (active >= 12) throw Error('Too many metadata lookups');
  active++;
  try {
    const { hostname, url } = checked.checked;
    const addresses = await resolveAllowed(hostname, false, policy, (host) =>
      lookup(host, { all: true }),
    );
    let cacheSeconds = 60;
    const body = await new Promise<string>((resolve, reject) => {
      const req = get(
        url,
        {
          lookup: pinnedLookup(addresses),
          agent: false,
          signal: AbortSignal.timeout(5000),
          headers: { Accept: 'application/json' },
        },
        (res) => {
          res.on('error', reject);
          if (
            res.statusCode !== 200 ||
            !/^application\/json(?:;|$)/i.test(res.headers['content-type'] ?? '')
          ) {
            req.destroy(Error('Invalid metadata response'));
            return;
          }
          const directives = (res.headers['cache-control'] ?? '')
            .toLowerCase()
            .split(',')
            .map((s) => s.trim());
          for (const directive of directives) {
            if (['no-store', 'no-cache', 'private'].includes(directive)) cacheSeconds = 0;
            const match = /^max-age=(\d+)$/.exec(directive);
            if (match) cacheSeconds = Math.min(cacheSeconds, Number(match[1]));
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          res.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 32768) req.destroy(Error('Metadata too large'));
            else chunks.push(chunk);
          });
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        },
      );
      req.on('error', reject);
    });
    const data = document.parse(JSON.parse(body));
    if (data.client_id !== id) throw Error('Metadata identifier mismatch');
    if (cacheSeconds > 0) {
      if (cache.size >= 256) cache.delete(cache.keys().next().value!);
      cache.set(id, { data, expires: Date.now() + cacheSeconds * 1000 });
    }
    return data;
  } finally {
    active--;
  }
}
