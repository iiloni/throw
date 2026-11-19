import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { updateSyncStatus } from '@/lib/syncStatus';
import { SyncIndicator } from './SyncIndicator';

const mocks = vi.hoisted(() => ({
  prepare: vi.fn<() => Promise<void>>(),
  endExpiredSession: vi.fn(),
}));
vi.mock('@/lib/leavePage', () => ({
  DraftOpenError: class DraftOpenError extends Error {},
  prepareToLeavePage: mocks.prepare,
}));
vi.mock('@/lib/auth', () => ({ endExpiredSession: mocks.endExpiredSession }));

afterEach(() => {
  updateSyncStatus({
    pending: 0,
    offline: false,
    signedOut: false,
    sharedTab: false,
    incompatibility: null,
  });
  vi.clearAllMocks();
});

it('shows nothing while changes are reaching the server', () => {
  render(<SyncIndicator />);
  expect(screen.queryByRole('status')).toBeNull();
});

it('says how many changes are waiting while offline', () => {
  updateSyncStatus({ offline: true, pending: 2 });
  render(<SyncIndicator />);
  expect(screen.getByRole('status')).toHaveTextContent('Offline · 2 unsaved');
});

it('points to the tab that keeps the outbox', () => {
  updateSyncStatus({ offline: true, sharedTab: true });
  render(<SyncIndicator />);
  expect(screen.getByRole('status')).toHaveTextContent('Offline · use the other tab');
});

it('says which side needs updating when protocols differ', () => {
  updateSyncStatus({ incompatibility: 'client-too-old' });
  render(<SyncIndicator />);
  expect(screen.getByRole('status')).toHaveTextContent('Update the app to sync');
});

it('signs in again once writes are stored, keeping the unsaved count readable', async () => {
  mocks.prepare.mockResolvedValue();
  updateSyncStatus({ signedOut: true, pending: 1 });
  render(<SyncIndicator />);
  expect(screen.getByRole('status')).toHaveTextContent('Signed out · 1 unsaved');
  fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
  await vi.waitFor(() => expect(mocks.endExpiredSession).toHaveBeenCalledOnce());
  expect(mocks.prepare).toHaveBeenCalledOnce();
});

it('stays while a draft is open or writes are still saving, and says why', async () => {
  const { DraftOpenError } = await import('@/lib/leavePage');
  mocks.prepare.mockRejectedValueOnce(new DraftOpenError('Close the open task or draft first.'));
  updateSyncStatus({ signedOut: true });
  render(<SyncIndicator />);
  const button = screen.getByRole('button', { name: 'Sign in again' });
  fireEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent('Close the open task or draft first.');
  expect(button).toBeEnabled();
  mocks.prepare.mockRejectedValueOnce(new Error('timeout'));
  fireEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent('still being saved');
  expect(mocks.endExpiredSession).not.toHaveBeenCalled();
});
