import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { GithubConnection } from '@throw/shared';
import type { ContextType, ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { GithubConnectionContext } from '@/lib/githubSettings';
import { GithubConnectionSettings } from './GithubConnection';

const api = vi.hoisted(() => ({
  createGithubConnection: vi.fn(),
  updateGithubConnection: vi.fn(),
  deleteGithubConnection: vi.fn(),
  rotateGithubSecret: vi.fn(),
  rotateGithubUrl: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api, ApiError: class extends Error {} }));
vi.mock('@/lib/haptics', () => ({ haptics: { success: vi.fn(), warning: vi.fn() } }));
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
  for (const mock of Object.values(handlers)) mock.mockReset();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

const handlers = { retry: vi.fn(), refresh: vi.fn(), changed: vi.fn(), removed: vi.fn() };
const projectId = '019a0000-0000-7000-8000-00000000000b';
const connection: GithubConnection = {
  projectId,
  workspaceId: '019a0000-0000-7000-8000-00000000000a',
  repository: 'iiloni/throw',
  authMode: 'webhook',
  enabled: true,
  hasToken: false,
  webhookUrl: 'https://throw.example.com/api/integrations/github/webhooks/token',
  createdAt: '2026-11-26T10:00:00.000Z',
  lastDelivery: null,
};

function renderWith(state: NonNullable<ContextType<typeof GithubConnectionContext>>) {
  return render(
    <GithubConnectionContext value={state}>
      <GithubConnectionSettings projectId={projectId} />
    </GithubConnectionContext>,
  );
}

const ready = (value: GithubConnection | null) => ({
  state: { status: 'ready' as const, connection: value },
  ...handlers,
});

test('says an older server has no GitHub integration, offering nothing', () => {
  renderWith({ state: { status: 'unavailable' }, ...handlers });
  expect(screen.getByText('GitHub needs a newer Throw server')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Connect repository' })).not.toBeInTheDocument();
});

test('connects a pasted repository address and shows the URL and secret once', async () => {
  api.createGithubConnection.mockResolvedValue({ secret: 'throw_ghsec_once', connection });
  renderWith(ready(null));
  fireEvent.change(screen.getByLabelText('Repository'), {
    target: { value: 'https://github.com/iiloni/throw.git' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Connect repository' }));
  const dialog = await screen.findByRole('dialog', { name: 'Add the webhook on GitHub' });
  expect(api.createGithubConnection).toHaveBeenCalledWith(projectId, {
    repository: 'iiloni/throw',
    authMode: 'webhook',
  });
  expect(screen.getByLabelText('Secret')).toHaveValue('throw_ghsec_once');
  expect(screen.getByLabelText('Payload URL')).toHaveValue(connection.webhookUrl);
  expect(handlers.changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(handlers.changed).toHaveBeenCalledWith(connection);
  expect(dialog).toHaveTextContent('application/json');
});

test('asks for a token only in token mode, and checks the repository first', async () => {
  renderWith(ready(null));
  expect(screen.queryByLabelText('Personal access token')).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(/Webhook and access token/));
  const token = screen.getByLabelText('Personal access token');
  expect(token).toHaveAttribute('type', 'password');
  fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'not a repo' } });
  fireEvent.submit(token.closest('form')!);
  expect(await screen.findByRole('alert')).toHaveTextContent('owner/name');
  expect(api.createGithubConnection).not.toHaveBeenCalled();
});

test('shows the connection and its last delivery, never a secret or token', () => {
  renderWith(
    ready({
      ...connection,
      authMode: 'token',
      hasToken: true,
      lastDelivery: {
        at: '2026-11-26T10:05:00.000Z',
        id: '72d3162e-cc78-11e3-81ab-4c9367dc0958',
        event: 'push',
        status: 'error',
        detail: 'The delivery is for iiloni/catch, not iiloni/throw.',
      },
    }),
  );
  expect(screen.getByText('iiloni/throw')).toBeInTheDocument();
  expect(screen.getByText('Webhook and access token')).toBeInTheDocument();
  expect(screen.getByLabelText('Payload URL')).toHaveValue(connection.webhookUrl);
  expect(screen.getByRole('status')).toHaveTextContent(/^Refused push/);
  expect(screen.getByText(/not iiloni\/throw/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Secret')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Check for new deliveries' }));
  expect(handlers.refresh).toHaveBeenCalled();
});

test('rotates the secret after confirming and reveals the new one', async () => {
  api.rotateGithubSecret.mockResolvedValue({ secret: 'throw_ghsec_new', connection });
  renderWith(ready(connection));
  fireEvent.click(screen.getByRole('button', { name: 'New secret' }));
  fireEvent.click(screen.getByRole('button', { name: 'Make new secret' }));
  await screen.findByRole('dialog', { name: 'Copy the new secret' });
  expect(screen.getByLabelText('Secret')).toHaveValue('throw_ghsec_new');
  expect(handlers.changed).toHaveBeenCalledWith(connection);
});

test('turns deliveries off and disconnects', async () => {
  api.updateGithubConnection.mockResolvedValue({ connection: { ...connection, enabled: false } });
  api.deleteGithubConnection.mockResolvedValue(new Response(null, { status: 204 }));
  renderWith(ready(connection));
  fireEvent.click(screen.getByRole('switch', { name: 'Receive deliveries' }));
  await waitFor(() =>
    expect(api.updateGithubConnection).toHaveBeenCalledWith(projectId, { enabled: false }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect GitHub' }));
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
  await waitFor(() => expect(handlers.removed).toHaveBeenCalled());
  expect(api.deleteGithubConnection).toHaveBeenCalledWith(projectId);
});

test('edits the repository, and leaving token mode says the token is deleted', async () => {
  api.updateGithubConnection.mockResolvedValue({ connection });
  renderWith(ready({ ...connection, authMode: 'token', hasToken: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Edit GitHub connection' }));
  expect(dialog.getByLabelText('Replace access token')).toHaveValue('');
  fireEvent.click(screen.getByLabelText(/Webhook only/));
  expect(screen.getByText('Saving deletes the stored access token.')).toBeInTheDocument();
  fireEvent.change(dialog.getByLabelText('Repository'), { target: { value: 'iiloni/catch' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(api.updateGithubConnection).toHaveBeenCalledWith(projectId, {
      repository: 'iiloni/catch',
      authMode: 'webhook',
    }),
  );
});
