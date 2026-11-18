import { fireEvent, render, screen } from '@testing-library/react';
import { androidUpdateAvailable } from '@throw/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateSyncStatus } from '@/lib/syncStatus';
import { useAndroidUpdateAvailable, useUpdates } from '@/lib/updates';
import { reloadForWebUpdate, useWebUpdates } from '@/lib/webUpdates';
import { AppUpdate } from './AppUpdate';

vi.mock('@/lib/updates', () => ({
  useUpdates: vi.fn(),
  useAndroidUpdateAvailable: vi.fn(),
  checkForUpdates: vi.fn(),
  installServerVersion: vi.fn(),
}));
vi.mock('@/lib/webUpdates', () => ({ useWebUpdates: vi.fn(), reloadForWebUpdate: vi.fn() }));
vi.mock('@/lib/api', () => ({
  api: { releases: vi.fn().mockResolvedValue({ channel: 'stable', releases: [] }) },
}));
vi.mock('@/lib/theme', () => ({ useResolvedTheme: () => 'light' }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouterState: () => '/',
}));
let state: ReturnType<typeof useUpdates>;
beforeEach(() => {
  localStorage.clear();
  updateSyncStatus({ incompatibility: null });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
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
  vi.mocked(useWebUpdates).mockReturnValue({ target: null, reloading: false, error: null });
});
describe('update settings', () => {
  it('keeps web reload available in Settings after prompt dismissal', async () => {
    state.android = false;
    vi.mocked(useWebUpdates).mockReturnValue({
      target: 'new-build',
      reloading: false,
      error: null,
    });
    render(<AppUpdate />);
    fireEvent.click(screen.getByRole('button', { name: 'Reload to update' }));
    expect(reloadForWebUpdate).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'GitHub repository' })).toHaveAttribute(
      'href',
      'https://github.com/iiloni/throw',
    );
    await screen.findByText('No releases in this channel yet.');
  });
});
