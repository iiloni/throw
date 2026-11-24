import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { motionValue } from 'motion/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { haptics } from '@/lib/haptics';
import { useCaptureSwipe } from './useCaptureSwipe';

const motionMocks = vi.hoisted(() => ({
  reduced: false,
  animate: vi.fn(),
}));

vi.mock('@/lib/haptics', () => ({ haptics: { threshold: vi.fn() } }));
vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>();
  return {
    ...actual,
    animate: (...args: unknown[]) => {
      motionMocks.animate(...args);
      return actual.animate(...(args as Parameters<typeof actual.animate>));
    },
    useReducedMotion: () => motionMocks.reduced,
  };
});

afterEach(() => {
  vi.clearAllMocks();
  motionMocks.reduced = false;
  window.getSelection()?.removeAllRanges();
});

function setup({
  scrollTop = 0,
  scrollHeight = 100,
  enabled = true,
  canExpand = true,
  expandResult = undefined as boolean | undefined,
} = {}) {
  const y = motionValue(0);
  const onDismiss = vi.fn();
  const onExpand = vi.fn(() => expandResult);
  const onParentTouchStart = vi.fn();
  const onParentPointerDown = vi.fn();

  function Card() {
    const surface = useRef<HTMLDivElement>(null);
    const handle = useRef<HTMLDivElement>(null);
    useCaptureSwipe({ surface, handle, y, enabled, canExpand, onDismiss, onExpand });
    return (
      <div
        data-testid="parent"
        onTouchStart={onParentTouchStart}
        onPointerDown={onParentPointerDown}
      >
        <div ref={surface} data-testid="surface">
          <div ref={handle} data-testid="handle" />
          <div data-testid="scroll" style={{ overflowY: 'auto' }}>
            <textarea data-testid="textarea" defaultValue="Draft task title" />
          </div>
          <button type="button" onClick={onDismiss}>
            Tool
          </button>
        </div>
      </div>
    );
  }

  render(<Card />);
  const parent = screen.getByTestId('parent');
  const surface = screen.getByTestId('surface');
  const handle = screen.getByTestId('handle');
  const textarea = screen.getByTestId('textarea') as HTMLTextAreaElement;
  const scroll = screen.getByTestId('scroll');
  const tool = screen.getByRole('button');
  Object.defineProperties(scroll, {
    clientHeight: { value: 100, configurable: true },
    scrollHeight: { value: scrollHeight, configurable: true },
  });
  Object.defineProperties(textarea, {
    clientHeight: { value: 100, configurable: true },
    scrollHeight: { value: scrollHeight, configurable: true },
  });
  scroll.scrollTop = scrollTop;
  textarea.scrollTop = scrollTop;
  textarea.focus();
  textarea.setSelectionRange(0, 0);
  return {
    parent,
    surface,
    handle,
    textarea,
    scroll,
    tool,
    y,
    onDismiss,
    onExpand,
    onParentTouchStart,
    onParentPointerDown,
  };
}

function touch(
  target: HTMLElement,
  type: 'start' | 'move' | 'end' | 'cancel',
  x = 100,
  y = 200,
  time = 0,
  count = 1,
) {
  const touches =
    type === 'end' || type === 'cancel'
      ? []
      : Array.from({ length: count }, (_, identifier) => ({ clientX: x, clientY: y, identifier }));
  const factory = {
    start: createEvent.touchStart,
    move: createEvent.touchMove,
    end: createEvent.touchEnd,
    cancel: createEvent.touchCancel,
  }[type];
  const event = factory(target, { touches, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'timeStamp', { value: time });
  fireEvent(target, event);
  return event;
}

function pointer(
  target: HTMLElement,
  type: 'down' | 'move' | 'up' | 'cancel',
  x = 100,
  y = 200,
  time = 0,
) {
  const factory = {
    down: createEvent.pointerDown,
    move: createEvent.pointerMove,
    up: createEvent.pointerUp,
    cancel: createEvent.pointerCancel,
  }[type];
  const event = factory(target, {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'timeStamp', { value: time });
  fireEvent(target, event);
  return event;
}

describe('capture card swipes', () => {
  it.each(['surface', 'handle', 'textarea', 'tool'] as const)(
    'dismisses from the %s without clicking the tool',
    (part) => {
      const card = setup();
      const target = card[part];
      touch(target, 'start');
      expect(touch(target, 'move', 100, 350, 50).defaultPrevented).toBe(true);
      expect(card.y.get()).toBe(75);
      expect(haptics.threshold).toHaveBeenCalledOnce();
      touch(target, 'end', 100, 350, 80);
      fireEvent.click(card.tool);
      expect(card.onDismiss).toHaveBeenCalledOnce();
      expect(card.onExpand).not.toHaveBeenCalled();
    },
  );

  it('expands from the title textarea and caps the upward pull', () => {
    const { textarea, y, onExpand, onDismiss } = setup();
    touch(textarea, 'start');
    touch(textarea, 'move', 100, -100, 50);
    expect(y.get()).toBe(-56);
    expect(haptics.threshold).toHaveBeenCalledOnce();
    touch(textarea, 'end', 100, -100, 80);
    expect(onExpand).toHaveBeenCalledOnce();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('supports mouse pointer dragging on the handle', () => {
    const { handle, onExpand, onDismiss, onParentPointerDown } = setup();
    pointer(handle, 'down', 100, 200, 0);
    expect(onParentPointerDown).not.toHaveBeenCalled();
    pointer(handle, 'move', 100, 80, 50);
    pointer(handle, 'up', 100, 80, 80);
    expect(onExpand).toHaveBeenCalledOnce();
    expect(onDismiss).not.toHaveBeenCalled();

    pointer(handle, 'down', 100, 200, 200);
    pointer(handle, 'move', 100, 340, 250);
    pointer(handle, 'up', 100, 340, 280);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('isolates card touches from ancestor drawer listeners', () => {
    const { parent, textarea } = setup();
    const nativeParentTouch = vi.fn();
    parent.addEventListener('touchstart', nativeParentTouch);
    touch(textarea, 'start');
    touch(textarea, 'end', 100, 200, 40);
    expect(nativeParentTouch).not.toHaveBeenCalled();
    parent.removeEventListener('touchstart', nativeParentTouch);
  });

  it('claims the first small Android move before native scrolling takes over', () => {
    const { textarea, onExpand } = setup();
    touch(textarea, 'start');
    const firstMove = touch(textarea, 'move', 100, 192, 80);
    expect(firstMove.defaultPrevented).toBe(true);
    const nextMove = createEvent.touchMove(textarea, {
      touches: [{ clientX: 100, clientY: 70, identifier: 0 }],
      bubbles: true,
      cancelable: firstMove.defaultPrevented,
    });
    Object.defineProperty(nextMove, 'timeStamp', { value: 180 });
    fireEvent(textarea, nextMove);
    touch(textarea, 'end', 100, 70, 200);
    expect(onExpand).toHaveBeenCalledOnce();
  });

  it.each([
    ['up from the top', 0, -150],
    ['down from the bottom', 200, 150],
    ['up from the middle', 100, -150],
    ['down from the middle', 100, 150],
  ])('preserves scrolling %s, even if that scroll reaches the edge', (_, scrollTop, delta) => {
    const { textarea, scroll, y, onDismiss, onExpand } = setup({ scrollTop, scrollHeight: 300 });
    touch(textarea, 'start');
    scroll.scrollTop = delta > 0 ? 0 : 200;
    textarea.scrollTop = delta > 0 ? 0 : 200;
    expect(touch(textarea, 'move', 100, 200 + delta, 50).defaultPrevented).toBe(false);
    touch(textarea, 'end', 100, 200 + delta, 80);
    expect(y.get()).toBe(0);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onExpand).not.toHaveBeenCalled();
  });

  it.each([
    [0, 150],
    [200, -150],
  ])('allows an outward pull from the matching scroll edge', (scrollTop, delta) => {
    const { textarea, onDismiss, onExpand } = setup({ scrollTop, scrollHeight: 300 });
    touch(textarea, 'start');
    touch(textarea, 'move', 100, 200 + delta, 50);
    touch(textarea, 'end', 100, 200 + delta, 80);
    expect(delta > 0 ? onDismiss : onExpand).toHaveBeenCalledOnce();
  });

  it('leaves taps, horizontal gestures, and long presses focused and unclaimed', () => {
    const { textarea, tool, y, onDismiss, onExpand } = setup();
    touch(textarea, 'start');
    touch(textarea, 'end', 100, 200, 80);
    expect(textarea).toHaveFocus();
    touch(textarea, 'start');
    expect(touch(textarea, 'move', 260, 240, 50).defaultPrevented).toBe(false);
    touch(textarea, 'move', 260, 400, 80);
    touch(textarea, 'end', 260, 400, 90);
    touch(textarea, 'start');
    expect(touch(textarea, 'move', 100, 400, 350).defaultPrevented).toBe(false);
    touch(textarea, 'end', 100, 400, 380);
    expect(y.get()).toBe(0);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onExpand).not.toHaveBeenCalled();
    expect(textarea).toHaveFocus();
    fireEvent.click(tool);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('keeps selected text in the textarea available to edit while the handle still works', () => {
    const { textarea, handle, onDismiss, onExpand } = setup();
    textarea.setSelectionRange(0, 5);
    touch(textarea, 'start');
    expect(touch(textarea, 'move', 100, 400, 50).defaultPrevented).toBe(false);
    touch(textarea, 'end', 100, 400, 80);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onExpand).not.toHaveBeenCalled();
    touch(handle, 'start');
    touch(handle, 'move', 100, 400, 50);
    touch(handle, 'end', 100, 400, 80);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('returns a short pull without changing textarea focus', () => {
    const { textarea, onDismiss, onExpand } = setup();
    touch(textarea, 'start');
    touch(textarea, 'move', 100, 240, 100);
    touch(textarea, 'end', 100, 240, 250);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onExpand).not.toHaveBeenCalled();
    expect(textarea).toHaveFocus();
  });

  it('jumps straight back to zero when reduced motion is enabled', () => {
    motionMocks.reduced = true;
    const { textarea, y, onDismiss, onExpand } = setup();
    touch(textarea, 'start');
    touch(textarea, 'move', 100, 240, 100);
    expect(y.get()).toBe(20);
    touch(textarea, 'end', 100, 240, 250);
    expect(y.get()).toBe(0);
    expect(motionMocks.animate).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onExpand).not.toHaveBeenCalled();
  });

  it('does not commit expand when canExpand is false', () => {
    const blocked = setup({ canExpand: false });
    touch(blocked.textarea, 'start');
    touch(blocked.textarea, 'move', 100, 50, 50);
    expect(haptics.threshold).not.toHaveBeenCalled();
    touch(blocked.textarea, 'end', 100, 50, 80);
    expect(blocked.onExpand).not.toHaveBeenCalled();
  });

  it('returns to rest when onExpand returns false', () => {
    motionMocks.reduced = true;
    const rejected = setup({ expandResult: false });
    touch(rejected.textarea, 'start');
    touch(rejected.textarea, 'move', 100, 50, 50);
    touch(rejected.textarea, 'end', 100, 50, 80);
    expect(rejected.onExpand).toHaveBeenCalledOnce();
    expect(rejected.y.get()).toBe(0);
    expect(rejected.textarea).toHaveFocus();
  });

  it.each(['cancel', 'multitouch'] as const)('does not commit a %s gesture', (type) => {
    const { textarea, onDismiss, onExpand } = setup();
    touch(textarea, 'start');
    touch(textarea, 'move', 100, 400, 50);
    if (type === 'multitouch') touch(textarea, 'start', 100, 400, 60, 2);
    else touch(textarea, 'cancel', 100, 400, 60);
    touch(textarea, 'end', 100, 400, 80);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onExpand).not.toHaveBeenCalled();
  });

  it('dismisses on a deliberate downward flick but ignores small jitter', () => {
    const { textarea, onDismiss } = setup();
    touch(textarea, 'start');
    touch(textarea, 'move', 100, 215, 10);
    touch(textarea, 'end', 100, 215, 20);
    expect(onDismiss).not.toHaveBeenCalled();
    touch(textarea, 'start', 100, 200, 100);
    touch(textarea, 'move', 100, 250, 130);
    touch(textarea, 'end', 100, 250, 150);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('does not claim gestures during the exit animation', () => {
    const { textarea, y, onDismiss, onExpand } = setup({ enabled: false });
    touch(textarea, 'start');
    expect(touch(textarea, 'move', 100, 400, 50).defaultPrevented).toBe(false);
    touch(textarea, 'end', 100, 400, 80);
    expect(y.get()).toBe(0);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onExpand).not.toHaveBeenCalled();
  });
});
