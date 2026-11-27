import { act, renderHook } from '@testing-library/react';
import { API_PROTOCOL_HEADER, API_PROTOCOL_VERSION } from '@throw/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./serverUrl', () => ({ getServerUrl: () => 'https://throw.example' }));
const auth = vi.hoisted(() => ({ token: null as string | null }));
vi.mock('./auth', () => ({ getAuthToken: () => auth.token }));
const fetcher = vi.fn();
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const compatible = { min: API_PROTOCOL_VERSION, max: API_PROTOCOL_VERSION };
const newer = { min: API_PROTOCOL_VERSION + 1, max: API_PROTOCOL_VERSION + 1 };
beforeEach(() => {
  vi.resetModules();
  fetcher.mockReset();
  auth.token = null;
  localStorage.clear();
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('client compatibility transport', () => {
  it('keeps release management requests off older servers', async () => {
    fetcher.mockResolvedValueOnce(json(compatible));
    const { api } = await import('./api');
    await expect(api.githubReleases('project')).rejects.toThrow('server update');
    await expect(
      api.createGithubRelease('project', { repo: 'a/b', tagName: 'v1' }),
    ).rejects.toThrow('server update');
    await expect(api.setGithubReleaseBinding('project', 'release', 'task', true)).rejects.toThrow(
      'server update',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps the GitHub stream idle on older protocol-1 servers and starts it after an upgrade', async () => {
    const url = 'https://throw.example/api/shapes/task-github-links';
    fetcher.mockResolvedValueOnce(json(compatible));
    const { githubLinksShapeFetch } = await import('./shapeFetch');
    const { checkCompatibility } = await import('./compatibility');
    const pending = githubLinksShapeFetch(url);
    await checkCompatibility();
    expect(fetcher.mock.calls.map(([input]) => input)).toEqual([
      'https://throw.example/api/compatibility',
    ]);
    fetcher
      .mockResolvedValueOnce(json({ ...compatible, githubTaskLinks: true }))
      .mockResolvedValueOnce(json([]));
    await checkCompatibility(true);
    await expect(pending.then((r) => r.status)).resolves.toBe(200);
    expect(fetcher.mock.lastCall?.[0]).toBe(url);
  });

  it('keeps the release stream idle on older protocol-1 servers and starts it after an upgrade', async () => {
    const url = 'https://throw.example/api/shapes/github-releases';
    fetcher.mockResolvedValueOnce(json(compatible));
    const { githubReleasesShapeFetch } = await import('./shapeFetch');
    const { checkCompatibility } = await import('./compatibility');
    const pending = githubReleasesShapeFetch(url);
    await checkCompatibility();
    expect(fetcher.mock.calls.map(([input]) => input)).toEqual([
      'https://throw.example/api/compatibility',
    ]);
    fetcher
      .mockResolvedValueOnce(json({ ...compatible, githubReleases: true }))
      .mockResolvedValueOnce(json([]));
    await checkCompatibility(true);
    await expect(pending.then((r) => r.status)).resolves.toBe(200);
    expect(fetcher.mock.lastCall?.[0]).toBe(url);
  });

  it('keeps color writes queued on a protocol 1 server without status color', async () => {
    fetcher.mockResolvedValueOnce(json(compatible)).mockResolvedValueOnce(json({ txid: null }));
    const { api } = await import('./api');
    const { CompatibilityError, useStatusColorSupport } = await import('./compatibility');
    const { result } = renderHook(useStatusColorSupport);
    await expect(api.updateStatus('id', { color: null })).rejects.toBeInstanceOf(
      CompatibilityError,
    );
    expect(result.current).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(api.updateStatus('id', { name: 'Review' })).resolves.toEqual({ txid: null });

    fetcher
      .mockResolvedValueOnce(json({ ...compatible, statusColor: true }))
      .mockResolvedValueOnce(json({ txid: 42 }));
    const colored = {
      id: 'id',
      projectId: 'project',
      name: 'Review',
      category: 'active',
      position: 'a0',
      isDefault: false,
      color: 'mint',
    } as const;
    await act(async () => {
      await expect(api.createStatus(colored)).resolves.toEqual({ txid: 42 });
    });
    expect(result.current).toBe(true);
    expect(JSON.parse(fetcher.mock.lastCall?.[1].body)).toEqual(colored);
  });

  it('pauses a refused shape, preserves pending writes, and resumes after sign-in', async () => {
    fetcher.mockResolvedValueOnce(json(compatible)).mockResolvedValueOnce(json({}, 401));
    const { compatibleShapeFetch } = await import('./compatibility');
    const { addPendingWrite, getSyncStatus, updateSyncStatus } = await import('./syncStatus');
    addPendingWrite('queued');
    const pending = compatibleShapeFetch('https://throw.example/api/shapes/projects');
    await vi.waitFor(() => expect(getSyncStatus().signedOut).toBe(true));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(getSyncStatus().pending).toBe(1);
    fetcher.mockResolvedValueOnce(json([]));
    updateSyncStatus({ signedOut: false });
    expect((await pending).status).toBe(200);
    expect(getSyncStatus().pending).toBe(1);
  });

  it('ignores a refusal of a token this device has since replaced', async () => {
    auth.token = 'new';
    fetcher.mockResolvedValueOnce(json(compatible)).mockResolvedValueOnce(json({}, 401));
    const { compatibleFetch } = await import('./compatibility');
    const { getSyncStatus } = await import('./syncStatus');
    await compatibleFetch('https://throw.example/api/tasks', {
      headers: { Authorization: 'Bearer old' },
    });
    expect(getSyncStatus().signedOut).toBe(false);
    fetcher.mockResolvedValueOnce(json({}, 401));
    await compatibleFetch('https://throw.example/api/tasks', {
      headers: { Authorization: 'Bearer new' },
    });
    expect(getSyncStatus().signedOut).toBe(true);
  });

  it('retries a shape refused for a replaced token with the current one', async () => {
    auth.token = 'old';
    fetcher.mockResolvedValueOnce(json(compatible)).mockImplementationOnce(async () => {
      auth.token = 'new';
      return json({}, 401);
    });
    fetcher.mockResolvedValueOnce(json([]));
    const { compatibleShapeFetch } = await import('./compatibility');
    const { getSyncStatus } = await import('./syncStatus');
    const response = await compatibleShapeFetch('https://throw.example/api/shapes/projects', {
      headers: { Authorization: 'Bearer old' },
    });
    expect(response.status).toBe(200);
    expect(getSyncStatus().signedOut).toBe(false);
    const sent = fetcher.mock.calls.slice(1).map(([, init]) => init.headers.get('Authorization'));
    expect(sent).toEqual(['Bearer old', 'Bearer new']);
  });

  it('aborts a refused shape while waiting for sign-in', async () => {
    fetcher.mockResolvedValueOnce(json(compatible)).mockResolvedValueOnce(json({}, 401));
    const { compatibleShapeFetch } = await import('./compatibility');
    const { getSyncStatus } = await import('./syncStatus');
    const controller = new AbortController();
    const pending = compatibleShapeFetch('https://throw.example/api/shapes/projects', {
      signal: controller.signal,
    });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(getSyncStatus().signedOut).toBe(true));
    controller.abort();
    await assertion;
  });

  it('coalesces bootstrap checks and declares its protocol without losing auth headers', async () => {
    fetcher.mockImplementation(async (url: string) =>
      json(url.endsWith('/compatibility') ? compatible : {}),
    );
    const { compatibleFetch } = await import('./compatibility');
    await Promise.all([
      compatibleFetch('https://throw.example/api/projects', {
        headers: { Authorization: 'Bearer token' },
      }),
      compatibleFetch('https://throw.example/api/shapes/projects'),
    ]);
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).endsWith('/compatibility')),
    ).toHaveLength(1);
    const headers = fetcher.mock.calls.find(([url]) => String(url).endsWith('/projects'))?.[1]
      .headers as Headers;
    expect(headers.get(API_PROTOCOL_HEADER)).toBe(String(API_PROTOCOL_VERSION));
    expect(headers.get('Authorization')).toBe('Bearer token');
  });

  it.each([
    ['client-too-old', newer, 200],
    ['server-too-old', null, 404],
  ] as const)('blocks %s before sending data', async (issue, range, status) => {
    fetcher.mockResolvedValueOnce(json(range, status));
    const { compatibleFetch, CompatibilityError } = await import('./compatibility');
    await expect(
      compatibleFetch('https://throw.example/api/projects', { method: 'POST' }),
    ).rejects.toBeInstanceOf(CompatibilityError);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const { getSyncStatus } = await import('./syncStatus');
    expect(getSyncStatus().incompatibility).toBe(issue);
  });

  it('detects an upgrade that races a successful bootstrap check', async () => {
    fetcher
      .mockResolvedValueOnce(json(compatible))
      .mockResolvedValueOnce(
        json({ code: 'INCOMPATIBLE_PROTOCOL', error: 'Update', protocol: newer }, 426),
      );
    const { compatibleFetch, CompatibilityError } = await import('./compatibility');
    await expect(compatibleFetch('https://throw.example/api/projects')).rejects.toBeInstanceOf(
      CompatibilityError,
    );
    const { getSyncStatus } = await import('./syncStatus');
    expect(getSyncStatus().incompatibility).toBe('client-too-old');
  });

  it('preserves pending counts and resumes a paused shape after compatibility returns', async () => {
    fetcher.mockResolvedValueOnce(json(newer));
    const { compatibleShapeFetch, checkCompatibility } = await import('./compatibility');
    const { addPendingWrite, getSyncStatus } = await import('./syncStatus');
    addPendingWrite('queued');
    const pending = compatibleShapeFetch('https://throw.example/api/shapes/projects');
    await vi.waitFor(() => expect(getSyncStatus().incompatibility).toBe('client-too-old'));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(getSyncStatus().pending).toBe(1);
    fetcher.mockResolvedValueOnce(json(compatible)).mockResolvedValueOnce(json([]));
    await checkCompatibility(true);
    expect((await pending).status).toBe(200);
    expect(getSyncStatus().incompatibility).toBeNull();
    expect(getSyncStatus().pending).toBe(1);
  });

  it('aborts paused shapes without waiting for an update', async () => {
    fetcher.mockResolvedValueOnce(json(newer));
    const { compatibleShapeFetch } = await import('./compatibility');
    const { getSyncStatus } = await import('./syncStatus');
    const controller = new AbortController();
    const pending = compatibleShapeFetch('https://throw.example/api/shapes/projects', {
      signal: controller.signal,
    });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(getSyncStatus().incompatibility).toBe('client-too-old'));
    controller.abort();
    await assertion;
  });

  it.each([new Error('Offline'), json({ min: 2, max: 1 }), json({}, 503)])(
    'keeps unavailable or malformed bootstrap responses retryable',
    async (response) => {
      if (response instanceof Error) fetcher.mockRejectedValueOnce(response);
      else fetcher.mockResolvedValueOnce(response);
      const { ensureCompatible } = await import('./compatibility');
      await expect(ensureCompatible()).rejects.not.toHaveProperty('name', 'ZodError');
      fetcher.mockResolvedValueOnce(json(compatible));
      await expect(ensureCompatible()).resolves.toBeUndefined();
    },
  );
});

it('keeps ordinary task writes compatible and retries sized writes after a server upgrade', async () => {
  const { api } = await import('./api');
  const { CompatibilityError, checkCompatibility } = await import('./compatibility');
  const { getSyncStatus } = await import('./syncStatus');
  const size = { changeId: 'queued', changes: { size: { before: null, after: 3 } } } as const;
  fetcher.mockResolvedValueOnce(json(compatible));
  await expect(api.updateTask('task', size)).rejects.toBeInstanceOf(CompatibilityError);
  expect(fetcher).toHaveBeenCalledTimes(1);

  fetcher.mockResolvedValueOnce(json({ txid: null, refused: [] }));
  await api.updateTask('task', {
    changeId: 'ordinary',
    changes: { title: { before: 'Old', after: 'New' } },
  });
  expect(getSyncStatus().incompatibility).toBeNull();

  fetcher.mockResolvedValueOnce(json({ ...compatible, taskSize: true }));
  await checkCompatibility(true);
  fetcher.mockResolvedValueOnce(json({ txid: 42, refused: [] }));
  await expect(api.updateTask('task', size)).resolves.toMatchObject({ txid: 42 });
  expect(JSON.parse(fetcher.mock.lastCall?.[1].body)).toEqual(size);

  fetcher.mockResolvedValueOnce(json({}, 400)).mockResolvedValueOnce(json(compatible));
  await expect(api.updateTask('task', size)).rejects.toBeInstanceOf(CompatibilityError);
});

it('uses the live size capability when local storage is full', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
  });
  try {
    fetcher.mockResolvedValueOnce(json({ ...compatible, taskSize: true }));
    fetcher.mockResolvedValueOnce(json({ txid: 42, refused: [] }));
    const { api } = await import('./api');
    await expect(
      api.updateTask('task', { changeId: 'queued', changes: { size: { before: null, after: 3 } } }),
    ).resolves.toMatchObject({ txid: 42 });
    expect(setItem).toHaveBeenCalledWith('throw-task-size-support:https://throw.example', 'true');
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    setItem.mockRestore();
  }
});

it('reflects size capability changes made by another tab', async () => {
  fetcher.mockResolvedValueOnce(json(compatible));
  const { checkCompatibility, ensureTaskSizeSupport, useTaskSizeSupport } = await import(
    './compatibility'
  );
  await checkCompatibility();
  const { result } = renderHook(useTaskSizeSupport);
  expect(result.current).toBe(false);

  const key = 'throw-task-size-support:https://throw.example';
  for (const supported of [true, false]) {
    act(() => {
      localStorage.setItem(key, String(supported));
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: String(supported) }));
    });
    expect(result.current).toBe(supported);
    if (supported) await expect(ensureTaskSizeSupport()).resolves.toBeUndefined();
    else await expect(ensureTaskSizeSupport()).rejects.toThrow('Waiting for a server update');
  }
  expect(fetcher).toHaveBeenCalledTimes(1);
});
