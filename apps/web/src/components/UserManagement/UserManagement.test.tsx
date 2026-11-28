import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AdminUser } from '@throw/shared';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { UserManagement } from './UserManagement';

const adminApi = vi.hoisted(() => ({
  users: vi.fn(),
  setRole: vi.fn(),
  resetPassword: vi.fn(),
  deleteUser: vi.fn(),
}));
vi.mock('@/lib/admin', async (actual) => ({
  ...(await actual<typeof import('@/lib/admin')>()),
  adminApi,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
vi.mock('@/lib/haptics', () => ({
  haptics: { success: vi.fn(), warning: vi.fn(), selection: vi.fn() },
}));
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

const { AdminRequestError } = await import('@/lib/admin');

const person = (id: string, overrides: Partial<AdminUser> = {}): AdminUser => ({
  id,
  name: id.toUpperCase(),
  email: `${id}@example.com`,
  role: 'user',
  createdAt: '2026-11-01T10:00:00.000Z',
  lastLoginAt: '2026-11-20T10:00:00.000Z',
  ...overrides,
});

const me = person('me', { name: 'Me', role: 'admin' });
const bea = person('bea', { name: 'Bea', lastLoginAt: null });

beforeEach(() => {
  for (const mock of Object.values(adminApi)) mock.mockReset();
  adminApi.users.mockResolvedValue({ users: [me, bea], total: 2 });
});

function renderPage(onAccessDenied = vi.fn()) {
  render(
    <TooltipProvider>
      <UserManagement currentUserId="me" onAccessDenied={onAccessDenied} />
    </TooltipProvider>,
  );
  return onAccessDenied;
}

async function open(email: string, item: string) {
  fireEvent.keyDown(await screen.findByRole('button', { name: `Manage ${email}` }), {
    key: 'Enter',
  });
  fireEvent.click(await screen.findByRole('menuitem', { name: item }));
}

test('lists every account with its role and last sign-in, and keeps the admin off their own', async () => {
  renderPage();
  const list = await screen.findByRole('list', { name: 'Users' });
  const self = within(list).getByRole('listitem', { name: 'me@example.com' });
  expect(within(self).getByText('You')).toBeInTheDocument();
  expect(within(self).getByText('Admin')).toBeInTheDocument();
  expect(within(self).queryByRole('button', { name: /^Manage/ })).not.toBeInTheDocument();
  const other = within(list).getByRole('listitem', { name: 'bea@example.com' });
  expect(within(other).getByText('User')).toBeInTheDocument();
  expect(within(other).getByText(/^Last sign-in/)).toHaveTextContent('Last sign-in —never');
  expect(within(other).getByRole('button', { name: 'Manage bea@example.com' })).toBeVisible();
  expect(adminApi.users).toHaveBeenCalledWith(
    { search: '', offset: 0, limit: 25 },
    expect.any(AbortSignal),
  );
});

test('searches by name or email once typing pauses', async () => {
  renderPage();
  await screen.findByRole('list', { name: 'Users' });
  adminApi.users.mockResolvedValue({ users: [], total: 0 });
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search users' }), {
    target: { value: 'nobody' },
  });
  expect(await screen.findByText('No accounts match this search.')).toBeInTheDocument();
  expect(adminApi.users).toHaveBeenLastCalledWith(
    { search: 'nobody', offset: 0, limit: 25 },
    expect.any(AbortSignal),
  );
});

test('asks before making someone an admin', async () => {
  adminApi.setRole.mockResolvedValue({ ...bea, role: 'admin' });
  renderPage();
  await open('bea@example.com', 'Make admin');
  const dialog = screen.getByRole('dialog', { name: 'Make Bea an admin?' });
  expect(adminApi.setRole).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Make admin' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(adminApi.setRole).toHaveBeenCalledWith('bea', 'admin');
  const row = screen.getByRole('listitem', { name: 'bea@example.com' });
  expect(within(row).getByText('Admin')).toBeInTheDocument();
});

test('shows a reset password once, to copy', async () => {
  adminApi.resetPassword.mockResolvedValue({ temporaryPassword: 'temporary-secret' });
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  renderPage();
  await open('bea@example.com', 'Reset password');
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Reset password?' })).getByRole('button', {
      name: 'Reset password',
    }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Temporary password' });
  expect(within(dialog).getByLabelText('Temporary password')).toHaveValue('temporary-secret');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Copy password' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('temporary-secret'));
  expect(within(dialog).getByRole('button', { name: 'Copied' })).toBeVisible();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  vi.unstubAllGlobals();
});

test('deletes an account after confirming and reloads the list', async () => {
  adminApi.deleteUser.mockResolvedValue({ ok: true });
  renderPage();
  await open('bea@example.com', 'Delete user');
  const dialog = screen.getByRole('dialog', { name: 'Delete user?' });
  expect(dialog).toHaveTextContent('This cannot be undone.');
  adminApi.users.mockResolvedValue({ users: [me], total: 1 });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete user' }));
  await waitFor(() =>
    expect(screen.queryByRole('listitem', { name: 'bea@example.com' })).not.toBeInTheDocument(),
  );
  expect(adminApi.deleteUser).toHaveBeenCalledWith('bea');
});

test('keeps the dialog open with the server’s reason when an action is refused', async () => {
  adminApi.deleteUser.mockRejectedValue(new AdminRequestError(404, 'User not found'));
  renderPage();
  await open('bea@example.com', 'Delete user');
  fireEvent.click(screen.getByRole('button', { name: 'Delete user' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('User not found');
  expect(screen.getByRole('dialog', { name: 'Delete user?' })).toBeInTheDocument();
});

test('leaves when the server no longer takes this account for an admin', async () => {
  adminApi.users.mockRejectedValue(new AdminRequestError(403, 'Admin access required'));
  const onAccessDenied = renderPage();
  await waitFor(() => expect(onAccessDenied).toHaveBeenCalled());
});
