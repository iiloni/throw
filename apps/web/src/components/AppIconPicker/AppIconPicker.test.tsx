import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_ICON_KEY } from '@/lib/appIcon';
import { AppIconPicker } from './AppIconPicker';

const mocks = vi.hoisted(() => ({
  platform: 'web',
  setIcon: vi.fn().mockResolvedValue(undefined),
  getPreview: vi.fn(),
}));
vi.mock('@/lib/updates', () => ({
  useUpdates: () => ({ android: mocks.platform === 'android', app: null }),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => mocks.platform,
    isNativePlatform: () => mocks.platform !== 'web',
  },
  registerPlugin: () => ({ setIcon: mocks.setIcon, getPreview: mocks.getPreview }),
}));
vi.mock('@/lib/haptics', () => ({ haptics: { selection: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

beforeEach(() => {
  vi.stubEnv('THROW_CHANNEL', 'preview');
  localStorage.clear();
  mocks.platform = 'web';
  mocks.setIcon.mockReset().mockResolvedValue(undefined);
  mocks.getPreview.mockReset().mockResolvedValue({
    dataUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6yFkAAAAASUVORK5CYII=',
  });
});

afterEach(() => vi.unstubAllEnvs());

describe('AppIconPicker', () => {
  it('dev builds offer three text-only choices and preview the selection above them', async () => {
    vi.stubEnv('THROW_CHANNEL', 'dev');
    render(<AppIconPicker />);
    expect(screen.getByRole('button', { name: 'Dev' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: 'Dev app icon' })).toHaveAttribute(
      'src',
      '/dev/pwa-512x512.png',
    );
    for (const button of screen.getAllByRole('button'))
      expect(button.querySelector('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stable' }));
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Stable app icon' })).toHaveAttribute(
        'src',
        '/pwa-512x512.png',
      ),
    );
    expect(screen.getByRole('button', { name: 'Stable' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers no choice on a stable build', () => {
    vi.stubEnv('THROW_CHANNEL', 'stable');
    render(<AppIconPicker />);
    expect(screen.queryByRole('region', { name: 'App icon' })).toBeNull();
  });

  it('preview builds default to preview, save stable, and switch back', async () => {
    render(<AppIconPicker />);
    expect(screen.queryByRole('button', { name: 'Dev' })).toBeNull();
    const stable = screen.getByRole('button', { name: 'Stable' });
    const preview = screen.getByRole('button', { name: 'Preview' });
    expect(preview).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(stable);
    await waitFor(() => expect(stable).toHaveAttribute('aria-pressed', 'true'));
    expect(JSON.parse(localStorage.getItem(APP_ICON_KEY) ?? 'null')).toBe('stable');
    fireEvent.click(preview);
    await waitFor(() => expect(preview).toHaveAttribute('aria-pressed', 'true'));
  });

  it('uses the native launcher rendering on Android', async () => {
    mocks.platform = 'android';
    render(<AppIconPicker />);
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Preview app icon' })).toHaveAttribute(
        'src',
        expect.stringMatching(/^data:image\/png;base64,/),
      ),
    );
    expect(mocks.getPreview).toHaveBeenCalledWith({ icon: 'preview' });
    fireEvent.click(screen.getByRole('button', { name: 'Stable' }));
    await waitFor(() => expect(screen.getByRole('img', { name: 'Stable app icon' })).toBeVisible());
    expect(mocks.setIcon).toHaveBeenCalledWith({ icon: 'stable' });
    expect(mocks.getPreview).toHaveBeenLastCalledWith({ icon: 'stable' });
  });

  it('shows a retry when the native preview fails without showing substitute artwork', async () => {
    mocks.platform = 'android';
    mocks.getPreview.mockRejectedValueOnce(new Error('Preview failed'));
    render(<AppIconPicker />);
    const retry = await screen.findByRole('button', { name: 'Retry preview' });
    expect(screen.queryByRole('img', { name: 'Preview app icon' })).toBeNull();
    fireEvent.click(retry);
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Preview app icon' })).toBeVisible(),
    );
  });

  it('leaves the preference unchanged if the Android launcher rejects the choice', async () => {
    mocks.platform = 'android';
    mocks.setIcon.mockRejectedValueOnce(new Error('Launcher failed'));
    render(<AppIconPicker />);
    fireEvent.click(screen.getByRole('button', { name: 'Stable' }));
    await waitFor(() => expect(mocks.setIcon).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stable' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem(APP_ICON_KEY)).toBeNull();
  });
});
