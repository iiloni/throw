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

it('backs up task GitHub links and exposes only their public metadata to workspace members', () => {
  const shape = SHAPES['task-github-links']!;
  expect(CREDENTIAL_TABLES).not.toContain(shape.table);
  expect(shape.where).toBe(SHAPES['task-relations']!.where);
  expect(shape.columns).toEqual([
    'id',
    'workspace_id',
    'project_id',
    'task_id',
    'repo',
    'kind',
    'number',
    'url',
    'title',
    'state',
    'review_decision',
    'checks_summary',
    'branch',
    'merge_commit_sha',
    'merged_at',
    'created_at',
    'updated_at',
  ]);
});

it.each(['github-releases', 'task-github-releases'])(
  'retains %s across backup and restore and scopes sync to workspace members',
  (name) => {
    const shape = SHAPES[name]!;
    expect(CREDENTIAL_TABLES).not.toContain(shape.table);
    expect(shape.where).toEqual(SHAPES['task-github-links']!.where);
  },
);

it('backs up invite hashes and claim history without syncing them', () => {
  expect(CREDENTIAL_TABLES).not.toContain('invites');
  expect(Object.values(SHAPES).map((shape) => shape.table)).not.toContain('invites');
});
