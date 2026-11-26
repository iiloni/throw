import * as crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { decryptSecret, encryptSecret, secretKey } from '../webhooks/signing';
import {
  githubSecretKey,
  newGithubWebhookSecret,
  newWebhookToken,
  verifyGithubSignature,
  WEBHOOK_TOKEN,
} from './secrets';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const bytes = (text: string) => new TextEncoder().encode(text);
const serverSecret = 'server-secret-server-secret-server-secret';

describe('GitHub connection secrets', () => {
  it('have a prefix and 32 random bytes, and URL tokens 24', () => {
    const secret = newGithubWebhookSecret();
    expect(secret).toMatch(/^throw_ghsec_[A-Za-z0-9_-]{43}$/);
    expect(newGithubWebhookSecret()).not.toBe(secret);
    const token = newWebhookToken();
    expect(token).toMatch(WEBHOOK_TOKEN);
    expect(newWebhookToken()).not.toBe(token);
  });

  it('round-trip under their own key, which neither opens webhooks’ nor is opened by it', () => {
    const key = githubSecretKey(serverSecret);
    const secret = newGithubWebhookSecret();
    const stored = encryptSecret(secret, key);
    expect(stored).not.toContain(secret);
    expect(decryptSecret(stored, key)).toBe(secret);
    expect(decryptSecret(stored, secretKey(serverSecret))).toBeNull();
    expect(decryptSecret(encryptSecret(secret, secretKey(serverSecret)), key)).toBeNull();
    expect(decryptSecret(stored, githubSecretKey('another-server-secret-another-one'))).toBeNull();
  });
});

describe('verifyGithubSignature', () => {
  // GitHub's documented example ("Validating webhook deliveries").
  const secret = "It's a Secret to Everybody";
  const body = bytes('Hello, World!');
  const signature = 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17';

  it('accepts GitHub’s example signature', () => {
    expect(verifyGithubSignature(secret, body, signature)).toBe(true);
    expect(
      verifyGithubSignature(secret, body, signature.toUpperCase().replace('SHA256', 'sha256')),
    ).toBe(true);
  });

  it('refuses another body, secret or signature, and malformed headers', () => {
    expect(verifyGithubSignature(secret, bytes('Hello, World! '), signature)).toBe(false);
    expect(verifyGithubSignature('another secret', body, signature)).toBe(false);
    expect(verifyGithubSignature(secret, body, `${signature.slice(0, -1)}0`)).toBe(false);
    for (const header of [
      undefined,
      null,
      '',
      signature.slice(7),
      `sha1=${signature.slice(7)}`,
      signature.slice(0, -2),
      `${signature}00`,
      'sha256=zz7107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17',
    ])
      expect(verifyGithubSignature(secret, body, header)).toBe(false);
  });

  it('signs the exact bytes, not a re-encoding', () => {
    const raw = bytes('{"a":"ünïcode",  "b":1}');
    const header = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
    expect(verifyGithubSignature(secret, raw, header)).toBe(true);
    expect(
      verifyGithubSignature(
        secret,
        bytes(JSON.stringify(JSON.parse('{"a":"ünïcode",  "b":1}'))),
        header,
      ),
    ).toBe(false);
  });

  it('compares digests in constant time', () => {
    const compare = vi.mocked(crypto.timingSafeEqual);
    compare.mockClear();
    expect(verifyGithubSignature(secret, body, `${signature.slice(0, -1)}0`)).toBe(false);
    expect(verifyGithubSignature(secret, body, signature)).toBe(true);
    expect(compare).toHaveBeenCalledTimes(2);
    for (const [given, expected] of compare.mock.calls) {
      expect(Buffer.from(given as Uint8Array)).toHaveLength(32);
      expect(Buffer.from(expected as Uint8Array)).toHaveLength(32);
    }
  });
});
