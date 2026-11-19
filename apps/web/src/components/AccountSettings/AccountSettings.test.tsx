import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  changeAccountName: vi.fn(),
  changePassword: vi.fn(),
  signOut: vi.fn(),
}));
const sync = vi.hoisted(() => ({ pending: 0 }));

vi.mock('@/lib/auth', () => ({
  authClient: { changePassword: auth.changePassword },
  changeAccountName: auth.changeAccountName,
  getSignedInUser: () => ({ id: 'user-1', name: 'Old Name', email: 'old@example.com' }),
}));
vi.mock('@/lib/signOut', () => ({ signOut: auth.signOut }));
vi.mock('@/lib/syncStatus', () => ({ useSyncStatus: () => sync }));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
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

import { ChangeName, ChangePassword, SignOut } from './AccountSettings';

beforeEach(() => {
  for (const mock of Object.values(auth)) mock.mockReset();
  sync.pending = 0;
});

it('rejects a blank name, keeps a failed draft and closes once saved', async () => {
  const onChanged = vi.fn();
  render(<ChangeName name="Old Name" onChanged={onChanged} />);
  fireEvent.click(screen.getByRole('button', { name: 'Change name' }));
  const field = screen.getByLabelText('Name');
  fireEvent.change(field, { target: { value: '   ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a name');
  expect(auth.changeAccountName).not.toHaveBeenCalled();

  auth.changeAccountName.mockResolvedValueOnce({ error: { message: 'Session expired' } });
  fireEvent.change(field, { target: { value: '  New Name ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Session expired');
  expect(screen.getByLabelText('Name')).toHaveValue('  New Name ');

  auth.changeAccountName.mockResolvedValueOnce({ error: null });
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(auth.changeAccountName).toHaveBeenLastCalledWith('New Name');
  expect(onChanged).toHaveBeenCalledOnce();
});

it('checks the new password before sending it and signs other devices out', async () => {
  render(<ChangePassword />);
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-pass' } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'short' } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'short' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
  expect(screen.getByRole('alert')).toHaveTextContent('between 8 and 128');

  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
  expect(screen.getByRole('alert')).toHaveTextContent('do not match');
  expect(auth.changePassword).not.toHaveBeenCalled();

  auth.changePassword.mockResolvedValueOnce({ error: null });
  fireEvent.change(screen.getByLabelText('Confirm new password'), {
    target: { value: 'new-password' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(auth.changePassword).toHaveBeenCalledWith({
    currentPassword: 'old-pass',
    newPassword: 'new-password',
    revokeOtherSessions: true,
  });
});

it('asks before signing out over unsaved changes, and not otherwise', () => {
  sync.pending = 2;
  const view = render(<SignOut />);
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  const dialog = screen.getByRole('dialog', { name: 'Sign out?' });
  expect(dialog).toHaveTextContent('deletes 2 changes');
  expect(auth.signOut).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

  sync.pending = 0;
  view.rerender(<SignOut />);
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(auth.signOut).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeDisabled();
});
