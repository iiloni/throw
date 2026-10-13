import { useSyncStatus } from '@/lib/syncStatus';

/** Says why changes are not reaching the server, and nothing when they are. */
export function SyncIndicator() {
  const { pending, offline, signedOut, incompatibility } = useSyncStatus();
  const label = signedOut
    ? 'Signed out'
    : incompatibility === 'client-too-old'
      ? 'Update the app to sync'
      : incompatibility === 'server-too-old'
        ? 'Update the server to sync'
        : offline
          ? 'Offline'
          : pending > 0
            ? 'Saving…'
            : null;
  if (!label) return null;
  return (
    <span role="status" className="rounded-full bg-secondary px-2.5 py-0.5 text-xs">
      {label}
      {pending > 0 && (signedOut || offline || incompatibility) ? ` · ${pending} unsaved` : ''}
    </span>
  );
}
