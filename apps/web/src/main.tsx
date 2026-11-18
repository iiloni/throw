import { initializeWebUpdates } from './lib/webUpdates';
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

initializeWebUpdates();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
