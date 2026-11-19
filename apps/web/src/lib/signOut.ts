import { authClient, clearAuthToken } from './auth';
import { clearLocalData } from './collections';

/** Ends the session and deletes this account's data from the device, outbox included. */
export async function signOut() {
  await authClient.signOut().catch(() => undefined);
  await clearLocalData();
  clearAuthToken();
  window.location.assign('/login');
}
