import { createFileRoute, redirect, useRouterState } from '@tanstack/react-router';
import { AppShell } from '@/components/AppShell/AppShell';
import { GpuWarmup } from '@/components/GpuWarmup/GpuWarmup';
import { getAuthToken } from '@/lib/auth';
import { needsServerUrl } from '@/lib/serverUrl';

export const Route = createFileRoute('/_app')({
  beforeLoad: ({ location }) => {
    const search = { redirect: location.href };
    if (needsServerUrl()) throw redirect({ to: '/setup', search });
    if (!getAuthToken()) throw redirect({ to: '/login', search });
  },
  component: App,
});

function App() {
  // A task opened from its link has drawn everything the warmup would.
  const taskOpen = useRouterState({
    select: (state) => Boolean((state.location.search as { task?: unknown }).task),
  });
  return (
    <>
      <AppShell />
      <GpuWarmup skip={taskOpen} />
    </>
  );
}
