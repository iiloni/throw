import type { LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';

/**
 * Where a webhook may deliver (ADR 0015). Receivers must be public HTTPS endpoints unless the
 * operator names private hosts or ranges, such as a tailnet. Names are checked again at
 * every delivery against each address DNS returns, and the connection uses only those
 * checked addresses, so a name cannot be re-pointed at an internal service between the
 * check and the request.
 */
export type WebhookPolicy = {
  allowedHosts: readonly string[];
  allowedCidrs: BlockList;
  allowLoopbackHttp: boolean;
};

type Family = 'ipv4' | 'ipv6';

function subnets(entries: readonly string[]) {
  const list = new BlockList();
  for (const entry of entries) {
    const [address = '', prefix = ''] = entry.split('/');
    list.addSubnet(address, Number(prefix), isIP(address) === 4 ? 'ipv4' : 'ipv6');
  }
  return list;
}

/** Never reachable, even for a trusted host: this machine, link-local and cloud metadata. */
const ALWAYS_BLOCKED = subnets([
  '0.0.0.0/8',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '::/96',
  'fe80::/10',
  'fec0::/10',
  'ff00::/8',
]);

/** Private and special-purpose ranges: reachable only for hosts or ranges the operator trusts. */
const PRIVATE = subnets([
  '10.0.0.0/8',
  '100.64.0.0/10',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '100::/64',
  '2001::/23',
  '2001:db8::/32',
  '2002::/16',
  'fc00::/7',
]);

const LOOPBACK = subnets(['127.0.0.0/8', '::1/128']);

const HOST_PATTERN =
  /^(\*\.)?(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export const isAllowedHostPattern = (entry: string) => HOST_PATTERN.test(entry);

export function policyFrom(env: {
  WEBHOOK_ALLOWED_HOSTS: readonly string[];
  WEBHOOK_ALLOWED_CIDRS: readonly string[];
  WEBHOOK_ALLOW_LOOPBACK_HTTP: boolean;
}): WebhookPolicy {
  return {
    allowedHosts: env.WEBHOOK_ALLOWED_HOSTS.map((host) => host.toLowerCase()),
    allowedCidrs: subnets(
      env.WEBHOOK_ALLOWED_CIDRS.map((entry) =>
        entry.includes('/') ? entry : `${entry}/${isIP(entry) === 4 ? 32 : 128}`,
      ),
    ),
    allowLoopbackHttp: env.WEBHOOK_ALLOW_LOOPBACK_HTTP,
  };
}

/** The eight 16-bit groups of an IPv6 address. */
function hextets(address: string): number[] | null {
  let text = address;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const octets = dotted[1]!.split('.').map(Number);
    text = `${text.slice(0, -dotted[1]!.length)}${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
  }
  const [head = '', tail, extra] = text.split('::');
  if (extra !== undefined) return null;
  const parse = (part: string) =>
    part ? part.split(':').map((group) => Number.parseInt(group, 16)) : [];
  const start = parse(head);
  const end = tail === undefined ? [] : parse(tail);
  const missing = 8 - start.length - end.length;
  if (tail === undefined ? missing !== 0 : missing < 0) return null;
  return [...start, ...new Array<number>(missing).fill(0), ...end];
}

/**
 * The IPv4 address an IPv6 address stands for: IPv4-mapped (`::ffff:a.b.c.d`) and the NAT64
 * well-known prefix (`64:ff9b::/96`), which reach the IPv4 network.
 */
function embeddedIpv4(address: string): string | null {
  const groups = hextets(address);
  if (!groups) return null;
  const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  const nat64 =
    groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((group) => group === 0);
  if (!mapped && !nat64) return null;
  return [groups[6]! >> 8, groups[6]! & 0xff, groups[7]! >> 8, groups[7]! & 0xff].join('.');
}

function normalize(address: string): { address: string; family: Family } | null {
  const bare = address.replace(/^\[|\]$/g, '');
  const family = isIP(bare);
  if (family === 4) return { address: bare, family: 'ipv4' };
  if (family !== 6) return null;
  const ipv4 = embeddedIpv4(bare);
  return ipv4 ? { address: ipv4, family: 'ipv4' } : { address: bare, family: 'ipv6' };
}

export type AddressClass = 'public' | 'private' | 'blocked';

export function classifyAddress(address: string): AddressClass {
  const parsed = normalize(address);
  if (!parsed) return 'blocked';
  if (ALWAYS_BLOCKED.check(parsed.address, parsed.family)) return 'blocked';
  return PRIVATE.check(parsed.address, parsed.family) ? 'private' : 'public';
}

const isLoopback = (address: string) => {
  const parsed = normalize(address);
  return parsed !== null && LOOPBACK.check(parsed.address, parsed.family);
};

export function matchesAllowedHost(hostname: string, policy: WebhookPolicy) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return policy.allowedHosts.some((pattern) =>
    pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern,
  );
}

/**
 * Whether a connection to `address` is allowed. An address in an allowed range always is. A
 * trusted host may reach private addresses but never this machine, link-local or multicast.
 */
export function addressAllowed(address: string, hostTrusted: boolean, policy: WebhookPolicy) {
  const parsed = normalize(address);
  if (!parsed) return false;
  const raw = address.replace(/^\[|\]$/g, '');
  if (
    policy.allowedCidrs.check(parsed.address, parsed.family) ||
    (raw !== parsed.address && policy.allowedCidrs.check(raw, 'ipv6'))
  )
    return true;
  if (policy.allowLoopbackHttp && isLoopback(address)) return true;
  const kind = classifyAddress(address);
  return kind === 'public' || (kind === 'private' && hostTrusted);
}

export type CheckedUrl = { url: URL; hostname: string; hostTrusted: boolean };

const LOCAL_NAMES = /(^|\.)(localhost|localdomain|internal|local)$/i;

/**
 * Checks a receiver's URL without DNS: when it is saved, and again before each delivery
 * resolves the name. Returns a reason a user can act on when it is refused.
 */
export function checkWebhookUrl(
  input: string,
  policy: WebhookPolicy,
): { ok: true; checked: CheckedUrl } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: 'Enter a full URL, starting with https://' };
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const literal = isIP(hostname) !== 0;
  const loopbackTarget = literal ? isLoopback(hostname) : /^localhost\.?$/i.test(hostname);
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && policy.allowLoopbackHttp && loopbackTarget)
  )
    return { ok: false, reason: 'Webhooks must use https://' };
  if (url.username || url.password)
    return { ok: false, reason: 'Remove the user name and password from the URL' };
  const hostTrusted = matchesAllowedHost(hostname, policy);
  if (literal) {
    if (!addressAllowed(hostname, hostTrusted, policy))
      return { ok: false, reason: 'This server does not send webhooks to private addresses' };
  } else if (LOCAL_NAMES.test(hostname.replace(/\.$/, '')) && !hostTrusted) {
    if (!(policy.allowLoopbackHttp && loopbackTarget))
      return { ok: false, reason: 'This server does not send webhooks to local network names' };
  }
  return { ok: true, checked: { url, hostname, hostTrusted } };
}

export class WebhookAddressError extends Error {
  readonly code = 'EWEBHOOKADDRESS';
}

type Resolve = (hostname: string) => Promise<LookupAddress[]>;

/**
 * Resolves a receiver's name and refuses it when any answer is not allowed, so a name with
 * one public and one internal record cannot be used to reach the internal one.
 */
export async function resolveAllowed(
  hostname: string,
  hostTrusted: boolean,
  policy: WebhookPolicy,
  resolve: Resolve,
): Promise<LookupAddress[]> {
  if (isIP(hostname)) {
    if (!addressAllowed(hostname, hostTrusted, policy))
      throw new WebhookAddressError('The receiver’s address is private');
    return [{ address: hostname, family: isIP(hostname) }];
  }
  const answers = await resolve(hostname);
  if (answers.length === 0) throw new WebhookAddressError('The receiver’s name did not resolve');
  if (answers.some(({ address }) => !addressAllowed(address, hostTrusted, policy)))
    throw new WebhookAddressError('The receiver’s name resolves to a private address');
  return answers;
}
