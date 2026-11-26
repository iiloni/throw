import type { GithubConnection } from '@throw/shared';
import { createContext, useCallback, useEffect, useMemo } from 'react';
import { ApiError, api } from './api';
import { createStore } from './store';

type State =
  | { status: 'loading' | 'unavailable' | 'error' }
  | {
      status: 'ready';
      connection: GithubConnection | null;
      setup?: { secret: string; rotated: boolean };
    };

/** Project settings keeps the one-time setup in memory until dismissed or the project changes. */
export function useGithubConnection(projectId: string | undefined) {
  const project = useMemo(
    () => ({
      state: createStore<State>({ status: projectId ? 'loading' : 'unavailable' }),
      revision: 0,
    }),
    [projectId],
  );
  const state = project.state.use();
  const load = useCallback(
    async (signal: AbortSignal, quiet: boolean) => {
      if (!projectId) return;
      const revision = ++project.revision;
      const timed =
        typeof AbortSignal.any === 'function'
          ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
          : signal;
      try {
        const { connection } = await api.githubConnection(projectId, timed);
        if (signal.aborted || revision !== project.revision) return;
        const current = project.state.get();
        const setup =
          current.status === 'ready' &&
          connection &&
          connection.createdAt === current.connection?.createdAt
            ? current.setup
            : undefined;
        project.state.set({ status: 'ready', connection, setup });
      } catch (error) {
        if (signal.aborted || revision !== project.revision || quiet) return;
        project.state.set({
          status: error instanceof ApiError && error.status === 404 ? 'unavailable' : 'error',
        });
      }
    },
    [project, projectId],
  );

  useEffect(() => {
    if (state.status !== 'loading') return;
    const abort = new AbortController();
    void load(abort.signal, false);
    return () => abort.abort();
  }, [state.status, load]);

  const refresh = useCallback(() => {
    void load(new AbortController().signal, true);
  }, [load]);
  const set = (
    connection: GithubConnection | null,
    setup?: { secret: string; rotated: boolean },
  ) => {
    project.revision++;
    project.state.set({ status: 'ready', connection, setup });
  };
  return {
    state,
    showSecret: (result: { connection: GithubConnection; secret: string }, rotated: boolean) =>
      set(result.connection, { secret: result.secret, rotated }),
    dismissSecret: () => {
      const current = project.state.get();
      if (current.status === 'ready') set(current.connection);
    },
    retry: () => project.state.set({ status: 'loading' }),
    refresh,
    changed: set,
    removed: () => set(null),
  };
}

export const GithubConnectionContext = createContext<ReturnType<typeof useGithubConnection> | null>(
  null,
);
