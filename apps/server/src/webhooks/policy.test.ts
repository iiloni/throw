import { describe, expect, it } from 'vitest';
import {
  addressAllowed,
  checkWebhookUrl,
  classifyAddress,
  isAllowedHostPattern,
  matchesAllowedHost,
  policyFrom,
  resolveAllowed,
} from './policy';

const strict = policyFrom({
  WEBHOOK_ALLOWED_HOSTS: [],
  WEBHOOK_ALLOWED_CIDRS: [],
  WEBHOOK_ALLOW_LOOPBACK_HTTP: false,
});
const tailnet = policyFrom({
  WEBHOOK_ALLOWED_HOSTS: ['*.example-tailnet.ts.net', 'hooks.lan'],
  WEBHOOK_ALLOWED_CIDRS: ['100.64.0.0/10', 'fd7a:115c:a1e0::/48'],
  WEBHOOK_ALLOW_LOOPBACK_HTTP: false,
});
const testing = policyFrom({
  WEBHOOK_ALLOWED_HOSTS: [],
  WEBHOOK_ALLOWED_CIDRS: [],
  WEBHOOK_ALLOW_LOOPBACK_HTTP: true,
});

const answers =
  (...addresses: string[]) =>
  async () =>
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

describe('classifyAddress', () => {
  it('blocks this machine, link-local, metadata and multicast', () => {
    for (const address of [
      '127.0.0.1',
      '127.8.9.10',
      '0.0.0.0',
      '169.254.169.254',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      '::',
      'fe80::1',
      'ff02::1',
      // IPv4-mapped and NAT64 forms reach the same IPv4 hosts.
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:169.254.169.254',
      '64:ff9b::a9fe:a9fe',
    ])
      expect(classifyAddress(address), address).toBe('blocked');
  });

  it('marks private, CGNAT, ULA and documentation ranges as private', () => {
    for (const address of [
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '100.64.0.1',
      '100.101.102.103',
      '198.18.0.1',
      'fc00::1',
      'fd7a:115c:a1e0::1',
      '::ffff:10.0.0.1',
      '64:ff9b::a00:1',
    ])
      expect(classifyAddress(address), address).toBe('private');
  });

  it('allows public addresses', () => {
    for (const address of ['1.1.1.1', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700::1111'])
      expect(classifyAddress(address), address).toBe('public');
  });

  it('refuses something that is not an address', () => {
    expect(classifyAddress('example.com')).toBe('blocked');
  });
});

describe('addressAllowed', () => {
  it('reaches private addresses only for trusted hosts or ranges', () => {
    expect(addressAllowed('100.100.1.2', false, strict)).toBe(false);
    expect(addressAllowed('100.100.1.2', false, tailnet)).toBe(true);
    expect(addressAllowed('fd7a:115c:a1e0:ab12::1', false, tailnet)).toBe(true);
    expect(addressAllowed('192.168.1.5', false, tailnet)).toBe(false);
    expect(addressAllowed('192.168.1.5', true, tailnet)).toBe(true);
  });

  it('never lets a trusted host reach loopback or metadata', () => {
    expect(addressAllowed('127.0.0.1', true, tailnet)).toBe(false);
    expect(addressAllowed('169.254.169.254', true, tailnet)).toBe(false);
    expect(addressAllowed('::1', true, tailnet)).toBe(false);
  });

  it('allows loopback only in test mode', () => {
    expect(addressAllowed('127.0.0.1', false, strict)).toBe(false);
    expect(addressAllowed('127.0.0.1', false, testing)).toBe(true);
    expect(addressAllowed('::1', false, testing)).toBe(true);
    expect(addressAllowed('10.0.0.1', false, testing)).toBe(false);
  });

  it('lets an explicitly allowed range include anything', () => {
    const loopbackRange = policyFrom({
      WEBHOOK_ALLOWED_HOSTS: [],
      WEBHOOK_ALLOWED_CIDRS: ['127.0.0.1'],
      WEBHOOK_ALLOW_LOOPBACK_HTTP: false,
    });
    expect(addressAllowed('127.0.0.1', false, loopbackRange)).toBe(true);
    expect(addressAllowed('127.0.0.2', false, loopbackRange)).toBe(false);
  });
});

describe('allowed host patterns', () => {
  it('accepts names and wildcard suffixes', () => {
    expect(isAllowedHostPattern('*.example-tailnet.ts.net')).toBe(true);
    expect(isAllowedHostPattern('hooks.lan')).toBe(true);
    expect(isAllowedHostPattern('*')).toBe(false);
    expect(isAllowedHostPattern('*.')).toBe(false);
    expect(isAllowedHostPattern('a.*.net')).toBe(false);
    expect(isAllowedHostPattern('http://x')).toBe(false);
  });

  it('matches subdomains of a wildcard, not the suffix itself or lookalikes', () => {
    expect(matchesAllowedHost('agent.example-tailnet.ts.net', tailnet)).toBe(true);
    expect(matchesAllowedHost('AGENT.Example-Tailnet.ts.net.', tailnet)).toBe(true);
    expect(matchesAllowedHost('example-tailnet.ts.net', tailnet)).toBe(false);
    expect(matchesAllowedHost('agent.other.ts.net', tailnet)).toBe(false);
    expect(matchesAllowedHost('evilexample-tailnet.ts.net', tailnet)).toBe(false);
    expect(matchesAllowedHost('hooks.lan', tailnet)).toBe(true);
    expect(matchesAllowedHost('x.hooks.lan', tailnet)).toBe(false);
  });
});

describe('checkWebhookUrl', () => {
  const reason = (url: string, policy = strict) => {
    const result = checkWebhookUrl(url, policy);
    return result.ok ? null : result.reason;
  };

  it('requires HTTPS', () => {
    expect(reason('https://hooks.example.com/throw')).toBeNull();
    expect(reason('http://hooks.example.com/throw')).toMatch(/https/);
    expect(reason('ftp://hooks.example.com')).toMatch(/https/);
    expect(reason('not a url')).toMatch(/full URL/);
  });

  it('allows plain HTTP to loopback only in test mode', () => {
    expect(reason('http://127.0.0.1:4000/hook')).toMatch(/https/);
    expect(reason('http://127.0.0.1:4000/hook', testing)).toBeNull();
    expect(reason('http://localhost:4000/hook', testing)).toBeNull();
    expect(reason('http://[::1]:4000/hook', testing)).toBeNull();
    expect(reason('http://10.0.0.1/hook', testing)).toMatch(/https/);
  });

  it('refuses credentials in the URL', () => {
    expect(reason('https://user:pass@hooks.example.com/')).toMatch(/password/);
  });

  it('refuses private and local address literals unless trusted', () => {
    expect(reason('https://127.0.0.1/')).toMatch(/private/);
    expect(reason('https://[::ffff:127.0.0.1]/')).toMatch(/private/);
    expect(reason('https://169.254.169.254/latest/meta-data')).toMatch(/private/);
    expect(reason('https://10.0.0.1/')).toMatch(/private/);
    expect(reason('https://100.100.1.2/')).toMatch(/private/);
    expect(reason('https://100.100.1.2/', tailnet)).toBeNull();
    expect(reason('https://[fd7a:115c:a1e0::5]/', tailnet)).toBeNull();
  });

  it('refuses local names unless trusted', () => {
    expect(reason('https://localhost/')).toMatch(/local/);
    expect(reason('https://printer.local/')).toMatch(/local/);
    expect(reason('https://metadata.google.internal/')).toMatch(/local/);
    expect(reason('https://agent.example-tailnet.ts.net/hook', tailnet)).toBeNull();
  });
});

describe('resolveAllowed', () => {
  it('returns the checked answers for a public name', async () => {
    await expect(
      resolveAllowed('hooks.example.com', false, strict, answers('93.184.215.14')),
    ).resolves.toEqual([{ address: '93.184.215.14', family: 4 }]);
  });

  it('refuses a name that resolves to a private address (DNS rebinding)', async () => {
    await expect(
      resolveAllowed('rebind.example.com', false, strict, answers('127.0.0.1')),
    ).rejects.toThrow(/private/);
    await expect(
      resolveAllowed('rebind.example.com', false, strict, answers('169.254.169.254')),
    ).rejects.toThrow(/private/);
  });

  it('refuses a name when any of its answers is private', async () => {
    await expect(
      resolveAllowed('mixed.example.com', false, strict, answers('93.184.215.14', '10.0.0.8')),
    ).rejects.toThrow(/private/);
  });

  it('reaches a tailnet name through the operator’s allowlist', async () => {
    const agent = 'agent.example-tailnet.ts.net';
    await expect(resolveAllowed(agent, false, strict, answers('100.101.102.103'))).rejects.toThrow(
      /private/,
    );
    await expect(
      resolveAllowed(agent, true, tailnet, answers('100.101.102.103', 'fd7a:115c:a1e0::9')),
    ).resolves.toHaveLength(2);
    // A trusted name still cannot be pointed at this machine.
    await expect(resolveAllowed(agent, true, tailnet, answers('127.0.0.1'))).rejects.toThrow(
      /private/,
    );
  });

  it('refuses a name with no answers', async () => {
    await expect(resolveAllowed('empty.example.com', false, strict, answers())).rejects.toThrow(
      /resolve/,
    );
  });
});
