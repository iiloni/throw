import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { ServerBackups } from '@/components/ServerBackups/ServerBackups';

export const Route = createFileRoute('/_app/settings/admin/backups')({ component: Backups });

function Backups() {
  const navigate = useNavigate();
  // The server has stopped treating this account as its admin.
  const accessDenied = useCallback(
    () => void navigate({ to: '/settings/general', replace: true }),
    [navigate],
  );
  return <ServerBackups onAccessDenied={accessDenied} />;
}
