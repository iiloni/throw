import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { WEBHOOK_SECRET_PREFIX } from '@throw/shared';

export function newWebhookSecret() {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** `sha256=` and the lowercase hex HMAC-SHA256 of the exact body bytes, keyed by the whole secret. */
export function signWebhookBody(secret: string, body: string | Uint8Array) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

/** The secret's encryption key, derived from the server's auth secret. */
export function secretKey(serverSecret: string) {
  return Buffer.from(
    hkdfSync('sha256', serverSecret, 'throw-webhooks', 'webhook signing secret v1', 32),
  );
}

const VERSION = 'v1';

/** AES-256-GCM, stored as `v1.<iv>.<ciphertext and tag>` in base64url. */
export function encryptSecret(secret: string, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const sealed = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return `${VERSION}.${iv.toString('base64url')}.${sealed.toString('base64url')}`;
}

/** Null when the stored value cannot be read, such as after the server's secret changed. */
export function decryptSecret(stored: string, key: Buffer): string | null {
  const [version, iv, sealed] = stored.split('.');
  if (version !== VERSION || !iv || !sealed) return null;
  try {
    const bytes = Buffer.from(sealed, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    return null;
  }
}
