import { render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LayoutMorph } from './LayoutMorph';

function Half({ compact, reduced }: { compact: boolean; reduced: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root} className="relative flex">
      {compact ? (
        <div data-compact-board="" id="compact">
          <div data-rearrange-card="">
            <article data-card-id="task">Compact card</article>
          </div>
        </div>
      ) : (
        <div data-board-layout="" id="full">
          <div data-rearrange-card="">
            <article data-card-id="task">Full card</article>
          </div>
        </div>
      )}
      <LayoutMorph root={root} compact={compact} reduced={reduced} />
    </div>
  );
}

describe('LayoutMorph', () => {
  afterEach(() => vi.restoreAllMocks());

  it('draws the layout going in a layer of still copies as the layout changes', () => {
    // jsdom lays nothing out: every element stands in the same box, so the card is on screen.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 200, 100),
    );
    const { container, rerender } = render(<Half compact={false} reduced={false} />);
    expect(container.querySelector('[data-layout-morph]')).toBeNull();
    rerender(<Half compact reduced={false} />);
    const layer = container.querySelector('[data-layout-morph]');
    expect(layer).not.toBeNull();
    expect(layer?.textContent).toContain('Full card');
    // Nothing in it is the board: no ids, cards or layouts for anything to find.
    expect(layer?.querySelector('[id], [data-card-id], [data-board-layout]')).toBeNull();
    expect(layer?.getAttribute('aria-hidden')).toBe('true');
  });

  it('switches in place with reduced motion', () => {
    const { container, rerender } = render(<Half compact={false} reduced />);
    rerender(<Half compact reduced />);
    expect(container.querySelector('[data-layout-morph]')).toBeNull();
    expect(container.querySelector('#compact')).not.toBeNull();
  });
});
