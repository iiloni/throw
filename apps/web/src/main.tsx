import { initializeWebUpdates } from './lib/webUpdates';
import '@fontsource-variable/bricolage-grotesque/standard.css';
import '@fontsource-variable/figtree';
import { Capacitor } from '@capacitor/core';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { isDesktop } from './lib/media';
import { measurePageInset, pageTransition } from './lib/pageTransition';
import { routeTree } from './routeTree.gen';
import './styles.css';

document.documentElement.dataset.platform = Capacitor.getPlatform();

const router = createRouter({
  routeTree,
  // Pages slide in the direction of travel and boards cross-fade (lib/pageTransition.ts, and
  // the view transition styles in styles.css). Without transition types the router would
  // cross-fade every navigation, opening tasks too, so those engines get no page transitions.
  defaultViewTransition: CSS.supports('selector(:active-view-transition-type(a))')
    ? {
        types: ({ fromLocation, toLocation }) => {
          const types = pageTransition(fromLocation, toLocation, isDesktop());
          if (types) measurePageInset();
          return types;
        },
      }
    : false,
});

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
