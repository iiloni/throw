import { initializeWebUpdates } from './lib/webUpdates';
import '@fontsource-variable/bricolage-grotesque/standard.css';
import '@fontsource-variable/figtree';
import { Capacitor } from '@capacitor/core';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { onAccountNumberChange, routerRewrite } from './lib/auth';
import { isDesktop } from './lib/media';
import { measurePageInset, pageTransition } from './lib/pageTransition';
import { routeTree } from './routeTree.gen';
import './styles.css';

document.documentElement.dataset.platform = Capacitor.getPlatform();

const router = createRouter({
  routeTree,
  // A page of one of several accounts is at `/u/<number>/…` (ADR 0016); routes never say so.
  // Not a `basepath`, which is fixed: reordering the accounts changes the number.
  rewrite: routerRewrite,
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

// A rewrite the router has not seen makes it parse the address again and its links rebuild
// theirs, now with the account's new number.
onAccountNumberChange(() => router.update({ ...router.options, rewrite: { ...routerRewrite } }));

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
