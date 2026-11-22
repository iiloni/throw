import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { WebhookSettingsContext } from '@/lib/webhookSettings';
import { Webhooks } from './Webhooks';

vi.mock('@/lib/api', () => ({ api: {}, ApiError: class extends Error {} }));

const handlers = { retry: vi.fn(), added: vi.fn(), replaced: vi.fn(), removed: vi.fn() };
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
