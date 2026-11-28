import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRailPeek, PEEK_DWELL_MS, PEEK_GRACE_MS, type RailPeekHost } from './railPeek';

function setup(overrides: Partial<RailPeekHost> = {}) {
  let open = false;
  const host = {
    canOpen: vi.fn(() => !open),
    open: vi.fn(() => {
      open = true;
    }),
    isOpen: vi.fn(() => open),
    isHeld: vi.fn(() => false),
    close: vi.fn(() => {
      open = false;
    }),
    ...overrides,
  };
  return { host, peek: createRailPeek(host), isOpen: () => open };
}

describe('createRailPeek', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('opens once a mouse has rested on the strip for the dwell', () => {
    const { peek, host } = setup();
    peek.enterStrip('mouse');
    vi.advanceTimersByTime(PEEK_DWELL_MS - 1);
    expect(host.open).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(host.open).toHaveBeenCalledTimes(1);
  });

  it('never opens for a touch or a pen', () => {
    const { peek, host } = setup();
    peek.enterStrip('touch');
    peek.enterStrip('pen');
    vi.advanceTimersByTime(PEEK_DWELL_MS * 2);
    expect(host.open).not.toHaveBeenCalled();
  });

  it('forgets a dwell the pointer leaves or presses before it completes', () => {
    const { peek, host } = setup();
    peek.enterStrip('mouse');
    vi.advanceTimersByTime(PEEK_DWELL_MS - 100);
    peek.cancelDwell();
    vi.advanceTimersByTime(PEEK_DWELL_MS);
    expect(host.open).not.toHaveBeenCalled();
    // Coming back starts the dwell over.
    peek.enterStrip('mouse');
    vi.advanceTimersByTime(PEEK_DWELL_MS - 100);
    expect(host.open).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(host.open).toHaveBeenCalledTimes(1);
  });

  it('does not open over a card picked up during the dwell', () => {
    let held = false;
    const { peek, host } = setup({ canOpen: () => !held });
    peek.enterStrip('mouse');
    held = true;
    vi.advanceTimersByTime(PEEK_DWELL_MS);
    expect(host.open).not.toHaveBeenCalled();
    // Nor does a dwell start while one is held.
    peek.enterStrip('mouse');
    held = false;
    vi.advanceTimersByTime(PEEK_DWELL_MS);
    expect(host.open).not.toHaveBeenCalled();
  });

  it('closes a grace after the pointer leaves, unless it comes back', () => {
    const { peek, host, isOpen } = setup();
    peek.enterStrip('mouse');
    vi.advanceTimersByTime(PEEK_DWELL_MS);
    expect(isOpen()).toBe(true);

    peek.leave();
    vi.advanceTimersByTime(PEEK_GRACE_MS - 1);
    peek.enter();
    vi.advanceTimersByTime(PEEK_GRACE_MS * 2);
    expect(host.close).not.toHaveBeenCalled();

    peek.leave();
    vi.advanceTimersByTime(PEEK_GRACE_MS);
    expect(host.close).toHaveBeenCalledTimes(1);
    expect(isOpen()).toBe(false);
  });

  it('stays while something begun in it is held, and goes once it has finished', () => {
    let held = true;
    const { peek, host } = setup({ isHeld: () => held });
    peek.enterStrip('mouse');
    vi.advanceTimersByTime(PEEK_DWELL_MS);
    peek.leave();
    vi.advanceTimersByTime(PEEK_GRACE_MS * 5);
    expect(host.close).not.toHaveBeenCalled();

    held = false;
    vi.advanceTimersByTime(PEEK_GRACE_MS);
    expect(host.close).toHaveBeenCalledTimes(1);
  });

  it('stays when the pointer is back in it by the time what held it has finished', () => {
    let held = true;
    const { peek, host } = setup({ isHeld: () => held });
    peek.enterStrip('mouse');
    vi.advanceTimersByTime(PEEK_DWELL_MS);
    peek.leave();
    vi.advanceTimersByTime(PEEK_GRACE_MS * 2);
    peek.enter();
    held = false;
    vi.advanceTimersByTime(PEEK_GRACE_MS * 3);
    expect(host.close).not.toHaveBeenCalled();
  });

  it('leaves a rail opened for good or closed elsewhere alone', () => {
    const { peek, host } = setup();
    peek.enterStrip('mouse');
    vi.advanceTimersByTime(PEEK_DWELL_MS);
    peek.leave();
    peek.settle();
    vi.advanceTimersByTime(PEEK_GRACE_MS * 2);
    expect(host.close).not.toHaveBeenCalled();
  });

  it('does nothing on leaving a strip that never opened', () => {
    const { peek, host } = setup();
    peek.leave();
    vi.advanceTimersByTime(PEEK_GRACE_MS * 2);
    expect(host.close).not.toHaveBeenCalled();
  });

  it('tells the strip while a dwell runs, so it can show how long is left', () => {
    const dwelling = vi.fn();
    const { peek } = setup({ dwelling });
    peek.enterStrip('touch');
    expect(dwelling).not.toHaveBeenCalled();

    peek.enterStrip('mouse');
    expect(dwelling).toHaveBeenLastCalledWith(true);
    peek.cancelDwell();
    expect(dwelling).toHaveBeenLastCalledWith(false);
    // Nothing pending, nothing to tell.
    peek.cancelDwell();
    expect(dwelling).toHaveBeenCalledTimes(2);

    peek.enterStrip('mouse');
    vi.advanceTimersByTime(PEEK_DWELL_MS);
    expect(dwelling).toHaveBeenLastCalledWith(false);
    expect(dwelling).toHaveBeenCalledTimes(4);
  });

  it('starts a dwell for a mouse moving on a strip that appeared under it', () => {
    const { peek, host } = setup();
    peek.moveOnStrip('mouse', true);
    peek.moveOnStrip('touch', false);
    vi.advanceTimersByTime(PEEK_DWELL_MS);
    expect(host.open).not.toHaveBeenCalled();

    peek.moveOnStrip('mouse', false);
    vi.advanceTimersByTime(PEEK_DWELL_MS / 2);
    // Moving on does not start the dwell over.
    peek.moveOnStrip('mouse', false);
    vi.advanceTimersByTime(PEEK_DWELL_MS / 2);
    expect(host.open).toHaveBeenCalledTimes(1);
    // Nor once it is open.
    peek.moveOnStrip('mouse', false);
    vi.advanceTimersByTime(PEEK_DWELL_MS);
    expect(host.open).toHaveBeenCalledTimes(1);
  });

  it('cancels everything pending when disposed', () => {
    const { peek, host } = setup();
    peek.enterStrip('mouse');
    peek.dispose();
    vi.advanceTimersByTime(PEEK_DWELL_MS);
    expect(host.open).not.toHaveBeenCalled();
  });
});
