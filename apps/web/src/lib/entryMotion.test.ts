import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEntryMotion } from './entryMotion';

/** Stands in for the transition types the page is under while a hook mounts. */
function underTransition(types: string[]) {
  vi.spyOn(document.documentElement, 'matches').mockImplementation((selector: string) => {
    const match = /^:active-view-transition-type\((.*)\)$/.exec(selector);
    return !!match?.[1]?.split(/,\s*/).some((type) => types.includes(type));
  });
}

afterEach(() => vi.restoreAllMocks());

describe('useEntryMotion', () => {
  it('enters once per key, so a remount shows its content at once', () => {
    const first = renderHook(() => useEntryMotion('test:remount'));
    expect(first.result.current.opacity.get()).toBe(0);
    first.unmount();
    const again = renderHook(() => useEntryMotion('test:remount'));
    expect(again.result.current.opacity.get()).toBe(1);
  });

  it('enters again on a board switched to through its cross-fade', () => {
    renderHook(() => useEntryMotion('test:board')).unmount();
    underTransition(['fade']);
    const arriving = renderHook(() => useEntryMotion('test:board'));
    expect(arriving.result.current.opacity.get()).toBe(0);
  });

  it('shows content at once while the whole page moves', () => {
    underTransition(['forward']);
    const moving = renderHook(() => useEntryMotion('test:moving'));
    expect(moving.result.current.opacity.get()).toBe(1);
  });

  it('never enters content that skips its entry', () => {
    underTransition(['fade']);
    const held = renderHook(() => useEntryMotion('test:held', true, 0, true));
    expect(held.result.current.opacity.get()).toBe(1);
  });
});
