import type { McpToken, McpTokensResponse } from '@throw/shared';
import { createContext, useEffect, useState } from 'react';
import { ApiError, api } from './api';

type State =
  | { status: 'loading' | 'unavailable' | 'error' }
  | { status: 'ready'; inventory: McpTokensResponse };

export function useMcpSettings() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    if (state.status !== 'loading') return;
    const abort = new AbortController();
    const signal =
      typeof AbortSignal.any === 'function'
        ? AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)])
        : abort.signal;
    void api.mcpTokens(signal).then(
      (inventory) => {
        if (!abort.signal.aborted) setState({ status: 'ready', inventory });
      },
      (error: unknown) => {
        if (abort.signal.aborted) return;
        setState({
          status: error instanceof ApiError && error.status === 404 ? 'unavailable' : 'error',
        });
      },
    );
    return () => abort.abort();
  }, [state.status]);

  function retry() {
    setState({ status: 'loading' });
  }

  function added(token: McpToken) {
    setState((current) =>
      current.status === 'ready'
        ? {
            ...current,
            inventory: { ...current.inventory, tokens: [...current.inventory.tokens, token] },
          }
        : current,
    );
  }

  function removed(id: string) {
    setState((current) =>
      current.status === 'ready'
        ? {
            ...current,
            inventory: {
              ...current.inventory,
              tokens: current.inventory.tokens.filter((token) => token.id !== id),
            },
          }
        : current,
    );
  }

  return { state, retry, added, removed };
}

export const McpSettingsContext = createContext<ReturnType<typeof useMcpSettings> | null>(null);
