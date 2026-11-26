import type { GithubConnection } from '@throw/shared';
import { createContext, useCallback, useEffect, useState } from 'react';
import { ApiError, api } from './api';

type State =
  | { status: 'loading' | 'unavailable' | 'error' }
  | { status: 'ready'; connection: GithubConnection | null };

/**
 * A project's GitHub connection (ADR 0017). An older server without the API answers 404 and
 * hides the page; so does having no project to ask about.
 */
export function useGithubConnection(projectId: string | undefined) {
  const [stored, setStored] = useState<{ projectId: string | undefined; state: State }>({
    projectId,
    state: { status: projectId ? 'loading' : 'unavailable' },
  });
  // Another project starts from loading rather than showing the last one's connection.
  const state: State =
    stored.projectId === projectId
      ? stored.state
      : { status: projectId ? 'loading' : 'unavailable' };
  const loading = state.status === 'loading';

  const load = useCallback(
    (signal: AbortSignal, quiet: boolean) => {
      if (!projectId) return;
      const timed =
        typeof AbortSignal.any === 'function'
          ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
          : signal;
      void api.githubConnection(projectId, timed).then(
        ({ connection }) => {
          if (!signal.aborted) setStored({ projectId, state: { status: 'ready', connection } });
        },
        (error: unknown) => {
          // A refresh that fails keeps what the page shows.
          if (signal.aborted || quiet) return;
          setStored({
            projectId,
            state: {
              status: error instanceof ApiError && error.status === 404 ? 'unavailable' : 'error',
            },
          });
        },
      );
    },
    [projectId],
  );

  useEffect(() => {
    if (!loading) return;
    const abort = new AbortController();
    load(abort.signal, false);
    return () => abort.abort();
  }, [loading, load]);

  const refresh = useCallback(() => load(new AbortController().signal, true), [load]);

  const set = (connection: GithubConnection | null) =>
    setStored({ projectId, state: { status: 'ready', connection } });

  return {
    state,
    retry: () => setStored({ projectId, state: { status: 'loading' } }),
    /** Reads the connection again in place, such as to see a delivery GitHub just made. */
    refresh,
    changed: set,
    removed: () => set(null),
  };
}

export const GithubConnectionContext = createContext<ReturnType<typeof useGithubConnection> | null>(
  null,
);
