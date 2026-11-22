import { Capacitor, registerPlugin } from '@capacitor/core';
import { useEffect } from 'react';
import { afterPaint } from './motion';

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** The page signals readiness after its first content renders. */
    holdsLaunchScreen?: boolean;
  }
}

const LaunchScreen = registerPlugin<{ ready(): Promise<void> }>('LaunchScreen');
let launching = Capacitor.getPlatform() === 'android';

/** Releases this document's native splash. Older builds still dismiss it on their own. */
export function launchScreenReady() {
  if (!launching) return;
  launching = false;
  void LaunchScreen.ready().catch(() => {});
}

/** Waits for a committed frame, and cancels if the route leaves or goes back to loading. */
export function useLaunchScreenReady(ready: boolean) {
  useEffect(() => {
    if (ready && launching) return afterPaint(launchScreenReady);
  }, [ready]);
}
