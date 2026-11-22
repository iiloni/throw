import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  newWebhookSecret,
  secretKey,
  signWebhookBody,
} from './signing';

describe('webhook secrets', () => {
  it('have the Throw prefix and 32 random bytes', () => {
    const secret = newWebhookSecret();
    expect(secret).toMatch(/^throw_whsec_[A-Za-z0-9_-]{43}$/);
    expect(newWebhookSecret()).not.toBe(secret);
  });

  it('round-trip through encryption and fail closed under another server secret', () => {
    const key = secretKey('server-secret-server-secret-server-secret');
    const secret = newWebhookSecret();
    const stored = encryptSecret(secret, key);
    expect(stored).toMatch(/^v1\./);
    expect(stored).not.toContain(secret);
    expect(encryptSecret(secret, key)).not.toBe(stored);
    expect(decryptSecret(stored, key)).toBe(secret);
    expect(decryptSecret(stored, secretKey('another-server-secret-another-secret'))).toBeNull();
    expect(decryptSecret(`${stored.slice(0, -2)}AA`, key)).toBeNull();
    expect(decryptSecret('plain', key)).toBeNull();
  });
});

describe('signWebhookBody', () => {
  it('is the lowercase hex HMAC-SHA256 of the exact bytes', () => {
    const body = '{"event":"webhook.test","note":"ünïcode"}';
    const signature = signWebhookBody('throw_whsec_key', body);
    expect(signature).toBe(
      `sha256=${createHmac('sha256', 'throw_whsec_key').update(Buffer.from(body, 'utf8')).digest('hex')}`,
    );
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signWebhookBody('throw_whsec_key', `${body} `)).not.toBe(signature);
  });
});
