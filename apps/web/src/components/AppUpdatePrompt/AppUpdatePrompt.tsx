import { useNavigate, useRouterState } from '@tanstack/react-router';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { getServerUrl } from '@/lib/serverUrl';
import { usePersistentState } from '@/lib/storage';
import { useSyncStatus } from '@/lib/syncStatus';
import { useAndroidUpdateAvailable, useUpdates } from '@/lib/updates';
import { useUpdateReloadBlocked } from '@/lib/useUpdateReloadBlocked';

export function AppUpdatePrompt() {
  const { incompatibility } = useSyncStatus();
  const blocked = useUpdateReloadBlocked();
  const required = incompatibility === 'client-too-old';
  const available = useAndroidUpdateAvailable();
  const { app, server } = useUpdates();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [dismissed, setDismissed] = usePersistentState(
    `throw-update-prompt:${getServerUrl()}:${app?.channel ?? ''}:${app?.version ?? ''}`,
    z.string().nullable(),
    null,
  );
  const target = `${required ? 'required:' : ''}${server?.version ?? ''}`;
  const dismiss = () => setDismissed(target);
  return (
    <Dialog
      open={
        (available || (required && Boolean(app))) &&
        dismissed !== target &&
        pathname !== '/settings' &&
        !blocked
      }
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <DialogContent>
        <DialogTitle>{required ? 'Update required to sync' : 'App update available'}</DialogTitle>
        <DialogDescription>
          {required
            ? 'Update your Android app to resume syncing. Your tasks and queued changes stay on this device.'
            : `Your server is running Throw ${server?.version}. Update your Android app to match it.`}
        </DialogDescription>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={dismiss}>
            {required ? 'Keep working offline' : 'Later'}
          </Button>
          <Button
            onClick={() => {
              dismiss();
              void navigate({ to: '/settings', hash: 'updates' });
            }}
          >
            Go to Update
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
