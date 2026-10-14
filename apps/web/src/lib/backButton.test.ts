import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  minimizeApp: vi.fn(),
  addListener: vi.fn(),
}));
vi.mock('@capacitor/app', () => ({ App: native }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));

import { useBackButton, useBackHandler } from './backButton';

it('closes the latest active overlay, uses its latest callback and resumes history after dismissal', () => {
  let back = (_event: { canGoBack: boolean }) => {};
  native.addListener.mockImplementation((_event, listener) => {
    back = listener;
    return Promise.resolve({ remove: vi.fn() });
  });
  const history = vi.spyOn(window.history, 'back').mockImplementation(() => {});
  const first = vi.fn();
  const second = vi.fn();
  const updated = vi.fn();
  const hook = renderHook(
    ({ inner, onInner }) => {
      useBackButton();
      useBackHandler(true, first);
      useBackHandler(inner, onInner);
    },
    { initialProps: { inner: true, onInner: second } },
  );
  expect(native.addListener).toHaveBeenCalledOnce();
  act(() => back({ canGoBack: true }));
  expect(second).toHaveBeenCalledOnce();
  expect(first).not.toHaveBeenCalled();
  expect(history).not.toHaveBeenCalled();
  hook.rerender({ inner: true, onInner: updated });
  act(() => back({ canGoBack: true }));
  expect(updated).toHaveBeenCalledOnce();
  hook.rerender({ inner: false, onInner: updated });
  act(() => back({ canGoBack: true }));
  expect(first).toHaveBeenCalledOnce();
  hook.unmount();
  act(() => back({ canGoBack: true }));
  expect(history).toHaveBeenCalledOnce();
  act(() => back({ canGoBack: false }));
  expect(native.minimizeApp).toHaveBeenCalledOnce();
  history.mockRestore();
});
