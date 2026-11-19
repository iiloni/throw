import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { ServerBackups } from '@/components/ServerBackups/ServerBackups';
import { authClient } from '@/lib/auth';

export const Route = createFileRoute('/_app/settings/admin/backups')({ component: Backups });

function Backups() {
  const navigate = useNavigate();
  const { refetch } = authClient.useSession();
  // The server has stopped treating this account as its admin. The session this device holds
  // still says otherwise until it is fetched again, and would keep listing the admin pages.
  const accessDenied = useCallback(() => {
    void refetch();
    void navigate({ to: '/settings/general', replace: true });
  }, [navigate, refetch]);
  return <ServerBackups onAccessDenied={accessDenied} />;
}
