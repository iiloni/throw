import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateSyncStatus } from '@/lib/syncStatus';
import { holdUpdateReload } from '@/lib/useUpdateReloadBlocked';
import { reloadForWebUpdate, useWebUpdates } from '@/lib/webUpdates';
import { WebUpdatePrompt } from './WebUpdatePrompt';

vi.mock('@/lib/webUpdates', () => ({ useWebUpdates: vi.fn(), reloadForWebUpdate: vi.fn() }));

beforeEach(() => {
  vi.mocked(reloadForWebUpdate).mockClear();
  updateSyncStatus({ incompatibility: null });
  vi.mocked(useWebUpdates).mockReturnValue({ target: 'build-2', reloading: false, error: null });
});

describe('web update prompt', () => {
  it('offers a new build and reloads into it', () => {
    render(<WebUpdatePrompt />);
    expect(screen.getByRole('dialog', { name: 'App update available' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload to update' }));
    expect(reloadForWebUpdate).toHaveBeenCalled();
  });

  it('stays dismissed for that build, but explains a required update', () => {
    const { rerender } = render(<WebUpdatePrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => updateSyncStatus({ incompatibility: 'client-too-old' }));
    rerender(<WebUpdatePrompt />);
    expect(screen.getByRole('dialog', { name: 'Update required to sync' })).toBeInTheDocument();
  });

  it('cannot be dismissed while the reload is being prepared', () => {
    vi.mocked(useWebUpdates).mockReturnValue({ target: 'build-2', reloading: true, error: null });
    render(<WebUpdatePrompt />);
    expect(screen.getByRole('button', { name: 'Preparing update…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Later' })).toBeDisabled();
  });

  it('waits while a draft holds the reload', () => {
    const release = holdUpdateReload();
    const { rerender } = render(<WebUpdatePrompt />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(release);
    rerender(<WebUpdatePrompt />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
