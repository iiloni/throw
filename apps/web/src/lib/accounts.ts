import {
  type Account,
  accountPath,
  activateAccount,
  authClient,
  clearAuthToken,
  followAccountNumber,
  forgetAccount,
  getAccounts,
  getSignedInUser,
  pageAccountGone,
  removedKey,
  SWITCHED_KEY,
} from './auth';
import { clearCommentDrafts } from './commentDrafts';
import { clearDescriptionDrafts } from './descriptionDrafts';
import { countQueuedWrites, deleteLocalDatabase, deleteOutbox } from './localStore';
import { loadPage, reloadPage } from './pageLoad';
import { getServerUrl } from './serverUrl';
import { getSyncStatus } from './syncStatus';
import { isUpdateReloadBlocked, watchUpdateReloadBlocked } from './useUpdateReloadBlocked';

/**
 * Several accounts can be signed in on one device (ADR 0016). A tab shows one of them: its
 * tasks are the ones open and its outbox the one sending, and tabs can show different
 * accounts side by side. An account open in no tab keeps its session and its copy of its
 * data until it is switched to.
 */

/** Changes the account this tab shows and loads `path` as it. A full load, so the collections
 * open that account's data. */
export function switchAccount(userId: string, path = '/') {
  if (userId === getSignedInUser()?.id || !activateAccount(userId)) return;
  sessionStorage.setItem(SWITCHED_KEY, 'true');
  const target = new URL(accountPath(userId, path), window.location.href);
  // The phone's addresses carry no number, and a change of fragment alone loads nothing.
  if (target.pathname + target.search === window.location.pathname + window.location.search) {
    window.history.replaceState(window.history.state, '', target);
    reloadPage();
  } else loadPage(target);
}

// Who this page was loaded for, still known after the account has been signed out.
const pageUser = getSignedInUser();

/**
 * Leaves an account that was signed out in another tab. This page holds its data and outbox,
 * so it loads again as another account, or at sign-in, once it holds no open draft the load
 * would drop. A switch in another tab changes nothing here; a reorder there changes only the
 * number in this page's address.
 */
export function followAccountChanges() {
  let stopWaiting: (() => void) | null = null;
  let leaving = false;
  const follow = () => {
    if (leaving || !pageAccountGone()) return;
    if (isUpdateReloadBlocked()) {
      stopWaiting ??= watchUpdateReloadBlocked(follow);
      return;
    }
    leaving = true;
    const user = pageUser;
    // The tab that signed it out could not delete a database this one had open.
    const cleared =
      user && localStorage.getItem(removedKey(user.id)) === 'true'
        ? import('./collections').then(({ clearLocalData }) => clearLocalData()).catch(() => {})
        : Promise.resolve();
    // Not a reload: the address names this account, and maybe a task the next does not have.
    void cleared.then(() => loadPage('/'));
  };
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea !== localStorage) return;
    followAccountNumber();
    follow();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('storage', onStorage);
    stopWaiting?.();
  };
}

/** Whether this page load is the one a switch asked for. True once. */
export function arrivedBySwitching() {
  const switched = sessionStorage.getItem(SWITCHED_KEY) === 'true';
  sessionStorage.removeItem(SWITCHED_KEY);
  return switched;
}

/** How many of an account's changes on this device have not reached the server. */
export async function unsyncedChanges(account: Account) {
  return account.user.id === getSignedInUser()?.id
    ? getSyncStatus().pending
    : countQueuedWrites(account.user.id);
}

/**
 * What the device remembered for one account outside its database: drafts, dismissed notices
 * and where it last was. A later sign-in starts as on a new device.
 */
function forgetAccountPreferences(userId: string) {
  clearCommentDrafts(userId);
  clearDescriptionDrafts(userId);
  localStorage.removeItem(`throw-navigation-${userId}`);
  const refusals = `throw-refusals:${getServerUrl()}:${userId}:`;
  for (const name of Object.keys(localStorage)) {
    if (name.startsWith(refusals)) localStorage.removeItem(name);
  }
}

/** Signs an account out of this device and deletes its data here. */
export async function signOutAccount(account: Account) {
  if (account.user.id === getSignedInUser()?.id) return signOutCurrentAccount();
  const { id } = account.user;
  localStorage.setItem(removedKey(id), 'true');
  // Offline the server keeps the session until it expires; the device forgets it either way.
  await fetch(`${getServerUrl()}/api/auth/sign-out`, {
    method: 'POST',
    // The browser's own cookie is another account's session.
    credentials: 'omit',
    headers: { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined);
  await deleteLocalDatabase(id).catch((error: unknown) => {
    // A tab that has it open deletes it as it leaves (`followAccountChanges`).
    console.warn("Some of a signed-out account's data is still on this device.", error);
  });
  deleteOutbox(id);
  forgetAccountPreferences(id);
  forgetAccount(id);
}

/** Signs out the account in use, then carries on as another if one is signed in. */
export async function signOutCurrentAccount() {
  const user = getSignedInUser();
  if (user) localStorage.setItem(removedKey(user.id), 'true');
  // Offline the server keeps the session until it expires; the device forgets it either way.
  await authClient.signOut().catch(() => undefined);
  const { clearLocalData } = await import('./collections');
  await clearLocalData();
  if (user) forgetAccountPreferences(user.id);
  clearAuthToken();
  const next = getAccounts()[0];
  if (next) activateAccount(next.user.id);
  // A full load drops this user's synced data from memory.
  loadPage(next ? accountPath(next.user.id) : '/login');
}
