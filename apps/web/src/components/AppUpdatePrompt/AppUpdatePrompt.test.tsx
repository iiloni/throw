import { fireEvent, render, screen } from '@testing-library/react';
import { androidUpdateAvailable } from '@throw/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateSyncStatus } from '@/lib/syncStatus';
import { useAndroidUpdateAvailable, useUpdates } from '@/lib/updates';
import { holdUpdateReload } from '@/lib/useUpdateReloadBlocked';
import { AppUpdatePrompt } from './AppUpdatePrompt';

vi.mock('@/lib/updates', () => ({ useUpdates: vi.fn(), useAndroidUpdateAvailable: vi.fn() }));
const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useRouterState: () => '/',
}));

let state: ReturnType<typeof useUpdates>;
beforeEach(() => {
  localStorage.clear();
  navigate.mockClear();
  updateSyncStatus({ incompatibility: null });
  state = {
    android: true,
    app: { version: '1.0.0', channel: 'stable' },
    server: { version: '1.1.0', channel: 'stable' },
    checking: false,
    error: null,
    installing: false,
    installError: null,
  };
  vi.mocked(useUpdates).mockImplementation(() => state);
  vi.mocked(useAndroidUpdateAvailable).mockImplementation(
    () => state.android && androidUpdateAvailable(state.app, state.server),
  );
});

describe('Android update prompt', () => {
  it.each(['equal', 'ahead', 'different channel', 'dev', 'web'])(
    'does not prompt for %s',
    (scenario) => {
      if (scenario === 'equal') state.app = state.server;
      if (scenario === 'ahead') state.app = { version: '2.0.0', channel: 'stable' };
      if (scenario === 'different channel')
        state.server = { version: '1.1.0-preview', channel: 'preview' };
      if (scenario === 'dev') state.app = { version: '0.0.0-dev', channel: 'dev' };
      if (scenario === 'web') state.android = false;
      render(<AppUpdatePrompt />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    },
  );

  it('remembers optional dismissal but explains a newly required protocol update', () => {
    const { rerender } = render(<AppUpdatePrompt />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Throw 1.1.0');
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    updateSyncStatus({ incompatibility: 'client-too-old' });
    rerender(<AppUpdatePrompt />);
    expect(screen.getByRole('dialog', { name: 'Update required to sync' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep working offline' })).toBeInTheDocument();
  });

  it('takes the user to the update in Settings', () => {
    render(<AppUpdatePrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Go to Update' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/settings', hash: 'updates' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('waits while a draft holds the reload', () => {
    const release = holdUpdateReload();
    const { rerender } = render(<AppUpdatePrompt />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    release();
    rerender(<AppUpdatePrompt />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
