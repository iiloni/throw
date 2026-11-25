import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { END_FAR, ScrollToBottom, useScrollToBottom } from './ScrollToBottom';

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
  },
);

const reducedMotion = vi.hoisted(() => ({ value: false }));
vi.mock('motion/react', async (original) => ({
  ...(await original<typeof import('motion/react')>()),
  useReducedMotion: () => reducedMotion.value,
}));

describe('ScrollToBottom', () => {
  it('appears while the task offers a jump and keeps the editor focused', () => {
    const { rerender } = render(
      <TooltipProvider>
        <ScrollToBottom onJump={null} />
      </TooltipProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Scroll to bottom' })).not.toBeInTheDocument();

    const jump = vi.fn();
    rerender(
      <TooltipProvider>
        <ScrollToBottom onJump={jump} />
      </TooltipProvider>,
    );
    const button = screen.getByRole('button', { name: 'Scroll to bottom' });
    const pointer = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    fireEvent(button, pointer);
    expect(pointer.defaultPrevented).toBe(true);
    fireEvent.click(button);
    expect(jump).toHaveBeenCalledOnce();
  });

  it('steps aside while hidden', () => {
    render(
      <TooltipProvider>
        <ScrollToBottom onJump={vi.fn()} hidden />
      </TooltipProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Scroll to bottom' })).not.toBeInTheDocument();
  });
});

function scroller({ height, client, top }: { height: number; client: number; top: number }) {
  const element = document.createElement('div');
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: height });
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: client });
  element.scrollTop = top;
  element.scrollTo = vi.fn() as unknown as typeof element.scrollTo;
  return element;
}

describe('useScrollToBottom', () => {
  afterEach(() => {
    reducedMotion.value = false;
  });

  it('offers the jump only while the end is well out of view', () => {
    const element = scroller({ height: 2000, client: 500, top: 0 });
    const { result } = renderHook(() => useScrollToBottom(element));
    expect(result.current).toBeTypeOf('function');

    act(() => {
      element.scrollTop = 2000 - 500 - END_FAR;
      element.dispatchEvent(new Event('scroll'));
    });
    expect(result.current).toBeNull();

    act(() => {
      element.scrollTop = 2000 - 500 - END_FAR - 1;
      element.dispatchEvent(new Event('scroll'));
    });
    act(() => result.current?.());
    expect(element.scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: 'smooth' });
  });

  it('jumps at once with reduced motion', () => {
    reducedMotion.value = true;
    const element = scroller({ height: 2000, client: 500, top: 0 });
    const { result } = renderHook(() => useScrollToBottom(element));
    act(() => result.current?.());
    expect(element.scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: 'instant' });
  });

  it('offers nothing without a scroller', () => {
    const { result } = renderHook(() => useScrollToBottom(null));
    expect(result.current).toBeNull();
  });
});
