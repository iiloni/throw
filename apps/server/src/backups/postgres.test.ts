import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  githubConnections,
  githubDeliveries,
  mcpStructureOperations,
  mcpTokens,
  session,
  webhookDeliveries,
  webhooks,
} from '../db/schema';
import { SHAPES } from '../routes/shapes';
import { CREDENTIAL_TABLES } from './postgres';

// Tables that hold credentials, or state that only means anything beside them (ADR 0011).
const serverOnly = [
  session,
  mcpTokens,
  mcpStructureOperations,
  webhooks,
  webhookDeliveries,
  githubConnections,
  githubDeliveries,
].map((table) => getTableName(table));

describe('credential tables', () => {
  it('are left out of backups and cleared by a restore', () => {
    expect([...CREDENTIAL_TABLES].sort()).toEqual([...serverOnly].sort());
  });

  it('are never synced', () => {
    const synced = Object.values(SHAPES).map(({ table }) => table);
    for (const table of serverOnly) expect(synced).not.toContain(table);
  });
});
