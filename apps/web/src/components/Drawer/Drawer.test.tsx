import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/haptics', () => ({ haptics: { selection: vi.fn(), toggle: vi.fn() } }));
// Placed at once, so each test reads where the drawer comes to rest.
vi.mock('motion/react', async (original) => ({
  ...(await original<typeof import('motion/react')>()),
  useReducedMotion: () => true,
}));

import { Drawer, type DrawerPage } from './Drawer';

const HEIGHT = 800;
const HALF = Math.round(HEIGHT * 0.42);
let now = 0;

beforeEach(() => {
  now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  // jsdom lays nothing out; the drawer is a screen tall and its header has no height.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
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
