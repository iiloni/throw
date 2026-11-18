import { useState } from 'react';
import { clearAuthToken } from '@/lib/auth';
import { useSyncStatus } from '@/lib/syncStatus';

/** Says why changes are not reaching the server, and nothing when they are. */
export function SyncIndicator() {
  const { pending, offline, signedOut, incompatibility, sharedTab } = useSyncStatus();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState(false);
  async function signInAgain() {
    setLeaving(true);
    setError(false);
    try {
      const { waitForPendingWritesStored } = await import('@/lib/collections');
      await waitForPendingWritesStored();
      const { pathname, search, hash } = window.location;
      const params = new URLSearchParams({ redirect: pathname + search });
      // Clear the expired session while keeping the account's local data and outbox.
      clearAuthToken();
      window.location.assign(`/login?${params}${hash}`);
    } catch {
      setLeaving(false);
      setError(true);
    }
  }
  const label = signedOut
    ? 'Signed out'
    : incompatibility === 'client-too-old'
      ? 'Update the app to sync'
      : incompatibility === 'server-too-old'
        ? 'Update the server to sync'
        : offline
          ? sharedTab
            ? 'Offline · use the other tab'
            : 'Offline'
          : pending > 0
            ? 'Saving…'
            : null;
  if (!label) return null;
  const status = (
    <span role="status">
      {label}
      {pending > 0 && (signedOut || offline || incompatibility) ? ` · ${pending} unsaved` : ''}
    </span>
  );
  if (!signedOut)
    return <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs">{status}</span>;
  return (
    <div className="text-xs">
      <button
        type="button"
        aria-label="Sign in again"
        className="min-h-11 rounded-2xl bg-secondary px-2.5 py-1 text-left text-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        disabled={leaving}
        onClick={() => void signInAgain()}
      >
        {status}
        <span className="block font-medium text-[color:var(--brand-link)]">Sign in again</span>
      </button>
      {error && (
        <p role="alert">Changes are still being saved. Try signing in again in a moment.</p>
      )}
    </div>
  );
}
