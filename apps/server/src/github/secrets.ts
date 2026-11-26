import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { GITHUB_WEBHOOK_SECRET_PREFIX } from '@throw/shared';
import { secretKey } from '../webhooks/signing';

/** The secret a person pastes into the GitHub webhook's Secret field. */
export function newGithubWebhookSecret() {
  return `${GITHUB_WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** The inbound URL's last segment: 24 random bytes, so URLs cannot be guessed or listed. */
export function newWebhookToken() {
  return randomBytes(24).toString('base64url');
}

export const WEBHOOK_TOKEN = /^[A-Za-z0-9_-]{32}$/;

/**
 * The key for a connection's webhook secret and access token, apart from outbound webhooks'
 * (ADR 0015), so neither key opens the other's values.
 */
export const githubSecretKey = (serverSecret: string) =>
  secretKey(serverSecret, { salt: 'throw-github', info: 'github connection secret v1' });

/**
 * Whether `X-Hub-Signature-256` is `sha256=` and the hex HMAC-SHA256 of the exact body bytes,
 * keyed by the secret. The digests are compared in constant time.
 */
export function verifyGithubSignature(
  secret: string,
  body: Uint8Array,
  header: string | null | undefined,
) {
  const hex = /^sha256=([0-9a-f]{64})$/i.exec(header?.trim() ?? '')?.[1];
  if (!hex) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(hex, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
