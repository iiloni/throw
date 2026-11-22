import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: 'web',
  appChannel: null as 'stable' | 'preview' | 'dev' | null,
  setIcon: vi.fn().mockResolvedValue(undefined),
  toastError: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => mocks.platform },
  registerPlugin: () => ({ setIcon: mocks.setIcon }),
}));
vi.mock('./updates', () => ({
  useUpdates: () => ({
    android: mocks.platform === 'android',
    app: mocks.appChannel ? { channel: mocks.appChannel } : null,
  }),
}));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));

import {
  APP_ICON_KEY,
  appIconChoices,
  setNativeAppIcon,
  useAppIconPreference,
  useApplyAppIcon,
} from './appIcon';

const href = (selector: string, index = 0) =>
  document.querySelectorAll(selector)[index]?.getAttribute('href');

beforeEach(() => {
  vi.stubEnv('THROW_CHANNEL', 'dev');
  localStorage.clear();
  mocks.platform = 'web';
  mocks.appChannel = null;
  mocks.setIcon.mockReset().mockResolvedValue(undefined);
  mocks.toastError.mockReset();
  document.head.insertAdjacentHTML(
    'beforeend',
    '<link rel="icon" href="/dev/favicon.ico"><link rel="icon" href="/dev/favicon-mark.svg"><link rel="apple-touch-icon" href="/dev/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest">',
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const link of document.head.querySelectorAll('link')) link.remove();
});

describe('app icon choices', () => {
  it('offer a build its own channel and the channels it comes before', () => {
    expect(appIconChoices('stable')).toEqual(['stable']);
    expect(appIconChoices('preview')).toEqual(['stable', 'preview']);
    expect(appIconChoices('dev')).toEqual(['stable', 'preview', 'dev']);
  });
});

describe('app icon preference', () => {
  it.each(['stable', 'preview', 'dev'] as const)(
    'a %s build defaults to its own icon',
    (channel) => {
      vi.stubEnv('THROW_CHANNEL', channel);
      expect(renderHook(useAppIconPreference).result.current.icon).toBe(channel);
    },
  );

  it('keeps a choice after remount and ignores corrupt values', () => {
    const hook = renderHook(useAppIconPreference);
    act(() => hook.result.current.setIcon('preview'));
    hook.unmount();
    expect(renderHook(useAppIconPreference).result.current.icon).toBe('preview');
    localStorage.setItem(APP_ICON_KEY, 'invalid');
    expect(renderHook(useAppIconPreference).result.current.icon).toBe('dev');
  });

  it('a released build ignores a choice it does not offer', () => {
    vi.stubEnv('THROW_CHANNEL', 'preview');
    localStorage.setItem(APP_ICON_KEY, JSON.stringify('dev'));
    expect(renderHook(useAppIconPreference).result.current.icon).toBe('preview');
    vi.stubEnv('THROW_CHANNEL', 'stable');
    localStorage.setItem(APP_ICON_KEY, JSON.stringify('preview'));
    expect(renderHook(useAppIconPreference).result.current.icon).toBe('stable');
  });

  it("follows the installed Android app's channel over the web build's", () => {
    mocks.platform = 'android';
    mocks.appChannel = 'preview';
    const hook = renderHook(useAppIconPreference);
    expect(hook.result.current.icon).toBe('preview');
    expect(hook.result.current.choices).toEqual(['stable', 'preview']);
  });
});

describe('applying the app icon', () => {
  it('points every browser icon and the install manifest at the choice', () => {
    const preference = renderHook(useAppIconPreference);
    const applied = renderHook(useApplyAppIcon);
    expect(href('link[rel="icon"]')).toBe('/dev/favicon.ico');
    expect(href('link[rel="manifest"]')).toBe('/manifest-dev.webmanifest');
    act(() => preference.result.current.setIcon('preview'));
    expect(href('link[rel="icon"]')).toBe('/preview/favicon.ico');
    expect(href('link[rel="icon"]', 1)).toBe('/preview/favicon-mark.svg');
    expect(href('link[rel="apple-touch-icon"]')).toBe('/preview/apple-touch-icon.png');
    expect(href('link[rel="manifest"]')).toBe('/manifest-preview.webmanifest');
    act(() => preference.result.current.setIcon('stable'));
    expect(href('link[rel="icon"]')).toBe('/favicon.ico');
    expect(href('link[rel="apple-touch-icon"]')).toBe('/apple-touch-icon.png');
    expect(href('link[rel="manifest"]')).toBe('/manifest-stable.webmanifest');
    applied.unmount();
    expect(mocks.setIcon).not.toHaveBeenCalled();
  });

  it('restores the Android launcher icon at launch', async () => {
    mocks.platform = 'android';
    localStorage.setItem(APP_ICON_KEY, JSON.stringify('preview'));
    renderHook(useApplyAppIcon);
    await waitFor(() => expect(mocks.setIcon).toHaveBeenLastCalledWith({ icon: 'preview' }));
  });

  it('says so when the launcher refuses the icon', async () => {
    mocks.platform = 'android';
    mocks.setIcon.mockRejectedValueOnce(new Error('Failed'));
    renderHook(useApplyAppIcon);
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
  });

  it('orders native changes and recovers after a failed change', async () => {
    mocks.platform = 'android';
    mocks.setIcon.mockRejectedValueOnce(new Error('Failed'));
    const first = setNativeAppIcon('preview');
    const second = setNativeAppIcon('stable');
    await expect(first).rejects.toThrow('Failed');
    await second;
    expect(mocks.setIcon.mock.calls).toEqual([[{ icon: 'preview' }], [{ icon: 'stable' }]]);
  });
});
