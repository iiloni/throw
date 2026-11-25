import { type RefObject, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { switchAccount, unsyncedChanges } from '@/lib/accounts';
import { type Account, getAccounts, getSignedInUser } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { createStore } from '@/lib/store';
import { isUpdateReloadBlocked } from '@/lib/useUpdateReloadBlocked';

/** Bumped when this tab changes the device's accounts; other tabs tell it by storage events. */
const accountsChanged = createStore(0);
export const refreshAccounts = () => accountsChanged.set(accountsChanged.get() + 1);

/** The accounts signed in on this device (ADR 0016), kept current as any tab changes them. */
export function useDeviceAccounts() {
  const version = accountsChanged.use();
  const [accounts, setAccounts] = useState(getAccounts);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-reads when this tab changes them.
  useEffect(() => setAccounts(getAccounts()), [version]);
  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.storageArea === localStorage) setAccounts(getAccounts());
    };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, []);
  const user = getSignedInUser();
  const current = accounts.find((account) => account.user.id === user?.id) ?? null;
  return { accounts, setAccounts, current };
}

/** Leaving an account loads the page again, which would drop an open task's or form's draft. */
export function canLeave(action: string) {
  if (!isUpdateReloadBlocked()) return true;
  toast(`Close the open task or draft before ${action}.`);
  return false;
}

export function switchTo(account: Account) {
  if (!canLeave('switching accounts')) return false;
  haptics.success();
  switchAccount(account.user.id);
  return true;
}

/** The sign-out waiting to be confirmed; `SignOutAccountHost` asks. */
export const signOutRequest = createStore<{ account: Account; pending: number } | null>(null);

/** Signing out deletes the account's data on the device, so it is always asked first. */
export async function askToSignOut(account: Account) {
  if (account.user.id === getSignedInUser()?.id && !canLeave('signing out')) return false;
  const pending = await unsyncedChanges(account);
  haptics.toggle();
  signOutRequest.set({ account, pending });
  return true;
}

/**
 * Keeps the drawer's own pull (ADR 0009) off a control that drags itself, such as a swiped
 * avatar or a list's move handle. The drawer listens for touches natively, so a React handler
 * would hear of them too late.
 */
export function useOwnTouch(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const stop = (event: TouchEvent) => event.stopPropagation();
    element.addEventListener('touchstart', stop, { passive: true });
    return () => element.removeEventListener('touchstart', stop);
  }, [ref]);
}
