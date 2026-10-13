import { createFileRoute, redirect } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';

// A design prototype on mock data. The import sits behind a build-time constant, so a
// production build contains neither the route's code nor a way to reach it.
const BoardPrototype = import.meta.env.DEV
  ? lazy(() =>
      import('@/components/Board/BoardPrototype').then((module) => ({
        default: module.BoardPrototype,
      })),
    )
  : null;

export const Route = createFileRoute('/prototype/board')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw redirect({ to: '/' });
  },
  component: () => <Suspense>{BoardPrototype && <BoardPrototype />}</Suspense>,
});
