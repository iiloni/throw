import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/haptics', () => ({ haptics: { selection: vi.fn(), toggle: vi.fn() } }));
// Placed at once, so each test reads where the drawer comes to rest, unless a test slides it.
const motionPreference = vi.hoisted(() => ({ reduced: true }));
vi.mock('motion/react', async (original) => ({
  ...(await original<typeof import('motion/react')>()),
  useReducedMotion: () => motionPreference.reduced,
}));

import { Drawer, type DrawerPage } from './Drawer';

const HEIGHT = 800;
const HALF = Math.round(HEIGHT * 0.42);
let now = 0;
let measured = 0;

beforeEach(() => {
  now = 0;
  measured = 0;
  motionPreference.reduced = true;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  // jsdom lays nothing out; the drawer is a screen tall and its header has no height.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    measured++;
    return this.hasAttribute('data-drawer') ? HEIGHT : 0;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const closed: DrawerPage = { key: 'closed', title: 'Closed', half: true, content: <p>History</p> };
const settings: DrawerPage = { key: 'settings', title: 'Board settings', content: <p>Options</p> };

function setup(page: DrawerPage | null = closed) {
  const onClosePage = vi.fn();
  const onDetent = vi.fn();
  const view = (shown: DrawerPage | null) => (
    <Drawer
      label="Backlog"
      dock={<p>Dock</p>}
      detent="closed"
      onDetent={onDetent}
      page={shown}
      onClosePage={onClosePage}
    >
      <p>Backlog list</p>
    </Drawer>
  );
  const result = render(view(page));
  return {
    onClosePage,
    onDetent,
    rerender: (next: DrawerPage | null) => result.rerender(view(next)),
  };
}

const drawer = () => document.querySelector<HTMLElement>('[data-drawer]')!;
const offset = () => Number(/translateY\((-?[\d.]+)px\)/.exec(drawer().style.transform)?.[1] ?? 0);

function touch(target: Element, type: 'start' | 'move' | 'end', y: number) {
  const factory = {
    start: createEvent.touchStart,
    move: createEvent.touchMove,
    end: createEvent.touchEnd,
  }[type];
  const touches = type === 'end' ? [] : [{ clientX: 100, clientY: y, identifier: 0 }];
  fireEvent(target, factory(target, { touches, bubbles: true, cancelable: true }));
}

/** Pulls the drawer by `distance` from its title, then holds still so it is let go without speed. */
function pull(distance: number) {
  const title = screen.getByRole('heading');
  const start = 400;
  act(() => {
    touch(title, 'start', start);
    for (let step = 1; step <= 10; step++) {
      now += 16;
      touch(title, 'move', start + (distance * step) / 10);
    }
    now += 200;
    touch(title, 'end', start + distance);
  });
}

async function settled() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

describe('Drawer half pages', () => {
  it('opens a half page at half height', async () => {
    setup();
    await settled();
    expect(drawer()).toHaveAttribute('data-page-height', 'half');
    expect(offset()).toBe(HALF);
    expect(screen.getByRole('dialog', { name: 'Closed' })).toBeInTheDocument();
  });

  it('pulls up to full, back down to half and past half to close', async () => {
    const { onClosePage } = setup();
    await settled();
    pull(-300);
    await settled();
    expect(drawer()).toHaveAttribute('data-page-height', 'full');
    expect(offset()).toBe(0);
    // Let go nearer full than half, it springs back up.
    pull(150);
    await settled();
    expect(drawer()).toHaveAttribute('data-page-height', 'full');
    expect(offset()).toBe(0);
    pull(220);
    await settled();
    expect(drawer()).toHaveAttribute('data-page-height', 'half');
    expect(offset()).toBe(HALF);
    expect(onClosePage).not.toHaveBeenCalled();
    pull(150);
    expect(onClosePage).toHaveBeenCalledTimes(1);
  });

  it('keeps its height after a short pull either way', async () => {
    const { onClosePage } = setup();
    await settled();
    pull(-60);
    await settled();
    expect(drawer()).toHaveAttribute('data-page-height', 'half');
    expect(offset()).toBe(HALF);
    pull(40);
    await settled();
    expect(drawer()).toHaveAttribute('data-page-height', 'half');
    expect(onClosePage).not.toHaveBeenCalled();
  });

  it('closes when flung down from full', async () => {
    const { onClosePage } = setup();
    await settled();
    pull(-300);
    await settled();
    const title = screen.getByRole('heading');
    act(() => {
      touch(title, 'start', 100);
      for (let step = 1; step <= 4; step++) {
        now += 10;
        touch(title, 'move', 100 + step * 60);
      }
      touch(title, 'end', 340);
    });
    expect(onClosePage).toHaveBeenCalledTimes(1);
  });

  it('opens at half again after it was closed at full', async () => {
    const { rerender } = setup();
    await settled();
    pull(-300);
    await settled();
    expect(drawer()).toHaveAttribute('data-page-height', 'full');
    rerender(null);
    await settled();
    rerender(closed);
    await settled();
    expect(drawer()).toHaveAttribute('data-page-height', 'half');
    expect(offset()).toBe(HALF);
  });

  it('closes on Escape and the close button at either height', async () => {
    const { onClosePage } = setup();
    await settled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClosePage).toHaveBeenCalledTimes(1);
    pull(-300);
    await settled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClosePage).toHaveBeenCalledTimes(2);
  });

  it('keeps the list end clear of the off-screen half', async () => {
    setup();
    await settled();
    const content = screen.getByText('History').closest<HTMLElement>('[style*="--drawer-hidden"]');
    expect(content?.style.getPropertyValue('--drawer-hidden')).toBe(`${HALF}px`);
    pull(-300);
    await settled();
    expect(content?.style.getPropertyValue('--drawer-hidden')).toBe('0px');
  });
});

describe('Drawer full pages', () => {
  it('open at full and do not rise or settle at half', async () => {
    const { onClosePage } = setup(settings);
    await settled();
    expect(drawer()).not.toHaveAttribute('data-page-height');
    expect(offset()).toBe(0);
    pull(150);
    await settled();
    expect(onClosePage).toHaveBeenCalledTimes(1);
  });

  it('stay open after a short pull', async () => {
    const { onClosePage } = setup(settings);
    await settled();
    pull(60);
    await settled();
    expect(offset()).toBe(0);
    expect(onClosePage).not.toHaveBeenCalled();
  });
});

describe('Drawer motion', () => {
  it('measures its heights once per pull rather than on every move', async () => {
    setup(settings);
    await settled();
    const title = screen.getByRole('heading');
    act(() => touch(title, 'start', 400));
    const before = measured;
    act(() => {
      for (let step = 1; step <= 10; step++) {
        now += 16;
        touch(title, 'move', 400 + step * 4);
      }
    });
    // One measurement: the drawer, its header, the safe area.
    expect(measured - before).toBeLessThanOrEqual(3);
    act(() => {
      now += 200;
      touch(title, 'end', 440);
    });
  });

  it('keeps a page closing into the dock until it settles, without mounting what is beneath', async () => {
    let mounts = 0;
    function Beneath() {
      useEffect(() => {
        mounts++;
      }, []);
      return <p>Backlog list</p>;
    }
    const onSettle = vi.fn();
    const view = (shown: DrawerPage | null) => (
      <Drawer
        label="Backlog"
        dock={<p>Dock</p>}
        detent="closed"
        onDetent={() => {}}
        page={shown}
        onClosePage={() => {}}
        onSettle={onSettle}
      >
        <Beneath />
      </Drawer>
    );
    const { rerender } = render(view(settings));
    await settled();
    onSettle.mockClear();
    rerender(view(null));
    expect(screen.getByText('Options')).toBeInTheDocument();
    expect(screen.getByText('Options').closest('[aria-hidden]')).not.toBeNull();
    expect(screen.queryByText('Backlog list')).toBeNull();
    expect(mounts).toBe(0);
    await settled();
    expect(onSettle).toHaveBeenCalled();
    expect(screen.queryByText('Options')).toBeNull();
    expect(screen.getByText('Backlog list')).toBeInTheDocument();
    expect(mounts).toBe(1);
  });

  it('drops a page still closing when another opens, rather than fading the two across', async () => {
    motionPreference.reduced = false;
    const edit: DrawerPage = { key: 'edit', title: 'Edit', content: <p>Edit form</p> };
    const view = (shown: DrawerPage | null) => (
      <Drawer
        label="Backlog"
        dock={<p>Dock</p>}
        detent="closed"
        onDetent={() => {}}
        page={shown}
        onClosePage={() => {}}
      >
        <p>Backlog list</p>
      </Drawer>
    );
    const { rerender } = render(view(settings));
    await settled();
    rerender(view(null));
    expect(screen.getByText('Options')).toBeInTheDocument();
    rerender(view(edit));
    expect(screen.queryByText('Options')).toBeNull();
    expect(screen.getByText('Edit form').closest('[aria-hidden]')).toBeNull();
  });

  it('trades the move target for the dock, the leaving target inert until it has faded', async () => {
    motionPreference.reduced = false;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    const view = (move: boolean) => (
      <Drawer
        label="Backlog"
        dock={<p>Dock</p>}
        detent="closed"
        onDetent={() => {}}
        page={null}
        onClosePage={() => {}}
        move={move ? <button type="button">Send</button> : null}
      >
        <p>Backlog list</p>
      </Drawer>
    );
    const { rerender } = render(view(true));
    expect(screen.getByText('Dock').closest('[hidden]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Send' }).closest('[inert]')).toBeNull();
    rerender(view(false));
    // The dock is back at once while the target fades, out of reach of a second tap.
    expect(screen.getByText('Dock').closest('[hidden]')).toBeNull();
    expect(screen.getByText('Send').closest('[inert]')).not.toBeNull();
    for (let frame = 0; frame < 60 && screen.queryByText('Send'); frame++) {
      now += 16;
      await settled();
    }
    expect(screen.queryByText('Send')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('floats a selection over the open list it was chosen from, and a held card in its header', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    const view = (
      floatMove: boolean,
      detent: 'closed' | 'half',
      page: DrawerPage | null = null,
    ) => (
      <Drawer
        label="Backlog"
        dock={<p>Dock</p>}
        detent={detent}
        onDetent={() => {}}
        page={page}
        onClosePage={() => {}}
        move={<p>Selection</p>}
        floatMove={floatMove}
      >
        <p>Backlog list</p>
      </Drawer>
    );
    // The one shown, not a copy still leaving the place it moved from.
    const selection = () =>
      screen.getAllByText('Selection').find((element) => !element.closest('[inert]'))!;
    const inFooter = () => selection().closest('[data-drawer] [data-drop-expand]') !== null;
    const { rerender } = render(view(true, 'half'));
    // The list and its dock stay in view, the selection at their foot.
    expect(inFooter()).toBe(true);
    expect(screen.getByText('Dock').closest('[hidden]')).toBeNull();
    await settled();
    expect(offset()).toBe(HALF);
    // A held card sinks the list under the target as before.
    rerender(view(false, 'half'));
    expect(inFooter()).toBe(false);
    expect(screen.getByText('Dock').closest('[hidden]')).not.toBeNull();
    // A collapsed drawer has no list in view, so the selection is its header.
    rerender(view(true, 'closed'));
    expect(screen.getByText('Dock').closest('[hidden]')).not.toBeNull();
    // A half page, as the closed tasks are, keeps its place too.
    rerender(view(true, 'closed', closed));
    expect(inFooter()).toBe(true);
    expect(screen.getByText('History')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('slides by frames, so a long frame does not carry it most of the way at once', async () => {
    motionPreference.reduced = false;
    const onSettle = vi.fn();
    const view = (shown: DrawerPage | null) => (
      <Drawer
        label="Backlog"
        dock={<p>Dock</p>}
        detent="closed"
        onDetent={() => {}}
        page={shown}
        onClosePage={() => {}}
        onSettle={onSettle}
      >
        <p>Backlog list</p>
      </Drawer>
    );
    const { rerender } = render(view(null));
    await settled();
    expect(offset()).toBe(HEIGHT);
    rerender(view(settings));
    // A frame held up for half a second, as mounting a heavy page can on a phone.
    now += 500;
    await settled();
    now += 16;
    await settled();
    expect(offset()).toBeGreaterThan(HEIGHT / 2);
    expect(onSettle).not.toHaveBeenCalled();
    for (let frame = 0; frame < 120 && !onSettle.mock.calls.length; frame++) {
      now += 16;
      await settled();
    }
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(offset()).toBe(0);
  });
});
