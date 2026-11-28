import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { UserInvites } from '@/components/UserInvites/UserInvites';
import { UserManagement } from '@/components/UserManagement/UserManagement';
import { authClient } from '@/lib/auth';

export const Route = createFileRoute('/_app/settings/admin/users')({ component: Users });

function Users() {
  const navigate = useNavigate();
  const { data, refetch } = authClient.useSession();
  // The server has stopped treating this account as its admin: fetch the session again so the
  // admin pages stop being listed, and leave for one this account can open.
  const accessDenied = useCallback(() => {
    void refetch();
    void navigate({ to: '/settings/general', replace: true });
  }, [navigate, refetch]);
  return (
    <div className="flex flex-col gap-8">
      <UserManagement currentUserId={data?.user.id ?? ''} onAccessDenied={accessDenied} />
      <UserInvites onAccessDenied={accessDenied} />
    </div>
  );
}
