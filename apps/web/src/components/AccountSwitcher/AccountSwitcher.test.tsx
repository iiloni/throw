import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '@/lib/auth';

const ada: Account = { user: { id: 'ada', name: 'Ada', email: 'ada@example.com' }, token: 'a' };
const bob: Account = { user: { id: 'bob', name: '', email: 'bob@example.com' }, token: 'b' };

const mocks = vi.hoisted(() => ({
  accounts: [] as Account[],
  switchAccount: vi.fn(),
  signOutAccount: vi.fn(),
  unsyncedChanges: vi.fn(),
  reorderAccounts: vi.fn(),
  blocked: vi.fn(() => false),
  toast: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({
  getAccounts: () => mocks.accounts,
  getSignedInUser: () => mocks.accounts[0]?.user ?? null,
  reorderAccounts: mocks.reorderAccounts,
}));
vi.mock('@/lib/accounts', () => ({
  switchAccount: mocks.switchAccount,
  signOutAccount: mocks.signOutAccount,
  unsyncedChanges: mocks.unsyncedChanges,
}));
vi.mock('@/lib/useUpdateReloadBlocked', () => ({ isUpdateReloadBlocked: mocks.blocked }));
vi.mock('sonner', () => ({ toast: Object.assign(mocks.toast, { error: vi.fn() }) }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
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

import { AccountSwitcher } from './AccountSwitcher';
import { SignOutAccountHost } from './SignOutAccountHost';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accounts = [ada, bob];
  mocks.blocked.mockReturnValue(false);
  mocks.unsyncedChanges.mockResolvedValue(0);
  mocks.signOutAccount.mockResolvedValue(undefined);
});

function renderSwitcher() {
  return render(
    <>
      <AccountSwitcher expanded />
      <SignOutAccountHost />
    </>,
  );
}

const avatar = () => screen.getByRole('button', { name: 'Account: Ada' });
const openList = () => fireEvent.click(avatar());

describe('AccountSwitcher', () => {
  it('lists the signed-in accounts and marks the one in use', () => {
    renderSwitcher();
    openList();
    expect(screen.getByRole('button', { name: /^Ada\s*ada@example\.com$/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('button', { name: 'bob@example.com' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByRole('link', { name: 'Add account' })).toHaveAttribute('href', '/login');
  });

  it('switches to the account that is picked', () => {
    renderSwitcher();
    openList();
    fireEvent.click(screen.getByRole('button', { name: 'bob@example.com' }));
    expect(mocks.switchAccount).toHaveBeenCalledWith('bob');
  });

  it('does not switch away from an open draft', () => {
    mocks.blocked.mockReturnValue(true);
    renderSwitcher();
    openList();
    fireEvent.click(screen.getByRole('button', { name: 'bob@example.com' }));
    expect(mocks.switchAccount).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(
      'Close the open task or draft before switching accounts.',
    );
  });

  it('asks, then signs another account out and drops it from the list', async () => {
    mocks.signOutAccount.mockImplementation(async () => {
      mocks.accounts = [ada];
    });
    renderSwitcher();
    openList();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out bob@example.com' }));
    expect(await screen.findByRole('dialog', { name: 'Sign out bob@example.com?' })).toBeVisible();
    expect(mocks.signOutAccount).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(mocks.signOutAccount).toHaveBeenCalledWith(bob));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    openList();
    expect(screen.queryByRole('button', { name: 'bob@example.com' })).not.toBeInTheDocument();
  });

  it('keeps the account when signing out is cancelled', async () => {
    renderSwitcher();
    openList();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out bob@example.com' }));
    await screen.findByRole('dialog', { name: 'Sign out bob@example.com?' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.signOutAccount).not.toHaveBeenCalled();
  });

  it('warns about changes that have not synced', async () => {
    mocks.unsyncedChanges.mockResolvedValue(2);
    renderSwitcher();
    openList();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out bob@example.com' }));
    expect(
      await screen.findByText('Signing out deletes 2 changes that have not reached the server.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(mocks.signOutAccount).toHaveBeenCalledWith(bob));
  });

  it('moves an account with the arrow keys and saves the order', () => {
    mocks.reorderAccounts.mockImplementation((ids: string[]) => {
      mocks.accounts = ids.map((id) => (id === 'ada' ? ada : bob));
    });
    renderSwitcher();
    openList();
    const items = () => screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(items()).toEqual(['AAdaada@example.com', 'Bbob@example.com']);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move ada@example.com' }), {
      key: 'ArrowDown',
    });
    expect(mocks.reorderAccounts).toHaveBeenCalledWith(['bob', 'ada']);
    expect(items()).toEqual(['Bbob@example.com', 'AAdaada@example.com']);
    // Already last: nothing to save.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move ada@example.com' }), {
      key: 'ArrowDown',
    });
    expect(mocks.reorderAccounts).toHaveBeenCalledTimes(1);
    expect(mocks.switchAccount).not.toHaveBeenCalled();
  });

  it('offers no reordering with one account', () => {
    mocks.accounts = [ada];
    renderSwitcher();
    openList();
    expect(screen.queryByRole('button', { name: /^Move / })).not.toBeInTheDocument();
  });

  it('switches to the next account with a swipe across the avatar, without opening the list', () => {
    renderSwitcher();
    const button = avatar();
    act(() => {
      fireEvent.pointerDown(button, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(button, { pointerId: 1, clientX: 10, clientY: -20 });
      fireEvent.pointerUp(button, { pointerId: 1, clientX: 10, clientY: -20 });
      fireEvent.click(button);
    });
    expect(mocks.switchAccount).toHaveBeenCalledWith('bob');
    expect(screen.queryByRole('list', { name: 'Accounts' })).not.toBeInTheDocument();
  });

  it('stays on the account when a swipe is let go short of switching', () => {
    renderSwitcher();
    const button = avatar();
    act(() => {
      fireEvent.pointerDown(button, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(button, { pointerId: 1, clientX: 20, clientY: 10 });
      fireEvent.pointerUp(button, { pointerId: 1, clientX: 20, clientY: 10 });
    });
    expect(mocks.switchAccount).not.toHaveBeenCalled();
  });

  it('shows nothing when nobody is signed in', () => {
    mocks.accounts = [];
    const { container } = render(<AccountSwitcher expanded />);
    expect(container).toBeEmptyDOMElement();
  });
});
