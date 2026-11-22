import type { Webhook, WebhooksResponse } from '@throw/shared';
import { createContext, useEffect, useState } from 'react';
import { ApiError, api } from './api';

type State =
  | { status: 'loading' | 'unavailable' | 'error' }
  | { status: 'ready'; inventory: WebhooksResponse };

/** The account's webhooks. An older server without the API answers 404 and hides the page. */
export function useWebhookSettings() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    if (state.status !== 'loading') return;
    const abort = new AbortController();
    const signal =
      typeof AbortSignal.any === 'function'
        ? AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)])
        : abort.signal;
    void api.webhooks(signal).then(
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

  const change = (update: (webhooks: Webhook[]) => Webhook[]) =>
    setState((current) =>
      current.status === 'ready'
        ? {
            ...current,
            inventory: { ...current.inventory, webhooks: update(current.inventory.webhooks) },
          }
        : current,
    );

  return {
    state,
    retry: () => setState({ status: 'loading' }),
    added: (webhook: Webhook) => change((webhooks) => [...webhooks, webhook]),
    replaced: (webhook: Webhook) =>
      change((webhooks) => webhooks.map((item) => (item.id === webhook.id ? webhook : item))),
    removed: (id: string) => change((webhooks) => webhooks.filter((item) => item.id !== id)),
  };
}

export const WebhookSettingsContext = createContext<ReturnType<typeof useWebhookSettings> | null>(
  null,
);

const errorBody = (message: string) => {
  try {
    const parsed: unknown = JSON.parse(message);
    return typeof parsed === 'object' && parsed !== null && 'error' in parsed
      ? String(parsed.error)
      : null;
  } catch {
    return null;
  }
};

/** The server's reason for refusing a webhook, such as a URL it will not deliver to. */
export function webhookErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError && error.status === 400)
    return errorBody(error.message) ?? fallback;
  return fallback;
}
