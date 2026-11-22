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
  eq,
  type PendingMutation,
  type Transaction,
  useLiveQuery,
} from '@tanstack/react-db';
import {
  activityEntrySchema,
  type Comment,
  commentSchema,
  createStatusSchema,
  createWorkspaceSchema,
  type Project,
  parseTimestamptz,
  projectSchema,
  type Status,
  statusSchema,
  type Tag,
  type TagWriteResponse,
  type Task,
  type TaskRelation,
  type TaskTag,
  tagSchema,
  taskRelationSchema,
  taskSchema,
  taskTagKey,
  taskTagSchema,
  updateTagSchema,
  updateWorkspaceSchema,
  workspaceSchema,
} from '@throw/shared';
import { toast } from 'sonner';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { ApiError, api } from './api';
import { getAuthToken, resolveSignedInUser } from './auth';
import { clearCommentDrafts } from './commentDrafts';
import { CompatibilityError } from './compatibility';
import { clearDescriptionDrafts, settleDescriptionDraft } from './descriptionDrafts';
import {
  createOnlineDetector,
  createOutboxStorage,
  deleteOutbox,
  openLocalDatabase,
} from './localStore';
import { orderQueuedWrites } from './orderQueuedWrites';
import { reportRefusedChanges } from './refusedChanges';
import { getServerUrl } from './serverUrl';
import { shapeFetch } from './shapeFetch';
import { noteLocalWrite, useSteadyRows } from './steadyRows';
import {
  addPendingWrite,
  getPendingWriteIds,
  getSyncStatus,
  settlePendingWrite,
  updateSyncStatus,
} from './syncStatus';
import { taskTimeline } from './timeline';
import { writeRefusalMessage } from './writeRefusal';
import {
  changeIdFor,
  commentCreateRequest,
  commentUpdateRequest,
  projectCreateRequest,
  projectUpdateRequest,
  statusUpdateRequest,
  tagCreateRequest,
  taskCreateFromWrite,
  taskRelationCreateRequest,
  taskUpdateRequest,
} from './writeRequests';

// Collections read from and write to the signed-in user's store on this device, so the app
// shows and edits its data without a connection (ADR 0002).
const user = await resolveSignedInUser();
const database = user ? await openLocalDatabase(user.id) : null;

/** Who this device's writes come from, as the server will record it. */
export const signedInUserId = user?.id ?? null;

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
  // Server times are kept as ISO strings, which compare in order (see `timestampSchema`).
  parser: { timestamptz: parseTimestamptz },
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

/** The projects in those workspaces, those in the trash included. */
export const projectsCollection = createCollection(
  persisted(
    electricCollectionOptions({
      id: 'projects',
      schema: projectSchema,
      getKey: (project) => project.id,
      shapeOptions: shapeOptions('projects'),
    }),
    2,
  ),
);

/**
 * Keeps a collection syncing whether or not anything on screen reads it, so its rows are on
 * the device before the user goes offline, and a write's hand-over (`awaitTxId`) always has a
 * stream to wait on. Workspaces and projects need none: the shell always reads them.
 */
const alwaysSynced = { startSync: true, gcTime: 0 } as const;

/** The statuses of those projects. */
export const statusesCollection = createCollection(
  persisted(
    electricCollectionOptions({
      ...alwaysSynced,
      id: 'statuses',
      schema: statusSchema,
      getKey: (status) => status.id,
      shapeOptions: shapeOptions('statuses'),
    }),
    1,
  ),
);

/** Every task and subtask in those projects, closed and trashed ones included. */
export const tasksCollection = createCollection(
  persisted(
    electricCollectionOptions({
      ...alwaysSynced,
      id: 'tasks',
      // Mutations validate the whole row, including rows synced from older servers.
      schema: taskSchema.extend({ size: taskSchema.shape.size.default(null) }),
      getKey: (task) => task.id,
      // Electric's int2 parser reads the nullable size column as a number.
      shapeOptions: shapeOptions('tasks'),
    }),
    3,
  ),
);

/** The complete tree and assignments are available before going offline. */
export const tagsCollection = createCollection(
  persisted(
    electricCollectionOptions({
      ...alwaysSynced,
      id: 'tags',
      schema: tagSchema,
      getKey: (tag) => tag.id,
      shapeOptions: shapeOptions('tags'),
    }),
    2,
  ),
);
export const taskTagsCollection = createCollection(
  persisted(
    electricCollectionOptions({
      ...alwaysSynced,
      id: 'task-tags',
      schema: taskTagSchema,
      getKey: taskTagKey,
      shapeOptions: shapeOptions('task-tags'),
    }),
    1,
  ),
);

/** Links between tasks, across the projects of a workspace. Always synced for board cards. */
export const taskRelationsCollection = createCollection(
  persisted(
    electricCollectionOptions({
      ...alwaysSynced,
      id: 'task-relations',
      schema: taskRelationSchema,
      getKey: (relation) => relation.id,
      shapeOptions: shapeOptions('task-relations'),
    }),
    1,
  ),
);

/**
 * The tasks' activity log (ADR 0006). The server writes every entry; devices only read it, so
 * it is not writable. It always syncs because a task's timeline reads offline.
 */
export const activityCollection = createCollection(
  persisted(
    electricCollectionOptions({
      ...alwaysSynced,
      id: 'task_activity',
      schema: activityEntrySchema,
      getKey: (entry) => entry.id,
      shapeOptions: shapeOptions('task_activity'),
    }),
    2,
  ),
);

/** The comments on those tasks. */
export const commentsCollection = createCollection(
  persisted(
    electricCollectionOptions({
      ...alwaysSynced,
      id: 'comments',
      schema: commentSchema,
      getKey: (comment) => comment.id,
      shapeOptions: shapeOptions('comments'),
    }),
    2,
  ),
);

const writableCollections = {
  workspaces: workspacesCollection,
  projects: projectsCollection,
  statuses: statusesCollection,
  tasks: tasksCollection,
  comments: commentsCollection,
  tags: tagsCollection,
  taskTags: taskTagsCollection,
  taskRelations: taskRelationsCollection,
};

type WritableCollection = (typeof writableCollections)[keyof typeof writableCollections];

/** How long to wait for Electric to stream a write back before letting it settle anyway. */
const SYNC_WAIT_MS = 30_000;

/**
 * Sends one queued transaction to the API, then waits until Electric streams it back so the
 * optimistic state hands over to synced rows without flicker. The outbox retries whatever
 * this throws, except `NonRetriableError`, which drops the write and rolls it back.
 */
async function pushWrites({
  transaction,
  idempotencyKey,
}: Parameters<OfflineConfig['mutationFns'][string]>[0]) {
  const waits: { collections: WritableCollection[]; txid: number }[] = [];
  try {
    // A workspace must exist before its projects. Preserve mutation order, also during a
    // retry after only the first requests reached the server.
    for (const mutation of transaction.mutations) {
      const sent = send(mutation, transaction.mutations, idempotencyKey);
      if (!sent) continue;
      const response = await sent.request;
      if (response.txid !== null) waits.push({ collections: sent.waitOn, txid: response.txid });
      if (response.tasksTxid !== undefined)
        waits.push({ collections: [tasksCollection], txid: response.tasksTxid });
      if (response.secondaryTagsTxid !== undefined)
        waits.push({ collections: [taskTagsCollection], txid: response.secondaryTagsTxid });
    }
  } catch (error) {
    const classified = classifyWriteError(error);
    if (classified instanceof NonRetriableError) settlePendingWrite(transaction.id);
    throw classified;
  }
  updateSyncStatus({ offline: false, signedOut: false });
  settlePendingWrite(transaction.id);
  await Promise.all(
    waits.flatMap(({ collections, txid }) =>
      // The server has the write; a slow stream only delays the hand-over.
      collections.map((collection) =>
        collection.utils.awaitTxId(txid, SYNC_WAIT_MS).catch(() => false),
      ),
    ),
  );
}

/** One mutation's request, and the collections whose shapes will stream its transaction. */
interface Sent {
  request: Promise<TagWriteResponse>;
  waitOn: WritableCollection[];
}

const sending = (request: Promise<TagWriteResponse>, ...waitOn: WritableCollection[]): Sent => ({
  request,
  waitOn,
});

const deletedInWrite = (mutations: readonly PendingMutation[], collectionId: string, key: string) =>
  mutations.some(
    (other) =>
      other.type === 'delete' && other.collection.id === collectionId && String(other.key) === key,
  );

/**
 * The API call for one mutation, or null when there is nothing to send. `mutations` is the
 * whole write, since some rows travel with another's request.
 */
function send(
  mutation: PendingMutation,
  mutations: readonly PendingMutation[],
  idempotencyKey: string,
): Sent | null {
  const key = String(mutation.key);
  const deletedTags = new Set(
    mutations
      .filter((other) => other.collection.id === tagsCollection.id && other.type === 'delete')
      .map((other) => String(other.key)),
  );
  if (mutation.collection.id === workspacesCollection.id) {
    switch (mutation.type) {
      case 'insert':
        return sending(
          api.createWorkspace(createWorkspaceSchema.parse(mutation.modified)),
          workspacesCollection,
        );
      case 'update': {
        const changes = updateWorkspaceSchema.parse(mutation.changes);
        // A write that changes no synced column would never have its txid streamed back.
        return Object.keys(changes).length === 0
          ? null
          : sending(api.updateWorkspace(key, changes), workspacesCollection);
      }
      case 'delete':
        return sending(api.deleteWorkspace(key), workspacesCollection);
    }
  }
  if (mutation.collection.id === projectsCollection.id) {
    switch (mutation.type) {
      case 'insert': {
        // A new project's statuses are created with it, in the same request.
        const statuses = mutations.flatMap((other) =>
          other.type === 'insert' &&
          other.collection.id === statusesCollection.id &&
          (other.modified as Status).projectId === key
            ? [other.modified as Status]
            : [],
        );
        return sending(
          api.createProject(projectCreateRequest(mutation.modified as Project, statuses)),
          projectsCollection,
          statusesCollection,
        );
      }
      case 'update': {
        const body = projectUpdateRequest(
          mutation.original as Project,
          mutation.modified as Project,
          mutation.changes as Partial<Project>,
        );
        return body ? sending(api.updateProject(key, body), projectsCollection) : null;
      }
      case 'delete': {
        // A delete queued before projects had a trash meant "delete"; it now trashes.
        if ((mutation.original as Partial<Project>).deletedAt == null)
          return sending(api.updateProject(key, { trashed: true }), projectsCollection);
        // The purge removes the project's statuses and tasks too, which the device deleted in
        // the same write. Wait for them as well, but only on shapes that will stream it.
        const dependents = [tasksCollection, tagsCollection, taskTagsCollection].filter(
          (collection) =>
            mutations.some(
              (other) =>
                other.type === 'delete' &&
                other.collection.id === collection.id &&
                (other.original as { projectId: string }).projectId === key,
            ),
        );
        return sending(
          api.purgeProject(key),
          projectsCollection,
          statusesCollection,
          ...dependents,
        );
      }
    }
  }
  if (mutation.collection.id === statusesCollection.id) {
    switch (mutation.type) {
      case 'insert': {
        const status = mutation.modified as Status;
        const withProject = mutations.some(
          (other) =>
            other.type === 'insert' &&
            other.collection.id === projectsCollection.id &&
            String(other.key) === status.projectId,
        );
        return withProject
          ? null
          : sending(api.createStatus(createStatusSchema.parse(status)), statusesCollection);
      }
      case 'update': {
        const body = statusUpdateRequest(mutation.changes as Partial<Status>);
        return body ? sending(api.updateStatus(key, body), statusesCollection) : null;
      }
      case 'delete':
        // Purging a project removes its statuses on the server.
        return deletedInWrite(
          mutations,
          projectsCollection.id,
          (mutation.original as Status).projectId,
        )
          ? null
          : sending(api.deleteStatus(key), statusesCollection);
    }
  }
  if (mutation.collection.id === tagsCollection.id) {
    const tag = (mutation.type === 'delete' ? mutation.original : mutation.modified) as Tag;
    if (deletedInWrite(mutations, projectsCollection.id, tag.projectId)) return null;
    switch (mutation.type) {
      case 'insert':
        return sending(api.createTag(tagCreateRequest(mutation.modified as Tag)), tagsCollection);
      case 'update': {
        // The server derives the new position from the parent change on replay.
        const { position: _position, ...changes } = mutation.changes as Partial<Tag>;
        return sending(api.updateTag(key, updateTagSchema.parse(changes)), tagsCollection);
      }
      case 'delete':
        return tag.parentId && deletedInWrite(mutations, tagsCollection.id, tag.parentId)
          ? null
          : sending(api.deleteTag(key), tagsCollection);
    }
  }
  if (mutation.collection.id === taskTagsCollection.id) {
    const row = (mutation.type === 'delete' ? mutation.original : mutation.modified) as TaskTag;
    const task = mutations.find(
      (other) => other.collection.id === tasksCollection.id && String(other.key) === row.taskId,
    );
    // Creates carry initial secondaries. Branch deletion/purges derive cleanup on the server.
    if (
      deletedTags.has(row.tagId) ||
      (task && (task.type === 'insert' || task.type === 'delete')) ||
      deletedInWrite(mutations, projectsCollection.id, row.projectId)
    )
      return null;
    return sending(
      api
        .updateTask(row.taskId, {
          changeId: changeIdFor(idempotencyKey, key),
          changes: { secondaryTags: [{ tagId: row.tagId, present: mutation.type !== 'delete' }] },
        })
        .then((response) => {
          reportRefusedChanges(row.taskId, response.refused, changeIdFor(idempotencyKey, key));
          return response;
        }),
      tasksCollection,
    );
  }
  if (mutation.collection.id === tasksCollection.id) {
    switch (mutation.type) {
      case 'insert':
        return sending(
          api.createTask(taskCreateFromWrite(mutation.modified as Task, mutations)),
          tasksCollection,
        );
      case 'update': {
        // A deleted branch clears current server assignments atomically.
        const original = mutation.original as Task;
        if (
          original.primaryTagId &&
          deletedTags.has(original.primaryTagId) &&
          Object.keys(mutation.changes).every((field) => field === 'primaryTagId')
        )
          return null;
        const body = taskUpdateRequest(
          mutation.original as Task,
          mutation.modified as Task,
          mutation.changes as Partial<Task>,
          changeIdFor(idempotencyKey, key),
        );
        if (!body) return null;
        return sending(
          api.updateTask(key, body).then((response) => {
            if (body.changes.description) {
              try {
                settleDescriptionDraft(
                  key,
                  body.changes.description.after,
                  response.refused.some((field) => field.field === 'description'),
                );
              } catch {
                // A recovery draft must not turn an acknowledged write into a retry.
                toast.error('Description recovery could not be stored on this device');
              }
            }
            reportRefusedChanges(key, response.refused, body.changeId);
            return response;
          }),
          tasksCollection,
        );
      }
      case 'delete': {
        // Purging a task or project removes the subtasks and tasks under it on the server.
        const task = mutation.original as Task;
        if (
          deletedInWrite(mutations, projectsCollection.id, task.projectId) ||
          (task.parentId !== null && deletedInWrite(mutations, tasksCollection.id, task.parentId))
        )
          return null;
        const taskIds = new Set([
          key,
          ...mutations.flatMap((other) =>
            other.type === 'delete' &&
            other.collection.id === tasksCollection.id &&
            (other.original as Task).parentId === key
              ? [String(other.key)]
              : [],
          ),
        ]);
        const assignmentsGo = mutations.some(
          (other) =>
            other.type === 'delete' &&
            other.collection.id === taskTagsCollection.id &&
            taskIds.has((other.original as TaskTag).taskId),
        );
        return sending(
          api.purgeTask(key),
          tasksCollection,
          ...(assignmentsGo ? [taskTagsCollection] : []),
        );
      }
    }
  }
  if (mutation.collection.id === taskRelationsCollection.id) {
    switch (mutation.type) {
      case 'insert':
        return sending(
          api.createTaskRelation(taskRelationCreateRequest(mutation.modified as TaskRelation)),
          taskRelationsCollection,
        );
      case 'update':
        // A relation is replaced, never edited.
        return null;
      case 'delete':
        return sending(api.deleteTaskRelation(key), taskRelationsCollection);
    }
  }
  if (mutation.collection.id === commentsCollection.id) {
    switch (mutation.type) {
      case 'insert':
        return sending(
          api.createComment(commentCreateRequest(mutation.modified as Comment)),
          commentsCollection,
        );
      case 'update': {
        const body = commentUpdateRequest(mutation.changes as Partial<Comment>);
        return body ? sending(api.updateComment(key, body), commentsCollection) : null;
      }
      case 'delete':
        return sending(api.deleteComment(key), commentsCollection);
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
      // A replaced token says nothing about the current session; the retry sends the new one.
      if (!error.staleToken) updateSyncStatus({ signedOut: true });
      return new Error('Waiting for sign-in');
    }
    if (error.status >= 500 || error.status === 408 || error.status === 429) {
      updateSyncStatus({ offline: true });
      return new Error('Server unavailable');
    }
    // A 404 is an edit to something deleted on another device before it arrived.
    if (error.status === 404) return reject('It was deleted on another device.');
    return reject(writeRefusalMessage(error.message) ?? 'The server turned it down.');
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
// Already durable: they came from the outbox. In a tab without it they never settle here,
// since the tab with the outbox sends them, so leaving the page does not wait for them.
const restoredWrites = new Set<string>();
for (const queued of await executor.peekOutbox()) {
  restoredWrites.add(queued.id);
  addPendingWrite(queued.id);
}

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
  noteLocalWrite();
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
  clearCommentDrafts();
  clearDescriptionDrafts();
}

/** The signed-in user's workspaces, unordered, and whether they are still loading. */
export function useWorkspaces() {
  const { data = [], isLoading } = useLiveQuery((q) => q.from({ workspace: workspacesCollection }));
  return { workspaces: data, isLoading };
}

/**
 * Every project in the user's workspaces, unordered. Rows stay through a re-fetch on
 * reconnecting (`useSteadyRows`), as do statuses and tasks.
 */
export function useProjects() {
  const { data = [], isLoading } = useLiveQuery((q) => q.from({ project: projectsCollection }));
  return { projects: useSteadyRows(data), isLoading };
}

/** Every status of the user's projects, unordered. */
export function useStatuses() {
  const { data = [], isLoading } = useLiveQuery((q) => q.from({ status: statusesCollection }));
  return { statuses: useSteadyRows(data), isLoading };
}

/** Every task and subtask in the user's projects, unordered, trashed ones included. */
export function useTasks() {
  const { data = [], isLoading } = useLiveQuery((q) => q.from({ task: tasksCollection }));
  return { tasks: useSteadyRows(data), isLoading };
}

/**
 * A task's timeline as the device holds it now: its log entries and comments in the server's
 * order, with comments not yet received by the server last (see `taskTimeline`).
 */
export function readTaskTimeline(taskId: string) {
  return taskTimeline(
    [...activityCollection.values()].filter((entry) => entry.taskId === taskId),
    [...commentsCollection.values()].filter((comment) => comment.taskId === taskId),
  );
}

/** `readTaskTimeline`, kept up to date. */
export function useTaskTimeline(taskId: string) {
  const entries = useLiveQuery(
    (q) => q.from({ entry: activityCollection }).where(({ entry }) => eq(entry.taskId, taskId)),
    [taskId],
  );
  const comments = useLiveQuery(
    (q) =>
      q.from({ comment: commentsCollection }).where(({ comment }) => eq(comment.taskId, taskId)),
    [taskId],
  );
  return {
    timeline: taskTimeline(entries.data ?? [], comments.data ?? []),
    isLoading: entries.isLoading || comments.isLoading,
  };
}

const emptyTags: Tag[] = [];

export function useTags(projectId: string) {
  const { data, isLoading } = useLiveQuery(
    (q) => q.from({ tag: tagsCollection }).where(({ tag }) => eq(tag.projectId, projectId)),
    [projectId],
  );
  // Keep the result stable between sync changes: the board adapts it in a layout effect.
  return { tags: data ?? emptyTags, isLoading };
}
/** Every tag of the user's projects, for the workspace board's cards. */
export function useAllTags() {
  const { data, isLoading } = useLiveQuery((q) => q.from({ tag: tagsCollection }));
  return { tags: data ?? emptyTags, isLoading };
}

/** Every secondary tag assignment, for board cards and search. */
export function useAllTaskTags() {
  const { data, isLoading } = useLiveQuery((q) => q.from({ assignment: taskTagsCollection }));
  return { taskTags: data ?? emptyTaskTags, isLoading };
}
const emptyTaskTags: TaskTag[] = [];

/** One project's secondary tag assignments, for its board's cards. */
export function useProjectTaskTags(projectId: string) {
  const { data } = useLiveQuery(
    (q) =>
      q
        .from({ assignment: taskTagsCollection })
        .where(({ assignment }) => eq(assignment.projectId, projectId)),
    [projectId],
  );
  return data ?? emptyTaskTags;
}

export function useTaskTags(taskId: string) {
  const { data, isLoading } = useLiveQuery(
    (q) =>
      q
        .from({ assignment: taskTagsCollection })
        .where(({ assignment }) => eq(assignment.taskId, taskId)),
    [taskId],
  );
  return { taskTags: data ?? emptyTaskTags, isLoading };
}

const emptyRelations: TaskRelation[] = [];

/** Every task relation in the user's workspaces, for board cards and the task view. */
export function useTaskRelations() {
  const { data, isLoading } = useLiveQuery((q) => q.from({ relation: taskRelationsCollection }));
  return { relations: data ?? emptyRelations, isLoading };
}

/** A reload must wait for in-flight writes to reach durable storage or the server. */
export async function waitForPendingWritesStored(): Promise<void> {
  const deadline = Date.now() + 10_000;
  const unstored = () => getPendingWriteIds().filter((id) => !restoredWrites.has(id));
  while (unstored().length) {
    const queued = new Set((await executor.peekOutbox()).map((write) => write.id));
    if (unstored().every((id) => queued.has(id))) return;
    if (Date.now() >= deadline) {
      throw new Error('Changes are still being saved. Wait a moment and try reloading again.');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
