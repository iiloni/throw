import { createFileRoute, Navigate, Outlet } from '@tanstack/react-router';
import { authClient } from '@/lib/auth';
import { hasAdminRole } from '@/lib/settings';

export const Route = createFileRoute('/_app/settings/admin')({ component: AdminSettings });

/**
 * Admin pages open once the session says this account is the admin. A failed refetch keeps
 * the last session it had, so an admin stays put through a dropped connection; without any
 * session yet (offline from the start) the page says so rather than leaving.
 */
function AdminSettings() {
  const { data, error, isPending } = authClient.useSession();
  if (hasAdminRole(data?.user)) return <Outlet />;
  if (isPending) return null;
  if (error && !data)
    return (
      <p role="status" className="px-1 text-muted-foreground text-sm">
        Connect to the server to manage it.
      </p>
    );
  return <Navigate to="/settings/general" replace />;
}
