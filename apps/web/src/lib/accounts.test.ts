import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SuccessContext = { response: Response; request: { url: string }; data: unknown };
const mocks = vi.hoisted(() => ({
  success: undefined as ((context: SuccessContext) => void) | undefined,
  serverSignOut: vi.fn(async () => ({})),
  clearLocalData: vi.fn(async () => {}),
  deleteLocalDatabase: vi.fn(async (_userId: string) => {}),
  deleteOutbox: vi.fn((_userId: string) => {}),
  countQueuedWrites: vi.fn(async (_userId: string) => 3),
  pending: 0,
  assign: vi.fn((_url: string | URL) => {}),
  reload: vi.fn(() => {}),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('./serverUrl', () => ({ getServerUrl: () => 'http://server' }));
vi.mock('better-auth/react', () => ({
  createAuthClient: (options: {
    fetchOptions: { onSuccess: (context: SuccessContext) => void };
  }) => {
    mocks.success = options.fetchOptions.onSuccess;
    return { signOut: mocks.serverSignOut };
  },
}));
vi.mock('./collections', () => ({ clearLocalData: mocks.clearLocalData }));
vi.mock('./localStore', () => ({
  countQueuedWrites: mocks.countQueuedWrites,
  deleteLocalDatabase: mocks.deleteLocalDatabase,
  deleteOutbox: mocks.deleteOutbox,
}));
vi.mock('./pageLoad', () => ({ loadPage: mocks.assign, reloadPage: mocks.reload }));
vi.mock('./syncStatus', () => ({ getSyncStatus: () => ({ pending: mocks.pending }) }));

const first = { id: 'first-user', name: 'First', email: 'first@example.com' };
const second = { id: 'second-user', name: '', email: 'second@example.com' };

let auth: typeof import('./auth');
let accounts: typeof import('./accounts');
let reloads: typeof import('./useUpdateReloadBlocked');
const { assign, reload } = mocks;

/** Loads the page again, at `path`: a page keeps the account it was loaded for until then. */
async function load(path = '/') {
  window.history.replaceState(null, '', path);
  vi.resetModules();
  auth = await import('./auth');
  accounts = await import('./accounts');
  reloads = await import('./useUpdateReloadBlocked');
}

function signIn(token: string, user: typeof first) {
  mocks.success?.({
    response: new Response(null, { headers: { 'set-auth-token': token } }),
    request: { url: 'http://server/api/auth/sign-in/email' },
    data: { user },
  });
}

/** Both accounts signed in, on a page loaded for the second. */
async function signInBoth() {
  await load();
  signIn('first-token', first);
  await load();
  signIn('second-token', second);
  await load();
}

const keysOf = (userId: string) => [
  `throw-comment:http://server:${userId}:task-1`,
  `throw-description:http://server:${userId}:task-1`,
  `throw-refusals:http://server:${userId}:task-1`,
  `throw-navigation-${userId}`,
];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  mocks.pending = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}')),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('signing out', () => {
  it('signs out another account, deleting only its data, and stays on this page', async () => {
    await signInBoth();
    for (const key of [...keysOf(first.id), ...keysOf(second.id)]) localStorage.setItem(key, '1');
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);

    const account = auth.getAccounts().find(({ user }) => user.id === first.id);
    if (!account) throw new Error('First account is not listed');
    await accounts.signOutAccount(account);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://server/api/auth/sign-out',
      expect.objectContaining({
        credentials: 'omit',
        headers: expect.objectContaining({ Authorization: 'Bearer first-token' }),
      }),
    );
    expect(mocks.deleteLocalDatabase).toHaveBeenCalledWith(first.id);
    expect(mocks.deleteOutbox).toHaveBeenCalledWith(first.id);
    expect(mocks.clearLocalData).not.toHaveBeenCalled();
    for (const key of keysOf(first.id)) expect(localStorage.getItem(key)).toBeNull();
    for (const key of keysOf(second.id)) expect(localStorage.getItem(key)).toBe('1');
    expect(auth.getAccounts()).toEqual([{ user: second, token: 'second-token' }]);
    expect(auth.getSignedInUser()).toEqual(second);
    expect(assign).not.toHaveBeenCalled();
  });

  it('carries on as the account left after signing out the one in use', async () => {
    await signInBoth();
    for (const key of [...keysOf(first.id), ...keysOf(second.id)]) localStorage.setItem(key, '1');
    await accounts.signOutCurrentAccount();
    expect(mocks.serverSignOut).toHaveBeenCalledOnce();
    expect(mocks.clearLocalData).toHaveBeenCalledOnce();
    for (const key of keysOf(second.id)) expect(localStorage.getItem(key)).toBeNull();
    for (const key of keysOf(first.id)) expect(localStorage.getItem(key)).toBe('1');
    expect(auth.getAccounts()).toEqual([{ user: first, token: 'first-token' }]);
    expect(localStorage.getItem('throw-auth-token')).toBe('first-token');
    // One account left: its addresses carry no number.
    expect(assign).toHaveBeenCalledWith('/');
  });

  it('goes to sign in once no account is left', async () => {
    await load();
    signIn('first-token', first);
    await load();
    await accounts.signOutCurrentAccount();
    expect(auth.getAccounts()).toEqual([]);
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('counts unsynced changes from the outbox of an account not in use', async () => {
    await signInBoth();
    mocks.pending = 2;
    const [firstAccount, secondAccount] = auth.getAccounts();
    if (!firstAccount || !secondAccount) throw new Error('Accounts are not listed');
    expect(await accounts.unsyncedChanges(secondAccount)).toBe(2);
    expect(await accounts.unsyncedChanges(firstAccount)).toBe(3);
    expect(mocks.countQueuedWrites).toHaveBeenCalledWith(first.id);
  });
});

describe('switching', () => {
  it('loads the other account’s address and says so once', async () => {
    await signInBoth();
    accounts.switchAccount(first.id, '/settings');
    expect(String(assign.mock.calls[0]?.[0])).toBe(`${window.location.origin}/u/1/settings`);
    expect(localStorage.getItem('throw-auth-token')).toBe('first-token');
    // The page keeps its own account until it loads again.
    expect(auth.getAuthToken()).toBe('second-token');
    await load('/u/1/settings');
    expect(auth.getSignedInUser()).toEqual(first);
    expect(accounts.arrivedBySwitching()).toBe(true);
    expect(accounts.arrivedBySwitching()).toBe(false);
  });

  it('does nothing for the account showing or one not signed in', async () => {
    await signInBoth();
    accounts.switchAccount(second.id);
    accounts.switchAccount('nobody');
    expect(assign).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('following other tabs', () => {
  it('leaves an account signed out elsewhere once no draft is open, deleting its data', async () => {
    await signInBoth();
    const stop = accounts.followAccountChanges();
    const release = reloads.holdUpdateReload();
    // Another tab signs the second account out; it could not delete this page's database.
    localStorage.setItem(`throw-account-removed:${second.id}`, 'true');
    localStorage.setItem('throw-accounts', JSON.stringify([{ user: first, token: 'first-token' }]));
    localStorage.setItem('throw-auth-token', 'first-token');
    localStorage.setItem('throw-user', JSON.stringify(first));
    localStorage.setItem('throw-active-account', first.id);
    window.dispatchEvent(new StorageEvent('storage', { storageArea: localStorage }));
    await Promise.resolve();
    expect(assign).not.toHaveBeenCalled();

    release();
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    expect(mocks.clearLocalData).toHaveBeenCalledOnce();
    stop();
  });

  it('stays when another tab only switches account', async () => {
    await signInBoth();
    const stop = accounts.followAccountChanges();
    auth.activateAccount(first.id);
    window.dispatchEvent(new StorageEvent('storage', { storageArea: localStorage }));
    await Promise.resolve();
    expect(assign).not.toHaveBeenCalled();
    expect(auth.getSignedInUser()).toEqual(second);
    stop();
  });
});
