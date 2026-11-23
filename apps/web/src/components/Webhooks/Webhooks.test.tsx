import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Webhook, WebhooksResponse } from '@throw/shared';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { WebhookSettingsContext } from '@/lib/webhookSettings';
import { Webhooks } from './Webhooks';

const api = vi.hoisted(() => ({ createWebhook: vi.fn(), updateWebhook: vi.fn() }));
vi.mock('@/lib/api', () => ({ api, ApiError: class extends Error {} }));
vi.mock('@/components/ManagementSurface/ManagementSurface', () => ({
  ManagementSurface: ({
    open,
    title,
    children,
  }: {
    open: boolean;
    title: string;
    children: ReactNode;
  }) =>
    open && (
      <section role="dialog" aria-label={title}>
        {children}
      </section>
    ),
}));

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  // The Switch measures itself.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

const handlers = { retry: vi.fn(), added: vi.fn(), replaced: vi.fn(), removed: vi.fn() };
const hookId = '019a0000-0000-7000-8000-000000000001';
const agent: Webhook = {
  id: hookId,
  workspaceId: '019a0000-0000-7000-8000-00000000000a',
  projectId: null,
  name: 'Agent',
  url: 'https://hooks.example.com/throw',
  ignoreTokenWrites: true,
  enabled: true,
  quietWindowSeconds: 0,
  createdAt: '2026-11-22T10:00:00.000Z',
  lastDeliveryAt: null,
  lastDeliveryStatus: null,
  lastResponseStatus: null,
  lastError: null,
};

function renderReady(inventory: Partial<WebhooksResponse>) {
  return render(
    <WebhookSettingsContext
      value={{
        state: {
          status: 'ready',
          inventory: {
            webhooks: [],
            quietWindow: true,
            workspaces: [{ id: agent.workspaceId, name: 'Personal', projects: [] }],
            ...inventory,
          },
        },
        ...handlers,
      }}
    >
      <Webhooks />
    </WebhookSettingsContext>,
  );
}
const workspaceId = '019a0000-0000-7000-8000-00000000000a';
const projectId = '019a0000-0000-7000-8000-00000000000b';

test('shows the server requirement without offering webhook actions on an older server', () => {
  render(
    <WebhookSettingsContext value={{ state: { status: 'unavailable' }, ...handlers }}>
      <Webhooks />
    </WebhookSettingsContext>,
  );
  expect(screen.getByText('Webhooks require a newer Throw server')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Create webhook' })).not.toBeInTheDocument();
});

test('lists each webhook with its scope and last delivery, never its secret', () => {
  const base = {
    workspaceId,
    url: 'https://hooks.example.com/throw',
    ignoreTokenWrites: true,
    enabled: true,
    quietWindowSeconds: 0,
    createdAt: '2026-11-22T10:00:00.000Z',
    lastResponseStatus: 500,
    lastDeliveryStatus: 'error' as const,
    lastDeliveryAt: '2026-11-22T10:05:00.000Z',
    lastError: 'The receiver answered HTTP 500',
  };
  render(
    <WebhookSettingsContext
      value={{
        state: {
          status: 'ready',
          inventory: {
            webhooks: [
              { ...base, id: '019a0000-0000-7000-8000-000000000001', name: 'Agent', projectId },
              {
                ...base,
                id: '019a0000-0000-7000-8000-000000000002',
                name: 'Left behind',
                workspaceId: '019a0000-0000-7000-8000-00000000000c',
                projectId: null,
              },
            ],
            quietWindow: true,
            workspaces: [
              {
                id: workspaceId,
                name: 'Personal',
                projects: [{ id: projectId, name: 'Throw', key: 'THR' }],
              },
            ],
          },
        },
        ...handlers,
      }}
    >
      <Webhooks />
    </WebhookSettingsContext>,
  );
  expect(screen.getByText(/^Personal · Throw · Failed .*HTTP 500$/)).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: 'Deliver to Agent' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Edit Agent' })).toBeInTheDocument();
  expect(screen.getByText('Workspace access ended')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Delete Left behind' })).toBeInTheDocument();
  expect(screen.queryByRole('switch', { name: 'Deliver to Left behind' })).not.toBeInTheDocument();
});

test("names a webhook's quiet window on its row", () => {
  renderReady({
    webhooks: [
      { ...agent, quietWindowSeconds: 120 },
      { ...agent, id: '019a0000-0000-7000-8000-000000000002', name: 'Now', quietWindowSeconds: 0 },
      {
        ...agent,
        id: '019a0000-0000-7000-8000-000000000003',
        name: 'Paused',
        quietWindowSeconds: 30,
        enabled: false,
      },
    ],
  });
  expect(
    screen.getByText('Personal · All projects · 2 minutes quiet window · No deliveries yet'),
  ).toBeInTheDocument();
  expect(screen.getByText('Personal · All projects · No deliveries yet')).toBeInTheDocument();
  expect(screen.getByText('Personal · All projects · Off')).toBeInTheDocument();
});

test('creates a webhook with a quiet window', async () => {
  api.createWebhook.mockResolvedValue({
    secret: 'throw_whsec_x',
    webhook: { ...agent, quietWindowSeconds: 60 },
  });
  renderReady({});
  fireEvent.click(screen.getByRole('button', { name: 'Create webhook' }));
  const form = screen.getByRole('dialog', { name: 'Create webhook' });
  const quiet = screen.getByLabelText('Quiet window');
  expect(quiet).toHaveValue('0');
  expect(screen.getByText('Sends a notice for every change as it happens.')).toBeInTheDocument();
  expect(
    [...form.querySelectorAll('option')].map((option) => option.textContent).slice(-6),
  ).toEqual([
    'Send at once',
    'Wait 30 seconds',
    'Wait 1 minute',
    'Wait 2 minutes',
    'Wait 5 minutes',
    'Wait 10 minutes',
  ]);
  fireEvent.change(quiet, { target: { value: '60' } });
  expect(screen.getByText(/new tasks nobody has named, send nothing/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Agent' } });
  fireEvent.change(screen.getByLabelText('Receiver URL'), {
    target: { value: 'https://hooks.example.com/throw' },
  });
  fireEvent.click(screen.getAllByRole('button', { name: 'Create webhook' }).at(-1)!);
  await waitFor(() => expect(api.createWebhook).toHaveBeenCalled());
  expect(api.createWebhook.mock.calls[0]![0]).toMatchObject({ quietWindowSeconds: 60 });
  expect(handlers.added).toHaveBeenCalledWith({ ...agent, quietWindowSeconds: 60 });
});

test('leaves the quiet window out for a server that does not support it', async () => {
  api.createWebhook.mockResolvedValue({ secret: 'throw_whsec_x', webhook: agent });
  renderReady({ quietWindow: false, webhooks: [agent] });
  fireEvent.click(screen.getByRole('button', { name: 'Edit Agent' }));
  expect(screen.queryByLabelText('Quiet window')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));

  fireEvent.click(screen.getByRole('button', { name: 'Create webhook' }));
  expect(screen.queryByLabelText('Quiet window')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Agent' } });
  fireEvent.change(screen.getByLabelText('Receiver URL'), {
    target: { value: 'https://hooks.example.com/throw' },
  });
  fireEvent.click(screen.getAllByRole('button', { name: 'Create webhook' }).at(-1)!);
  await waitFor(() => expect(api.createWebhook).toHaveBeenCalled());
  expect(api.createWebhook.mock.calls[0]![0]).not.toHaveProperty('quietWindowSeconds');
});

test('saves only a changed quiet window, and offers one set elsewhere', async () => {
  api.updateWebhook.mockResolvedValue({ webhook: { ...agent, quietWindowSeconds: 0 } });
  renderReady({ webhooks: [{ ...agent, quietWindowSeconds: 45 }] });
  fireEvent.click(screen.getByRole('button', { name: 'Edit Agent' }));
  const quiet = screen.getByLabelText('Quiet window');
  expect(quiet).toHaveValue('45');
  expect(screen.getByRole('option', { name: 'Wait 45 seconds' })).toBeInTheDocument();
  fireEvent.change(quiet, { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.updateWebhook).toHaveBeenCalled());
  expect(api.updateWebhook).toHaveBeenCalledWith(hookId, { quietWindowSeconds: 0 });
  expect(handlers.replaced).toHaveBeenCalledWith({ ...agent, quietWindowSeconds: 0 });
});
