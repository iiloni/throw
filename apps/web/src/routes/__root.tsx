import {
  createRootRoute,
  type ErrorComponentProps,
  Outlet,
  useRouterState,
} from '@tanstack/react-router';
import { MotionConfig } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useApplyAppIcon } from '@/lib/appIcon';
import { useBackButton } from '@/lib/backButton';
import { useKeyboardTracking } from '@/lib/keyboard';
import { useLaunchScreenReady } from '@/lib/launchScreen';
import { useSystemBarsStyle } from '@/lib/systemBars';
import { useApplyTheme } from '@/lib/theme';

export const Route = createRootRoute({
  component: Root,
  errorComponent: RootError,
});

function RootError({ error, reset }: ErrorComponentProps) {
  useLaunchScreenReady(true);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-4 text-center">
      <h1 className="font-bold text-2xl">Something went wrong</h1>
      <p className="max-w-md text-muted-foreground text-sm">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}

// Toasts drop in at the top, clear of the status bar.
const toastOffset = { top: 'calc(var(--safe-top) + 0.5rem)' };

function Root() {
  useApplyTheme();
  useApplyAppIcon();
  useBackButton();
  useSystemBarsStyle();
  useKeyboardTracking();
  const launchReady = useRouterState({
    select: (state) =>
      state.status === 'idle' &&
      state.resolvedLocation !== undefined &&
      !state.matches.some((match) => match.staticData.holdsLaunchScreen),
  });
  useLaunchScreenReady(launchReady);
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <Outlet />
        <Toaster position="top-center" offset={toastOffset} mobileOffset={toastOffset} />
      </TooltipProvider>
    </MotionConfig>
  );
}
