import { render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { updateSyncStatus } from '@/lib/syncStatus';
import { SyncIndicator } from './SyncIndicator';

afterEach(() =>
  updateSyncStatus({ pending: 0, offline: false, signedOut: false, incompatibility: null }),
);

it('shows nothing while changes are reaching the server', () => {
  render(<SyncIndicator />);
  expect(screen.queryByRole('status')).toBeNull();
});

it('says how many changes are waiting while offline', () => {
  updateSyncStatus({ offline: true, pending: 2 });
  render(<SyncIndicator />);
  expect(screen.getByRole('status')).toHaveTextContent('Offline · 2 unsaved');
});

it('says which side needs updating when protocols differ', () => {
  updateSyncStatus({ incompatibility: 'client-too-old' });
  render(<SyncIndicator />);
  expect(screen.getByRole('status')).toHaveTextContent('Update the app to sync');
});
