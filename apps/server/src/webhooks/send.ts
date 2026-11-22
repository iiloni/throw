import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { WEBHOOK_HEADERS, WEBHOOK_USER_AGENT, type WebhookEvent } from '@throw/shared';
import { checkWebhookUrl, resolveAllowed, type WebhookPolicy } from './policy';
import { signWebhookBody } from './signing';

/** Attempts before a delivery is given up. A receiver catches up through `list_changes`. */
export const MAX_DELIVERY_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [10_000, 30_000, 120_000, 300_000];

/** The wait after failed attempt number `attempts`, or null when that was the last. */
export function retryDelayMs(attempts: number) {
  if (attempts >= MAX_DELIVERY_ATTEMPTS) return null;
  return RETRY_DELAYS_MS[Math.max(0, attempts - 1)] ?? RETRY_DELAYS_MS.at(-1)!;
}

export const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_ERROR_LENGTH = 200;
const MAX_RESPONSE_BYTES = 64 * 1024;

export type SendResult = { ok: boolean; responseStatus: number | null; error: string | null };

type Resolve = (hostname: string) => Promise<LookupAddress[]>;

const systemResolve: Resolve = (hostname) =>
  new Promise((resolve, reject) =>
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) =>
      error ? reject(error) : resolve(addresses),
    ),
  );

export const boundedError = (message: string) =>
  message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH - 1)}…` : message;

/**
 * Hands the connection only addresses that passed the policy, so the address checked is
 * the address connected to.
 */
function pinnedLookup(addresses: LookupAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    const wanted = options.family === 4 || options.family === 6 ? options.family : 0;
    const usable = addresses.filter((entry) => !wanted || entry.family === wanted);
    if (usable.length === 0) {
      const error = Object.assign(new Error('No allowed address'), { code: 'ENOTFOUND' });
      callback(error, '', 4);
      return;
    }
    if (options.all) callback(null, usable);
    else callback(null, usable[0]!.address, usable[0]!.family);
  };
}

function describe(error: unknown) {
  if (!(error instanceof Error)) return 'The delivery failed';
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'EWEBHOOKADDRESS') return error.message;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'The receiver’s name did not resolve';
  if (code === 'ECONNREFUSED') return 'The receiver refused the connection';
  if (code === 'ETIMEDOUT' || error.name === 'TimeoutError')
    return 'The receiver did not answer in time';
  if (code?.startsWith('ERR_TLS') || code?.includes('CERT')) return `TLS failed: ${code}`;
  return boundedError(error.message || 'The delivery failed');
}

/**
 * POSTs one signed delivery. Redirects are not followed: a receiver that answers 3xx fails,
 * since following it would reach an address the policy never checked.
 */
export async function sendWebhook(
  {
    url,
    secret,
    event,
    deliveryId,
    body,
  }: { url: string; secret: string; event: WebhookEvent; deliveryId: string; body: string },
  policy: WebhookPolicy,
  { resolve = systemResolve, timeoutMs = DELIVERY_TIMEOUT_MS } = {},
): Promise<SendResult> {
  const checked = checkWebhookUrl(url, policy);
  if (!checked.ok) return { ok: false, responseStatus: null, error: checked.reason };
  const { url: target, hostname, hostTrusted } = checked.checked;
  try {
    const addresses = await resolveAllowed(hostname, hostTrusted, policy, resolve);
    const status = await new Promise<number>((resolve, reject) => {
      const request = (target.protocol === 'https:' ? httpsRequest : httpRequest)(
        target,
        {
          method: 'POST',
          lookup: pinnedLookup(addresses),
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'User-Agent': WEBHOOK_USER_AGENT,
            [WEBHOOK_HEADERS.event]: event,
            [WEBHOOK_HEADERS.delivery]: deliveryId,
            [WEBHOOK_HEADERS.signature]: signWebhookBody(secret, body),
          },
          // No pooled sockets: each delivery resolves and checks its own address.
          agent: false,
          timeout: timeoutMs,
        },
        (response) => {
          let received = 0;
          response.on('data', (chunk: Buffer) => {
            received += chunk.length;
            if (received > MAX_RESPONSE_BYTES) response.destroy();
          });
          response.on('end', () => resolve(response.statusCode ?? 0));
          response.on('close', () => resolve(response.statusCode ?? 0));
          response.on('error', () => resolve(response.statusCode ?? 0));
        },
      );
      const timer = setTimeout(
        () => request.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })),
        timeoutMs,
      );
      request.on('timeout', () =>
        request.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })),
      );
      request.on('error', reject);
      request.on('close', () => clearTimeout(timer));
      request.end(body);
    });
    if (status >= 200 && status < 300) return { ok: true, responseStatus: status, error: null };
    if (status >= 300 && status < 400)
      return {
        ok: false,
        responseStatus: status,
        error: `The receiver redirected (HTTP ${status}); redirects are not followed`,
      };
    return { ok: false, responseStatus: status, error: `The receiver answered HTTP ${status}` };
  } catch (error) {
    return { ok: false, responseStatus: null, error: describe(error) };
  }
}
