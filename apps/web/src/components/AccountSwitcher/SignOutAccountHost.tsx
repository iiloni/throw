import { useState } from 'react';
import { toast } from 'sonner';
import { accountLabel } from '@/components/AccountAvatar/AccountAvatar';
import { ManagementSurface } from '@/components/ManagementSurface/ManagementSurface';
import { Button } from '@/components/ui/button';
import { signOutAccount } from '@/lib/accounts';
import { haptics } from '@/lib/haptics';
import { refreshAccounts, signOutRequest } from './deviceAccounts';

/**
 * Asks before an account signs out, since that deletes its copy on the device and any change
 * that has not synced. It lives with the shell, so the list that asked (the rail's popover, the
 * phone's switcher) can close first: on a phone it takes the drawer's page (ADR 0009).
 */
export function SignOutAccountHost() {
  const request = signOutRequest.use();
  const [leaving, setLeaving] = useState(false);
  const close = () => {
    if (!leaving) signOutRequest.set(null);
  };
  const title = request ? `Sign out ${accountLabel(request.account)}?` : 'Sign out?';

  async function signOut() {
    if (!request) return;
    haptics.warning();
    setLeaving(true);
    try {
      // Signing out the account in use loads the page again; any other just leaves the list.
      await signOutAccount(request.account);
      signOutRequest.set(null);
      refreshAccounts();
    } catch {
      toast.error('Could not finish signing out. Try again.');
    } finally {
      setLeaving(false);
    }
  }

  return (
    <ManagementSurface open={request !== null} title={title} fit onClose={close}>
      {request && (
        <>
          <p className="mb-5 text-muted-foreground text-sm">
            {request.pending === 0
              ? 'This removes its tasks from this device. Sign in again to sync them from the server.'
              : request.pending === 1
                ? 'Signing out deletes 1 change that has not reached the server.'
                : `Signing out deletes ${request.pending} changes that have not reached the server.`}
          </p>
          <div className="flex justify-end gap-2 pb-1">
            <Button variant="ghost" disabled={leaving} onClick={close}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={leaving} onClick={signOut}>
              Sign out
            </Button>
          </div>
        </>
      )}
    </ManagementSurface>
  );
}
