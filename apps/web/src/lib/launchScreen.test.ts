import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: 'android',
  ready: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => mocks.platform },
  registerPlugin: () => ({ ready: mocks.ready }),
}));

// The module remembers whether it has let the launch screen go, as a page load does.
async function load() {
  vi.resetModules();
  return import('./launchScreen');
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.platform = 'android';
  mocks.ready.mockReset().mockResolvedValue(undefined);
});

afterEach(() => vi.useRealTimers());

describe('launch screen', () => {
  it('lets it go once, at the first page that is ready', async () => {
    const { useLaunchScreenReady } = await load();
    const { rerender } = renderHook(({ ready }) => useLaunchScreenReady(ready), {
      initialProps: { ready: false },
    });
    expect(mocks.ready).not.toHaveBeenCalled();
    rerender({ ready: true });
    vi.advanceTimersToNextFrame();
    expect(mocks.ready).not.toHaveBeenCalled();
    vi.advanceTimersToNextFrame();
    expect(mocks.ready).toHaveBeenCalledTimes(1);
    renderHook(() => useLaunchScreenReady(true));
    vi.advanceTimersToNextFrame();
    vi.advanceTimersToNextFrame();
    expect(mocks.ready).toHaveBeenCalledTimes(1);
  });

  it('cancels the pending signal when the route unmounts', async () => {
    const { useLaunchScreenReady } = await load();
    const { unmount } = renderHook(() => useLaunchScreenReady(true));
    vi.advanceTimersToNextFrame();
    unmount();
    vi.advanceTimersToNextFrame();
    expect(mocks.ready).not.toHaveBeenCalled();
  });

  it('does nothing outside Android', async () => {
    mocks.platform = 'web';
    const { launchScreenReady } = await load();
    launchScreenReady();
    expect(mocks.ready).not.toHaveBeenCalled();
  });

  it('tolerates an app without the plugin', async () => {
    mocks.ready.mockRejectedValue(new Error('not implemented'));
    const { launchScreenReady } = await load();
    expect(() => launchScreenReady()).not.toThrow();
    await Promise.resolve();
  });
});
