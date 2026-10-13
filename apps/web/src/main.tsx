import '@fontsource-variable/bricolage-grotesque/standard.css';
import '@fontsource-variable/figtree';
import { Capacitor } from '@capacitor/core';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { routeTree } from './routeTree.gen';
import './styles.css';

document.documentElement.dataset.platform = Capacitor.getPlatform();

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

// The service worker keeps the app's code for offline use. The dev server has none, and the
// Android app bundles its code.
if (import.meta.env.PROD && !Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
    console.warn('The app will not load offline: its service worker did not register.', error);
  });
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
