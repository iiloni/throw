import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { openLocalDatabase } from './localStore';

const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('@tanstack/browser-db-sqlite-persistence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/browser-db-sqlite-persistence')>()),
  openBrowserWASQLiteOPFSDatabase: mocks.open,
}));

afterEach(() => vi.restoreAllMocks());

it('resyncs an upgraded collection without resetting other collections during leadership', async () => {
  const sqlite = new DatabaseSync(':memory:');
  mocks.open.mockResolvedValue({
    execute: async <T>(sql: string, params: readonly unknown[] = []): Promise<readonly T[]> => {
      try {
        return sqlite.prepare(sql).all(...(params as SQLInputValue[])) as T[];
      } catch (error) {
        // The real OPFS worker serializes SQLite errors and creates an Error in this realm.
        throw new Error(String(error));
      }
    },
    close: () => sqlite.close(),
  });
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_name: string, _options: unknown, callback: () => Promise<void>) => callback(),
    },
  });
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { getDirectory: async () => ({ keys: async function* () {} }) },
  });
  const local = await openLocalDatabase('schema-routing-test');
  expect(local).not.toBeNull();
  if (!local) throw new Error('Database failed to open');
  try {
    const resolve = local.persistence.resolvePersistenceForCollection;
    if (!resolve) throw new Error('Missing collection resolver');
    const workspaces = resolve({
      collectionId: 'workspaces',
      mode: 'sync-present',
      schemaVersion: 1,
    });
    const oldProjects = resolve({
      collectionId: 'projects',
      mode: 'sync-present',
      schemaVersion: 1,
    });
    await oldProjects.adapter.applyCommittedTx('projects', {
      txId: 'old-projects-note',
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: [{ type: 'insert', key: 'projects', value: { id: 'projects' } }],
      collectionMetadataMutations: [
        { type: 'set', key: 'electric:resume', value: { handle: 'old-shape', offset: '0_inf' } },
      ],
    });
    const projects = resolve({
      collectionId: 'projects',
      mode: 'sync-present',
      schemaVersion: 2,
    });
    await workspaces.adapter.applyCommittedTx('workspaces', {
      txId: 'saved-note',
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: [{ type: 'insert', key: 'note', value: { id: 'note', text: 'Keep offline' } }],
    });
    await projects.adapter.getStreamPosition?.('projects');
    expect(await projects.adapter.loadCollectionMetadata?.('projects')).toEqual([]);
    expect(await projects.adapter.scanRows?.('projects')).toEqual([]);

    // Leadership reads the stream position through the coordinator, rather than the
    // collection's direct adapter. The previous wiring used projects' version here.
    workspaces.coordinator?.subscribe('workspaces', () => {});
    projects.coordinator?.subscribe('projects', () => {});
    await vi.waitFor(() => {
      expect(workspaces.coordinator?.isLeader('workspaces')).toBe(true);
      expect(projects.coordinator?.isLeader('projects')).toBe(true);
    });
    expect(await workspaces.adapter.scanRows?.('workspaces')).toEqual([
      expect.objectContaining({ key: 'note', value: { id: 'note', text: 'Keep offline' } }),
    ]);
    expect(
      sqlite
        .prepare(
          'SELECT collection_id, schema_version FROM collection_registry ORDER BY collection_id',
        )
        .all(),
    ).toEqual([
      { collection_id: 'projects', schema_version: 2 },
      { collection_id: 'workspaces', schema_version: 1 },
    ]);
  } finally {
    await local.destroy();
  }
});
