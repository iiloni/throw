import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { haptics } from '@/lib/haptics';

const boardState = vi.hoisted(() => ({
  value: { openTaskId: null as string | null, selection: [] as string[] },
}));
const dragState = vi.hoisted(() => ({ held: null as object | null, primed: false }));
vi.mock('@/lib/haptics', () => ({ haptics: { threshold: vi.fn() } }));
vi.mock('@/components/Board/state', () => ({ board: { get: () => boardState.value } }));
vi.mock('@/components/Board/drag', () => ({
  drag: { get: () => dragState.held },
  isPrimed: () => dragState.primed,
}));

import { SwitcherPull } from './SwitcherPull';

beforeEach(() => {
  boardState.value = { openTaskId: null, selection: [] };
  dragState.held = null;
  dragState.primed = false;
});
afterEach(() => {
  vi.clearAllMocks();
});

function Board({ enabled, onOpen }: { enabled: boolean; onOpen: () => void }) {
  const surface = useRef<HTMLElement>(null);
  return (
    <main ref={surface} data-testid="board">
      <SwitcherPull surface={surface} enabled={enabled} onOpen={onOpen} />
      <button type="button">Card</button>
      <div data-testid="column" style={{ overflowY: 'auto' }}>
        <p>In a column</p>
      </div>
      <section data-drawer="" data-detent="closed">
        <p>Dock</p>
      </section>
    </main>
  );
}

function setup(enabled = true) {
  const onOpen = vi.fn();
  const onPress = vi.fn();
  render(<Board enabled={enabled} onOpen={onOpen} />);
  const card = screen.getByRole('button', { name: 'Card' });
  card.addEventListener('click', onPress);
  return { onOpen, onPress, card };
}

function touch(
  target: Element,
  type: 'start' | 'move' | 'end' | 'cancel',
  x: number,
  y: number,
  time = 0,
  count = 1,
) {
  const lifted = type === 'end' || type === 'cancel';
  const touches = lifted
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

function pull(target: Element, distance = 120) {
  touch(target, 'start', 100, 100);
  return touch(target, 'move', 100, 100 + distance, 50).defaultPrevented;
}

describe('switcher pull', () => {
  it('opens the switcher past the threshold, without the tap beneath the finger', () => {
    const { onOpen, onPress, card } = setup();
    expect(pull(card)).toBe(true);
    expect(screen.getByText('Release to switch projects')).toBeInTheDocument();
    expect(haptics.threshold).toHaveBeenCalledOnce();
    touch(card, 'end', 100, 220, 80);
    fireEvent.click(card);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onPress).not.toHaveBeenCalled();
  });

  it('springs back from a short pull or one pulled back under the threshold', () => {
    const { onOpen, card } = setup();
    pull(card, 40);
    expect(screen.getByText('Pull to switch projects')).toBeInTheDocument();
    touch(card, 'end', 100, 140, 60);
    touch(card, 'start', 100, 100);
    touch(card, 'move', 100, 220, 50);
    touch(card, 'move', 100, 150, 80);
    touch(card, 'end', 100, 150, 90);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('leaves column swipes, upward scrolls, held cards and cancelled touches alone', () => {
    const { onOpen, card } = setup();
    touch(card, 'start', 100, 100);
    expect(touch(card, 'move', 220, 130, 50).defaultPrevented).toBe(false);
    touch(card, 'end', 220, 130, 80);

    touch(card, 'start', 100, 200);
    expect(touch(card, 'move', 100, 80, 50).defaultPrevented).toBe(false);
    touch(card, 'end', 100, 80, 80);

    // A still hold is a card's long press.
    touch(card, 'start', 100, 100);
    expect(touch(card, 'move', 100, 220, 400).defaultPrevented).toBe(false);
    touch(card, 'end', 100, 220, 420);

    pull(card);
    touch(card, 'cancel', 100, 220, 80);

    pull(card);
    dragState.primed = true;
    touch(card, 'move', 100, 230, 300);
    touch(card, 'end', 100, 230, 320);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('starts only when nothing covers the board and the column is at its top', () => {
    const { onOpen, card } = setup();
    const column = screen.getByTestId('column');
    column.scrollTop = 40;
    expect(pull(screen.getByText('In a column'))).toBe(false);
    column.scrollTop = 0;
    expect(pull(screen.getByText('Dock'))).toBe(false);

    boardState.value = { openTaskId: 'task', selection: [] };
    expect(pull(card)).toBe(false);
    boardState.value = { openTaskId: null, selection: ['task'] };
    expect(pull(card)).toBe(false);
    boardState.value = { openTaskId: null, selection: [] };
    dragState.held = {};
    expect(pull(card)).toBe(false);
    dragState.held = null;

    const drawer = screen.getByText('Dock').closest('section')!;
    drawer.dataset.detent = 'half';
    expect(pull(card)).toBe(false);
    drawer.dataset.detent = 'closed';
    drawer.setAttribute('role', 'dialog');
    expect(pull(card)).toBe(false);
    drawer.removeAttribute('role');
    touch(card, 'end', 100, 220, 80);
    expect(onOpen).not.toHaveBeenCalled();

    expect(pull(screen.getByText('In a column'))).toBe(true);
  });

  it('does nothing while disabled', () => {
    const { onOpen, card } = setup(false);
    expect(pull(card)).toBe(false);
    touch(card, 'end', 100, 220, 80);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
