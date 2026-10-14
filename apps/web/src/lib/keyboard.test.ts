import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

type Animation = { from: number; to: number; duration: number; curve: number[] };
const native = vi.hoisted(() => ({
  current: vi.fn(),
  addListener: vi.fn(),
  platform: vi.fn(() => 'android'),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: native.platform },
  registerPlugin: () => native,
}));

import { useKeyboardTracking } from './keyboard';

const remove = vi.fn();
let keyboard: (animation: Animation) => void;
beforeEach(() => {
  vi.clearAllMocks();
  native.platform.mockReturnValue('android');
  native.current.mockResolvedValue({ top: 24, right: 0, bottom: 16, left: 0, keyboard: 120 });
  native.addListener.mockImplementation((_event, listener) => {
    keyboard = listener;
    return Promise.resolve({ remove });
  });
});
afterEach(() => {
  document.documentElement.removeAttribute('style');
});

it('hydrates native insets on reload and releases field focus when Android hides the keyboard', async () => {
  const hook = renderHook(useKeyboardTracking);
  const style = document.documentElement.style;
  await waitFor(() => expect(style.getPropertyValue('--keyboard')).toBe('120px'));
  expect(style.getPropertyValue('--safe-area-inset-top')).toBe('24px');
  expect(style.getPropertyValue('--safe-area-inset-bottom')).toBe('16px');
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  act(() => keyboard({ from: 120, to: 0, duration: 0, curve: [] }));
  expect(input).not.toHaveFocus();
  expect(style.getPropertyValue('--keyboard')).toBe('0px');
  input.remove();
  hook.unmount();
  await waitFor(() => expect(remove).toHaveBeenCalledOnce());
});

it('does not overwrite a newer keyboard event with a late current-insets response', async () => {
  let resolve = (_insets: {
    top: number;
    right: number;
    bottom: number;
    left: number;
    keyboard: number;
  }) => {};
  native.current.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const hook = renderHook(useKeyboardTracking);
  act(() => keyboard({ from: 0, to: 260, duration: 0, curve: [] }));
  await act(async () => resolve({ top: 24, right: 0, bottom: 16, left: 0, keyboard: 0 }));
  expect(document.documentElement.style.getPropertyValue('--keyboard')).toBe('260px');
  hook.unmount();
});

it('cleans up a listener that attaches after unmount, without updating an unmounted page', async () => {
  let attach = (_handle: { remove: () => void }) => {};
  native.addListener.mockImplementation((_event, listener) => {
    keyboard = listener;
    return new Promise((done) => {
      attach = done;
    });
  });
  const hook = renderHook(useKeyboardTracking);
  hook.unmount();
  await act(async () => attach({ remove }));
  expect(remove).toHaveBeenCalledOnce();
  act(() => keyboard({ from: 0, to: 300, duration: 0, curve: [] }));
  expect(document.documentElement.style.getPropertyValue('--keyboard')).toBe('0px');
});
