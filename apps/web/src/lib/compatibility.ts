import {
  API_PROTOCOL_HEADER,
  API_PROTOCOL_VERSION,
  type CompatibilityIssue,
  compatibilitySchema,
  protocolCompatibility,
  protocolErrorSchema,
} from '@throw/shared';
import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { getAuthToken } from './auth';
import { getServerUrl } from './serverUrl';
import { readPreference, writePreference } from './storage';
import { createStore } from './store';
import { getSyncStatus, subscribeToSyncStatus, updateSyncStatus } from './syncStatus';

export class CompatibilityError extends Error {
  constructor(readonly issue: CompatibilityIssue) {
    super(issue === 'client-too-old' ? 'Waiting for an app update' : 'Waiting for a server update');
  }
}

function serverCapability(preference: string) {
  const prefix = `throw-${preference}-support:`;
  const storageKey = (server: string) => prefix + server;
  const schema = z.boolean();
  const store = createStore<{ server: string; supported: boolean } | null>(null);

  const supported = () => {
    const server = getServerUrl();
    const current = store.get();
    return current?.server === server
      ? current.supported
      : readPreference(storageKey(server), schema, false);
  };

  return {
    useSupport: () => useSyncExternalStore(store.subscribe, supported),
    readStorage(key: string | null) {
      if (!key?.startsWith(prefix)) return;
      const server = getServerUrl();
      if (key === storageKey(server)) {
        store.set({ server, supported: readPreference(key, schema, false) });
      }
    },
    remember(server: string, supported: boolean) {
      store.set({ server, supported });
      const key = storageKey(server);
      if (readPreference(key, schema, false) === supported) return;
      try {
        writePreference(key, supported);
      } catch {
        // The live server response still applies when the offline cache cannot be written.
      }
    },
    async ensureSupport(force = false) {
      await checkCompatibility(force);
      if (!supported()) throw new CompatibilityError('server-too-old');
    },
  };
}

// Only a live bootstrap response can enable the optional remote shape. SQLite opens independently.
const githubLinksServer = createStore<string | null>(null);
const githubReleasesServer = createStore<string | null>(null);
const taskSize = serverCapability('task-size');
const statusColor = serverCapability('status-color');

// A capability saved by one tab also updates the other tabs' live values.
window.addEventListener('storage', ({ key }) => {
  taskSize.readStorage(key);
  statusColor.readStorage(key);
});

export const useTaskSizeSupport = taskSize.useSupport;
export const ensureTaskSizeSupport = taskSize.ensureSupport;
export const useStatusColorSupport = statusColor.useSupport;
export const ensureStatusColorSupport = statusColor.ensureSupport;

let checkedUntil = 0;
let checking: Promise<void> | null = null;

/** The bootstrap endpoint is stable and public, including when data requests are blocked. */
export function checkCompatibility(force = false): Promise<void> {
  if (!force && Date.now() < checkedUntil) return Promise.resolve();
  checking ??= (async () => {
    const server = getServerUrl();
    const response = await fetch(`${server}/api/compatibility`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    // Not a Throw server, or one behind a proxy that hides the route. Never send it writes.
    if (response.status === 404) {
      taskSize.remember(server, false);
      statusColor.remember(server, false);
      githubLinksServer.set(null);
      githubReleasesServer.set(null);
      updateSyncStatus({ incompatibility: 'server-too-old' });
    } else {
      if (!response.ok) throw new Error('Could not check API compatibility');
      const range = compatibilitySchema.safeParse(await response.json());
      // A malformed bootstrap response is retryable, never a Zod write-validation failure.
      if (!range.success) throw new Error('Could not verify API compatibility');
      taskSize.remember(server, range.data.taskSize);
      statusColor.remember(server, range.data.statusColor);
      githubLinksServer.set(range.data.githubTaskLinks ? server : null);
      githubReleasesServer.set(range.data.githubReleases ? server : null);
      updateSyncStatus({
        incompatibility: protocolCompatibility(API_PROTOCOL_VERSION, range.data),
      });
    }
    checkedUntil = Date.now() + 60_000;
  })().finally(() => {
    checking = null;
  });
  return checking;
}

export async function ensureCompatible() {
  await checkCompatibility();
  const { incompatibility } = getSyncStatus();
  if (incompatibility) throw new CompatibilityError(incompatibility);
}

export const protocolHeaders = { [API_PROTOCOL_HEADER]: String(API_PROTOCOL_VERSION) };

/** Also handles a server upgrade between the bootstrap check and an actual request. */
export async function observeProtocolResponse(response: Response) {
  if (response.status !== 426) return;
  const error = protocolErrorSchema.safeParse(await response.clone().json());
  if (!error.success) throw new Error('Could not verify API compatibility');
  const issue = protocolCompatibility(API_PROTOCOL_VERSION, error.data.protocol);
  if (!issue) throw new Error('The server rejected a supported API protocol');
  updateSyncStatus({ incompatibility: issue });
  checkedUntil = Date.now() + 60_000;
  throw new CompatibilityError(issue);
}

/**
 * Whether a request went with a token this device has since replaced, as a password change
 * does: its 401 is about that old session, not the current one.
 */
function sentStaleToken(headers: Headers) {
  const sent = headers.get('authorization');
  const token = getAuthToken();
  return sent !== null && token !== null && sent !== `Bearer ${token}`;
}

function headersOf(input: Parameters<typeof fetch>[0], init?: RequestInit) {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => {
    headers.set(key, value);
  });
  return headers;
}

export const compatibleFetch: typeof fetch = async (input, init) => {
  await ensureCompatible();
  const headers = headersOf(input, init);
  headers.set(API_PROTOCOL_HEADER, String(API_PROTOCOL_VERSION));
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401 && !sentStaleToken(headers)) updateSyncStatus({ signedOut: true });
  await observeProtocolResponse(response);
  return response;
};

/**
 * Each attempt carries the token this device holds when it is sent: Electric works its headers
 * out once per call, and a retry with a replaced token would only be refused again.
 */
function withCurrentToken(input: Parameters<typeof fetch>[0], init?: RequestInit): RequestInit {
  const headers = headersOf(input, init);
  const token = getAuthToken();
  if (token && headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
  return { ...init, headers };
}

function pause(ms: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function waitForGithubLinks(signal?: AbortSignal | null) {
  await checkCompatibility();
  await waitForSync(
    () => githubLinksServer.get() === getServerUrl(),
    signal,
    githubLinksServer.subscribe,
  );
}

export async function waitForGithubReleases(signal?: AbortSignal | null) {
  await checkCompatibility();
  await waitForSync(
    () => githubReleasesServer.get() === getServerUrl(),
    signal,
    githubReleasesServer.subscribe,
  );
}

function waitForSync(
  ready: () => boolean,
  signal?: AbortSignal | null,
  subscribe = subscribeToSyncStatus,
) {
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      unsubscribe();
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(signal.reason);
      else resolve();
    };
    const abort = () => finish();
    const unsubscribe = subscribe(() => {
      if (ready()) finish();
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (ready() || signal?.aborted) finish();
  });
}

/** Keep Electric's stream alive but idle; its default handling terminates on a 426. */
export const compatibleShapeFetch: typeof fetch = async (input, init) => {
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  for (;;) {
    signal?.throwIfAborted();
    await waitForSync(() => !getSyncStatus().signedOut, signal);
    try {
      // Never from the HTTP cache, whatever headers a server or proxy sent: a cached snapshot
      // counts as caught up and shows old rows as current (see `routes/shapes.ts`).
      const response = await compatibleFetch(input, {
        ...withCurrentToken(input, init),
        cache: 'no-store',
      });
      // Electric makes a 401 terminal. Keep its local collection alive until reauthentication:
      // a refused current token waits for sign-in above, and a token replaced meanwhile is
      // retried with the new one after a breath.
      if (response.status === 401) {
        await pause(1000, signal);
        continue;
      }
      return response;
    } catch (error) {
      if (!(error instanceof CompatibilityError)) throw error;
      await waitForSync(() => !getSyncStatus().incompatibility, signal);
    }
  }
};
