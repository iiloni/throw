import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { SyncIndicator } from '@/components/SyncIndicator/SyncIndicator';
import { Button } from '@/components/ui/button';
import { authClient, clearAuthToken, getAuthToken, getSignedInUser } from '@/lib/auth';
import { clearLocalData } from '@/lib/collections';
import { needsServerUrl } from '@/lib/serverUrl';
import { useSyncStatus } from '@/lib/syncStatus';

/**
 * Signed-in layout. A placeholder for the navigation rail and dock in docs/spec.md: it shows
 * whose data this is, how sync is doing, and a way out.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ location }) => {
    const search = { redirect: location.href };
    if (needsServerUrl()) throw redirect({ to: '/setup', search });
    if (!getAuthToken()) throw redirect({ to: '/login', search });
  },
  component: AppLayout,
});

function AppLayout() {
  const user = getSignedInUser();
  const { pending } = useSyncStatus();
  const [leaving, setLeaving] = useState(false);

  async function signOut() {
    if (
      pending > 0 &&
      !window.confirm(
        `${pending} unsaved ${pending === 1 ? 'change has' : 'changes have'} not reached the server and will be lost. Sign out anyway?`,
      )
    ) {
      return;
    }
    setLeaving(true);
    // Ends the session on the server when it can be reached; this device forgets it either way.
    await authClient.signOut().catch(() => undefined);
    await clearLocalData();
    clearAuthToken();
    // A full load, so nothing of this account's collections stays in memory.
    window.location.assign('/login');
  }

  return (
    <div className="min-h-dvh pt-[var(--safe-top)] pb-[var(--safe-bottom)]">
      <header className="mx-auto flex h-[var(--header-height)] max-w-3xl items-center gap-3 px-4">
        <span className="font-bold font-display text-xl">Throw</span>
        <SyncIndicator />
        <span className="ml-auto truncate text-muted-foreground text-sm">
          {user?.name || user?.email}
        </span>
        <Button variant="ghost" size="sm" disabled={leaving} onClick={signOut}>
          Sign out
        </Button>
      </header>
      <Outlet />
    </div>
  );
}
