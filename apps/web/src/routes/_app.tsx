import { createFileRoute, redirect, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { AppShell } from '@/components/AppShell/AppShell';
import { drag, isPrimed } from '@/components/Board/drag';
import { board, useScrollbarSetting } from '@/components/Board/state';
import { GpuWarmup } from '@/components/GpuWarmup/GpuWarmup';
import { arrivedBySwitching, followAccountChanges } from '@/lib/accounts';
import { getAuthToken, getSignedInUser } from '@/lib/auth';
import { watchScrollBounce } from '@/lib/scrollBounce';
import { needsServerUrl } from '@/lib/serverUrl';

export const Route = createFileRoute('/_app')({
  beforeLoad: ({ location }) => {
    const search = { redirect: location.href };
    if (needsServerUrl()) throw redirect({ to: '/setup', search });
    if (!getAuthToken()) throw redirect({ to: '/login', search });
  },
  component: App,
});

/** A held, dragged or keyboard-carried card moves its column itself; the edge takes no bounce. */
const cardHeld = () => drag.get() !== null || isPrimed() || board.get().carrying !== null;

function App() {
  useEffect(() => watchScrollBounce({ held: cardHeld }), []);
  useScrollbarSetting();
  // A tab whose account signs out elsewhere moves on to another (ADR 0016).
  useEffect(followAccountChanges, []);
  useEffect(() => {
    // The pages look much the same for every account, so a switch says whose they are now.
    const user = getSignedInUser();
    if (user && arrivedBySwitching()) toast(`Switched to ${user.name || user.email}`);
  }, []);
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
