import { createHash } from 'node:crypto';
import type { McpActor } from '../lib/mcpTokens';

export function writeId(actor: McpActor, operationId: string, purpose: string) {
  // Reuse the operation's UUIDv7 timestamp and namespace the rest to this credential.
  // An MCP client cannot use a chosen UUID to collide with a device's operation.
  const canonicalId = operationId.toLowerCase();
  const time = canonicalId.replaceAll('-', '').slice(0, 12);
  const hash = createHash('sha256')
    .update(`${actor.tokenId}/${canonicalId}/${purpose}`)
    .digest('hex');
  const variant = ((Number.parseInt(hash[3]!, 16) & 3) | 8).toString(16);
  return `${time.slice(0, 8)}-${time.slice(8)}-7${hash.slice(0, 3)}-${variant}${hash.slice(4, 7)}-${hash.slice(7, 19)}`;
}
