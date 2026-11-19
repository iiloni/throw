import { useEffect, useState } from 'react';
import { endExpiredSession } from '@/lib/auth';
import { DraftOpenError, prepareToLeavePage } from '@/lib/leavePage';
import { useSyncStatus } from '@/lib/syncStatus';

/** Says why changes are not reaching the server, and nothing when they are. */
export function SyncIndicator() {
  const { pending, offline, signedOut, incompatibility, sharedTab } = useSyncStatus();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A notice belongs to the expiry it was about, not to a later one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resets whenever signedOut changes.
  useEffect(() => setError(null), [signedOut]);
  // A page restored from the back/forward cache comes back with the button still disabled.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setLeaving(false);
    };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, []);
  async function signInAgain() {
    setLeaving(true);
    setError(null);
    try {
      await prepareToLeavePage();
      endExpiredSession();
    } catch (reason) {
      setLeaving(false);
      setError(
        reason instanceof DraftOpenError
          ? reason.message
          : 'Changes are still being saved on this device. Try again in a moment.',
      );
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
    <div className="flex flex-col items-start gap-1 text-xs">
      <div className="flex items-center gap-1 rounded-full bg-secondary py-0.5 pr-0.5 pl-2.5">
        {status}
        <button
          type="button"
          className="min-h-11 rounded-full px-2 font-medium text-brand-link underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/60 disabled:opacity-60"
          disabled={leaving}
          onClick={() => void signInAgain()}
        >
          Sign in again
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
