import { snakeCamelMapper } from '@electric-sql/client';
import {
  type PersistedCollectionPersistence,
  type PersistedSyncWrappedOptions,
  persistedCollectionOptions,
} from '@tanstack/db-sqlite-persistence-core';
import { electricCollectionOptions } from '@tanstack/electric-db-collection';
import {
  NonRetriableError,
  type OfflineConfig,
  startOfflineExecutor,
  WebLocksLeader,
} from '@tanstack/offline-transactions';
import {
  createCollection,
  type PendingMutation,
  type Transaction,
  useLiveQuery,
} from '@tanstack/react-db';
import {
  createProjectSchema,
  createWorkspaceSchema,
  projectSchema,
  type TxidResponse,
  updateProjectSchema,
  updateWorkspaceSchema,
  workspaceSchema,
} from '@throw/shared';
import { toast } from 'sonner';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { ApiError, api } from './api';
import { getAuthToken, resolveSignedInUser } from './auth';
import { CompatibilityError } from './compatibility';
import {
  createOnlineDetector,
  createOutboxStorage,
  deleteOutbox,
  openLocalDatabase,
} from './localStore';
import { orderQueuedWrites } from './orderQueuedWrites';
import { getServerUrl } from './serverUrl';
import { shapeFetch } from './shapeFetch';
import { addPendingWrite, getSyncStatus, settlePendingWrite, updateSyncStatus } from './syncStatus';

// Collections read from and write to the signed-in user's store on this device, so the app
// shows and edits its data without a connection (ADR 0002).
const user = await resolveSignedInUser();
const database = user ? await openLocalDatabase(user.id) : null;

/** Keeps nothing: without a database, collections live in memory. */
const memoryOnly: PersistedCollectionPersistence = {
  adapter: {
    loadSubset: async () => [],
    applyCommittedTx: async () => {},
    ensureIndex: async () => {},
  },
};
const persistence = database?.persistence ?? memoryOnly;

/**
 * Adds the database to a synced collection's options. The wrapper swaps in a `sync` that
 * serves rows from the database first and saves synced changes to it; the rest of the
 * options, and so the collection's types, stay as they were.
 *
 * Bump `schemaVersion` whenever the columns the collection's shape syncs change (in the
 * server's `routes/shapes.ts` or the shared schema). Devices then drop their copy of the
 * collection and sync it again, rather than reading rows of the old shape.
 */
function persisted<TOptions extends object>(options: TOptions, schemaVersion: number): TOptions {
  return persistedCollectionOptions({
    ...(options as PersistedSyncWrappedOptions<object, string | number>),
    persistence,
    schemaVersion,
  }) as unknown as TOptions;
}

const shapeOptions = (shape: string) => ({
  url: `${getServerUrl()}/api/shapes/${shape}`,
  fetchClient: shapeFetch,
  headers: { Authorization: () => `Bearer ${getAuthToken() ?? ''}` },
  columnMapper: snakeCamelMapper(),
});

/**
 * The workspaces the signed-in user belongs to, synced from Postgres through Electric.
 * Change them through `write`, never directly.
 */
export const workspacesCollection = createCollection(
  persisted(
    electricCollectionOptions({
      id: 'workspaces',
      schema: workspaceSchema,
      getKey: (workspace) => workspace.id,
      shapeOptions: shapeOptions('workspaces'),
    }),
    1,
  ),
);

/** The projects in those workspaces. */
export const projectsCollection = createCollection(
  persisted(
    electricCollectionOptions({
      id: 'projects',
      schema: projectSchema,
      getKey: (project) => project.id,
      shapeOptions: shapeOptions('projects'),
    }),
    1,
  ),
);

const writableCollections = {
  workspaces: workspacesCollection,
  projects: projectsCollection,
};

/** How long to wait for Electric to stream a write back before letting it settle anyway. */
const SYNC_WAIT_MS = 30_000;

/**
 * Sends one queued transaction to the API, then waits until Electric streams it back so the
 * optimistic state hands over to synced rows without flicker. The outbox retries whatever
 * this throws, except `NonRetriableError`, which drops the write and rolls it back.
 */
async function pushWrites({ transaction }: Parameters<OfflineConfig['mutationFns'][string]>[0]) {
  let sent: { collectionId: string; txid: TxidResponse['txid'] }[];
  try {
    sent = [];
    // A workspace must exist before its projects. Preserve mutation order, also during a
    // retry after only the first requests reached the server.
    for (const mutation of transaction.mutations) {
      const response = await send(mutation);
      sent.push({ collectionId: mutation.collection.id, txid: response?.txid ?? null });
    }
  } catch (error) {
    const classified = classifyWriteError(error);
    if (classified instanceof NonRetriableError) settlePendingWrite(transaction.id);
    throw classified;
  }
  updateSyncStatus({ offline: false, signedOut: false });
  settlePendingWrite(transaction.id);
  await Promise.all(
    sent.flatMap(({ collectionId, txid }) => {
      if (txid === null) return [];
      const collection = Object.values(writableCollections).find(
        (item) => item.id === collectionId,
      );
      // The server has the write; a slow stream only delays the hand-over.
      return collection ? [collection.utils.awaitTxId(txid, SYNC_WAIT_MS).catch(() => false)] : [];
    }),
  );
}

/** The API call for one mutation, or null when there is nothing to send. */
function send(mutation: PendingMutation): Promise<TxidResponse> | null {
  const key = String(mutation.key);
  if (mutation.collection.id === workspacesCollection.id) {
    switch (mutation.type) {
      case 'insert':
        return api.createWorkspace(createWorkspaceSchema.parse(mutation.modified));
      case 'update': {
        const changes = updateWorkspaceSchema.parse(mutation.changes);
        // A write that changes no synced column would never have its txid streamed back.
        return Object.keys(changes).length === 0 ? null : api.updateWorkspace(key, changes);
      }
      case 'delete':
        return api.deleteWorkspace(key);
    }
  }
  if (mutation.collection.id === projectsCollection.id) {
    switch (mutation.type) {
      case 'insert':
        return api.createProject(createProjectSchema.parse(mutation.modified));
      case 'update': {
        const changes = updateProjectSchema.parse(mutation.changes);
        return Object.keys(changes).length === 0 ? null : api.updateProject(key, changes);
      }
      case 'delete':
        return api.deleteProject(key);
    }
  }
  throw new NonRetriableError(`Writes to ${mutation.collection.id} are not supported`);
}

/**
 * Sorts a failed write into one to retry (the connection or the server may come back, or
 * the user may sign in again) and one that will never succeed. Retried errors get fixed
 * messages: the outbox gives up on any whose message mentions some 4xx status codes.
 */
function classifyWriteError(error: unknown): Error {
  // A protocol mismatch must never become a permanent rejection that discards local edits.
  if (error instanceof CompatibilityError) return new Error(error.message);
  if (error instanceof NonRetriableError) return reject(error.message);
  if (error instanceof z.ZodError) return reject('Invalid change');
  if (error instanceof ApiError) {
    if (error.status === 401) {
      updateSyncStatus({ signedOut: true });
      return new Error('Waiting for sign-in');
    }
    if (error.status >= 500 || error.status === 408 || error.status === 429) {
      updateSyncStatus({ offline: true });
      return new Error('Server unavailable');
    }
    // A 404 is an edit to something deleted on another device before it arrived.
    if (error.status === 404) return reject('It was deleted on another device.');
    return reject('The server turned it down.');
  }
  // `fetch` rejects when the server cannot be reached.
  updateSyncStatus({ offline: true });
  return new Error('Server unreachable');
}

function reject(reason: string) {
  reportUnsaved(reason);
  return new NonRetriableError(reason);
}

function reportUnsaved(reason: string) {
  toast.error('A change could not be saved', { description: reason });
}

const onlineDetector = createOnlineDetector();

/**
 * The outbox: writes are stored on the device before they are sent, and sent in order,
 * retrying until the server has them. Only one tab per user keeps the outbox; the others
 * send their writes straight away and need a connection.
 */
const executor = startOfflineExecutor({
  collections: writableCollections,
  mutationFns: { push: pushWrites },
  storage: createOutboxStorage(user?.id ?? null),
  // Without Web Locks the executor falls back to electing a leader over a BroadcastChannel.
  leaderElection: WebLocksLeader.isSupported()
    ? new WebLocksLeader(`throw-outbox-${user?.id ?? ''}`)
    : undefined,
  onlineDetector,
  beforeRetry: orderQueuedWrites,
  onLeadershipChange: (isLeader) => updateSyncStatus({ sharedTab: !isLeader }),
});

const updateConnection = () => updateSyncStatus({ offline: !onlineDetector.isConnected() });
updateConnection();
window.addEventListener('offline', updateConnection);
onlineDetector.subscribe(updateConnection);

// Restores the writes an earlier visit left in the outbox, so they show until they sync.
await executor.waitForInit();
for (const queued of await executor.peekOutbox()) addPendingWrite(queued.id);

/**
 * Applies the changes `mutate` makes to the collections optimistically and queues them for
 * the server. The returned transaction's `isPersisted.promise` settles once the server has
 * them, which offline can be much later.
 */
export function write(mutate: () => void): Transaction {
  const offline = executor.createOfflineTransaction({
    mutationFnName: 'push',
    autoCommit: false,
    // Ordered within a millisecond, unlike the outbox's own times (see `orderQueuedWrites`).
    idempotencyKey: uuidv7(),
  });
  const transaction = offline.mutate(mutate);
  addPendingWrite(transaction.id);
  offline.commit().then(
    () => settlePendingWrite(transaction.id),
    (error: unknown) => {
      settlePendingWrite(transaction.id);
      // `pushWrites` reports the changes the server refused. Anything else failed on the
      // device: in a tab without the outbox, a write that could not be sent straight away.
      if (!(error instanceof NonRetriableError)) {
        reportUnsaved(
          getSyncStatus().sharedTab
            ? 'Throw is open in another tab, and only that tab can save changes offline.'
            : 'It could not be stored on this device.',
        );
      }
    },
  );
  return transaction;
}

/**
 * Signs out of this device: forgets writes that have not synced and deletes the device's
 * copy of the user's data. The page must reload afterwards.
 */
export async function clearLocalData() {
  await executor.clearOutbox();
  executor.dispose();
  await database?.destroy();
  if (user) deleteOutbox(user.id);
}

/** The signed-in user's workspaces, unordered, and whether they are still loading. */
export function useWorkspaces() {
  const { data = [], isLoading } = useLiveQuery((q) => q.from({ workspace: workspacesCollection }));
  return { workspaces: data, isLoading };
}

/** Every project in the user's workspaces, unordered. */
export function useProjects() {
  const { data = [], isLoading } = useLiveQuery((q) => q.from({ project: projectsCollection }));
  return { projects: data, isLoading };
}
