import { createFileRoute, redirect } from '@tanstack/react-router';
import { AppShell } from '@/components/AppShell/AppShell';
import { getAuthToken } from '@/lib/auth';
import { needsServerUrl } from '@/lib/serverUrl';

export const Route = createFileRoute('/_app')({
  beforeLoad: ({ location }) => {
    const search = { redirect: location.href };
    if (needsServerUrl()) throw redirect({ to: '/setup', search });
    if (!getAuthToken()) throw redirect({ to: '/login', search });
  },
  component: AppShell,
});
