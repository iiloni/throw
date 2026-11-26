import { act, fireEvent, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScrollArea, ScrollAreaViewport, ScrollBar, ScrollBox } from './scroll-area';

/** Lays the viewport out as a browser would: jsdom measures nothing. */
function measure(viewport: HTMLElement, box: { scrollWidth: number; clientWidth: number }) {
  Object.defineProperty(viewport, 'scrollWidth', { configurable: true, value: box.scrollWidth });
  Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: box.clientWidth });
}

function scrollTo(viewport: HTMLElement, left: number) {
  viewport.scrollLeft = left;
  act(() => viewport.dispatchEvent(new Event('scroll')));
}

const observed = new Set<Element>();
let resized: (() => void) | null = null;

describe('ScrollArea sides', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    observed.clear();
    resized = null;
  });

  function setup(columns: number) {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe(element: Element) {
          observed.add(element);
        }
        unobserve() {}
        disconnect() {
          observed.clear();
        }
      },
    );
    const view = (count: number) => (
      <ScrollArea sides data-testid="area">
        <ScrollAreaViewport data-testid="viewport">
          {Array.from({ length: count }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed test columns
            <section key={index} data-column={index} />
          ))}
        </ScrollAreaViewport>
      </ScrollArea>
    );
    const result = render(view(columns));
    return { ...result, rerenderWith: (count: number) => result.rerender(view(count)) };
  }

  it('marks the root while content is scrolled out to the left or right', () => {
    const { getByTestId } = setup(3);
    const root = getByTestId('area');
    const viewport = getByTestId('viewport');
    measure(viewport, { scrollWidth: 1000, clientWidth: 400 });

    scrollTo(viewport, 0);
    expect(root).toHaveAttribute('data-more-right');
    expect(root).not.toHaveAttribute('data-more-left');

    scrollTo(viewport, 300);
    expect(root).toHaveAttribute('data-more-right');
    expect(root).toHaveAttribute('data-more-left');

    scrollTo(viewport, 600);
    expect(root).not.toHaveAttribute('data-more-right');
    expect(root).toHaveAttribute('data-more-left');
    // Only the sides: the top and bottom are `edges`.
    expect(root).not.toHaveAttribute('data-edges');
    expect(root).not.toHaveAttribute('data-more-bottom');
  });

  it('watches each child, as a row keeps its width while they run on past it', async () => {
    const { getByTestId, container, rerenderWith } = setup(2);
    const root = getByTestId('area');
    const viewport = getByTestId('viewport');
    for (const column of container.querySelectorAll('[data-column]'))
      expect(observed.has(column)).toBe(true);

    // A column added later is watched too, and a column growing re-measures with no scroll.
    rerenderWith(3);
    await act(async () => {});
    const added = container.querySelector('[data-column="2"]')!;
    expect(observed.has(added)).toBe(true);

    measure(viewport, { scrollWidth: 400, clientWidth: 400 });
    act(() => resized?.());
    expect(root).not.toHaveAttribute('data-more-right');
    measure(viewport, { scrollWidth: 700, clientWidth: 400 });
    act(() => resized?.());
    expect(root).toHaveAttribute('data-more-right');
  });

  it('leaves the sides unmarked without `sides`', () => {
    const { getByTestId } = render(
      <ScrollArea data-testid="area">
        <ScrollAreaViewport data-testid="viewport" />
      </ScrollArea>,
    );
    const viewport = getByTestId('viewport');
    measure(viewport, { scrollWidth: 1000, clientWidth: 400 });
    scrollTo(viewport, 0);
    expect(getByTestId('area')).not.toHaveAttribute('data-more-right');
  });
});

describe('ScrollBar', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps focus where it is when the thumb is pressed, and still calls its own handler', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const pressed = vi.fn();
    const { container } = render(
      <ScrollArea type="always">
        <ScrollAreaViewport />
        <ScrollBar onMouseDown={pressed} />
      </ScrollArea>,
    );
    const bar = container.querySelector('[data-slot="scroll-area-scrollbar"]')!;
    // fireEvent returns false when the default was prevented: an editor keeps its caret.
    expect(fireEvent.mouseDown(bar)).toBe(false);
    expect(pressed).toHaveBeenCalledOnce();
  });
});

describe('ScrollBox', () => {
  it('passes the viewport its ref and props, and the root the rest', () => {
    const ref = createRef<HTMLDivElement>();
    const { getByRole, getByTestId } = render(
      <ScrollBox
        data-testid="box"
        role="tabpanel"
        aria-label="Picker"
        className="max-h-40"
        viewportRef={ref}
        viewportProps={{ role: 'listbox', 'aria-label': 'Options' }}
      >
        <div role="option" aria-selected={false} />
      </ScrollBox>,
    );
    const root = getByTestId('box');
    expect(root).toHaveAttribute('data-slot', 'scroll-area');
    expect(root).toHaveClass('max-h-40');
    expect(getByRole('tabpanel', { name: 'Picker' })).toBe(root);
    const viewport = getByRole('listbox', { name: 'Options' });
    expect(viewport).toBe(ref.current);
    expect(viewport).toHaveAttribute('data-slot', 'scroll-area-viewport');
    expect(viewport).toHaveClass('max-h-[inherit]');
  });
});
