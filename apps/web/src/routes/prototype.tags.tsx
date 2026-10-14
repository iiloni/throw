import { createFileRoute, redirect } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { getAuthToken } from '@/lib/auth';

const TagsPrototype = import.meta.env.DEV
  ? lazy(() =>
      import('@/components/TagsPrototype/TagsPrototype').then((module) => ({
        default: module.TagsPrototype,
      })),
    )
  : null;
export const Route = createFileRoute('/prototype/tags')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw redirect({ to: '/' });
    if (!getAuthToken()) throw redirect({ to: '/login', search: { redirect: '/prototype/tags' } });
  },
  component: () => <Suspense>{TagsPrototype && <TagsPrototype />}</Suspense>,
});
