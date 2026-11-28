import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Invite } from '@throw/shared';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { inviteState, UserInvites } from './UserInvites';

const adminApi = vi.hoisted(() => ({
  invites: vi.fn(),
  createInvite: vi.fn(),
  deleteInvite: vi.fn(),
}));
vi.mock('@/lib/admin', async (actual) => ({
  ...(await actual<typeof import('@/lib/admin')>()),
  adminApi,
}));
vi.mock('@/lib/serverUrl', () => ({ getServerUrl: () => 'https://throw.example.com' }));
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

const DAY = 86_400_000;
const invite = (id: string, overrides: Partial<Invite> = {}): Invite => ({
  id: `00000000-0000-7000-8000-00000000000${id}`,
  label: '',
  createdAt: new Date(Date.now() - DAY).toISOString(),
  expiresAt: new Date(Date.now() + 6 * DAY).toISOString(),
  usedAt: null,
  usedBy: null,
  ...overrides,
});

const usable = invite('1', { label: 'Sam' });
const used = invite('2', {
  label: 'Ari',
  usedAt: new Date().toISOString(),
  usedBy: { name: 'Ari', email: 'ari@example.com' },
});
const expired = invite('3', { expiresAt: new Date(Date.now() - DAY).toISOString() });
const token = 'a'.repeat(43);

beforeEach(() => {
  for (const mock of Object.values(adminApi)) mock.mockReset();
  adminApi.invites.mockResolvedValue({ invites: [usable, used, expired] });
});

function renderInvites(onAccessDenied = vi.fn()) {
  render(
    <TooltipProvider>
      <UserInvites onAccessDenied={onAccessDenied} />
    </TooltipProvider>,
  );
  return onAccessDenied;
}

test('tells usable, used and expired invites apart', () => {
  const now = Date.now();
  expect(inviteState(usable, now)).toBe('usable');
  expect(inviteState(used, now)).toBe('used');
  expect(inviteState(expired, now)).toBe('expired');
});

test('lists invites with their state and who used them', async () => {
  renderInvites();
  const list = await screen.findByRole('list', { name: 'Invites' });
  const sam = within(list).getByRole('listitem', { name: 'Sam' });
  expect(sam).toHaveTextContent(/Usable until/);
  expect(within(sam).getByRole('button', { name: 'Revoke Sam' })).toBeVisible();
  const ari = within(list).getByRole('listitem', { name: 'Ari' });
  expect(ari).toHaveTextContent(/Used .* by ari@example\.com/);
  expect(within(ari).getByRole('button', { name: 'Remove Ari' })).toBeVisible();
  expect(within(list).getByRole('listitem', { name: 'Invite' })).toHaveTextContent(/Expired/);
});

test('makes a labelled invite and shows its link once', async () => {
  const made = invite('4', { label: 'Kim' });
  adminApi.createInvite.mockResolvedValue({ invite: made, token });
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText }, share: undefined });
  renderInvites();
  fireEvent.click(await screen.findByRole('button', { name: 'Create invite' }));
  const form = screen.getByRole('dialog', { name: 'Create invite' });
  fireEvent.change(within(form).getByLabelText('Who is it for?'), { target: { value: ' Kim ' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Create invite' }));
  const dialog = await screen.findByRole('dialog', { name: 'Copy the invite link' });
  const link = `https://throw.example.com/login#invite=${token}`;
  expect(adminApi.createInvite).toHaveBeenCalledWith({ label: 'Kim' });
  expect(within(dialog).getByLabelText('Invite link')).toHaveValue(link);
  expect(within(dialog).queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(link));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('listitem', { name: 'Kim' })).toHaveTextContent(/Usable until/);
  expect(screen.queryByDisplayValue(link)).not.toBeInTheDocument();
  vi.unstubAllGlobals();
});

test('says when there are too many usable invites', async () => {
  adminApi.createInvite.mockRejectedValue(new AdminRequestError(409, 'Too many'));
  renderInvites();
  fireEvent.click(await screen.findByRole('button', { name: 'Create invite' }));
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Create invite' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(/too many usable invites/);
});

test('revokes an invite', async () => {
  adminApi.deleteInvite.mockResolvedValue({ ok: true });
  renderInvites();
  fireEvent.click(await screen.findByRole('button', { name: 'Revoke Sam' }));
  await waitFor(() =>
    expect(screen.queryByRole('listitem', { name: 'Sam' })).not.toBeInTheDocument(),
  );
  expect(adminApi.deleteInvite).toHaveBeenCalledWith(usable.id);
});

test('stays out of the way on a server without invites', async () => {
  adminApi.invites.mockRejectedValue(new AdminRequestError(404, 'Not found'));
  renderInvites();
  await waitFor(() => expect(screen.queryByText('Invites')).not.toBeInTheDocument());
});

test('leaves when the server turns this admin away', async () => {
  adminApi.invites.mockRejectedValue(new AdminRequestError(403, 'Admin access required'));
  const onAccessDenied = renderInvites();
  await waitFor(() => expect(onAccessDenied).toHaveBeenCalled());
});
