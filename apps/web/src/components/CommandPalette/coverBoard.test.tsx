import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { trackDrawerTravel } from '@/components/Drawer/travel';
import { useCoverBoard } from './coverBoard';

let frames: FrameRequestCallback[] = [];
let travel = 0;
let drawer: HTMLElement;
let content: HTMLElement;

function frame() {
  const due = frames;
  frames = [];
  act(() => {
    for (const callback of due) callback(0);
  });
}

// MutationObserver callbacks are microtasks.
const settleMutations = () => act(() => Promise.resolve());

beforeEach(() => {
  frames = [];
  travel = -200;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  drawer = document.createElement('section');
  drawer.setAttribute('data-drawer', '');
  drawer.style.transform = 'translateY(400px)';
  content = document.createElement('div');
  drawer.append(content);
  document.body.append(drawer);
  trackDrawerTravel(drawer, () => travel);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const covering = () => drawer.hasAttribute('data-covers');

describe('useCoverBoard', () => {
  it('covers the board once the drawer comes to rest, not while it rises', () => {
    renderHook(() => useCoverBoard({ current: content }));
    frame();
    expect(covering()).toBe(false);
    drawer.style.transform = 'translateY(40px)';
    travel = 0;
    frame();
    expect(covering()).toBe(true);
  });

  it('shows the board the moment the drawer is dragged, and covers it again at rest', async () => {
    travel = 0;
    drawer.style.transform = 'translateY(40px)';
    renderHook(() => useCoverBoard({ current: content }));
    frame();
    expect(covering()).toBe(true);

    drawer.style.transform = 'translateY(90px)';
    await settleMutations();
    frame();
    expect(covering()).toBe(false);

    travel = -50;
    drawer.style.transform = 'translateY(60px)';
    await settleMutations();
    frame();
    expect(covering()).toBe(false);
    travel = 0;
    drawer.style.transform = 'translateY(40px)';
    frame();
    expect(covering()).toBe(true);
  });

  it('leaves the board painted beside a drawer narrower than the screen', () => {
    travel = 0;
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(700);
    vi.spyOn(drawer, 'getBoundingClientRect').mockReturnValue({ width: 448 } as DOMRect);
    renderHook(() => useCoverBoard({ current: content }));
    frame();
    expect(covering()).toBe(false);
  });

  it('takes its mark away when the page goes', () => {
    travel = 0;
    const { unmount } = renderHook(() => useCoverBoard({ current: content }));
    frame();
    expect(covering()).toBe(true);
    unmount();
    expect(covering()).toBe(false);
  });
});
