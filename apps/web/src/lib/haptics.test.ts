import { afterEach, expect, it, vi } from 'vitest';
import { feelStatusChange, haptics } from './haptics';

afterEach(() => vi.unstubAllGlobals());

it('vibrates in a phone browser, harder for a pick-up than a tick', () => {
  const vibrate = vi.fn();
  vi.stubGlobal('navigator', { ...navigator, vibrate });
  haptics.selection();
  haptics.longPress();
  expect(vibrate.mock.calls).toEqual([[8], [12]]);
});

it('lands finishing a task as success and any other status as a choice', () => {
  const vibrate = vi.fn();
  vi.stubGlobal('navigator', { ...navigator, vibrate });
  feelStatusChange('done');
  feelStatusChange('active');
  feelStatusChange('cancelled');
  expect(vibrate.mock.calls).toEqual([[14], [8], [8]]);
});
