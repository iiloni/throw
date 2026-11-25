import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { usePagerPage } from './usePagerPage';

const held = vi.hoisted(() => ({ current: null as object | null }));
const tick = vi.hoisted(() => vi.fn());
vi.mock('./drag', () => ({ drag: { get: () => held.current }, pageStride: () => 100 }));
vi.mock('@/lib/haptics', () => ({ haptics: { selection: tick } }));

beforeEach(() => {
  held.current = null;
  tick.mockClear();
});

function Pager() {
  const [page, pager, quiet, place] = usePagerPage();
  return (
    <>
      <div data-testid="pager" {...pager} />
      <button type="button" onClick={quiet}>
        Turn from code
      </button>
      <button type="button" onClick={() => place(3)}>
        Place from code
      </button>
      <output>{page}</output>
    </>
  );
}

function scrollTo(left: number) {
  const pager = screen.getByTestId('pager');
  pager.scrollLeft = left;
  fireEvent.scroll(pager);
}

it('ticks each new page a finger turns, once', () => {
  render(<Pager />);
  fireEvent.touchStart(screen.getByTestId('pager'));
  scrollTo(40);
  expect(tick).not.toHaveBeenCalled();
  scrollTo(100);
  scrollTo(110);
  expect(tick).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status')).toHaveTextContent('1');
});

it('stays quiet for turns made from code, and while a held card turns the pages', () => {
  render(<Pager />);
  fireEvent.click(screen.getByRole('button', { name: 'Turn from code' }));
  scrollTo(100);
  fireEvent.touchStart(screen.getByTestId('pager'));
  held.current = {};
  scrollTo(200);
  expect(tick).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('2');
  // Momentum ends what the finger started; a later turn from code is quiet again.
  held.current = null;
  fireEvent(screen.getByTestId('pager'), new Event('scrollend'));
  scrollTo(300);
  expect(tick).not.toHaveBeenCalled();
});

it('shows a page placed from code at once, and does not tick when the scroll catches up', () => {
  render(<Pager />);
  fireEvent.touchStart(screen.getByTestId('pager'));
  fireEvent.click(screen.getByRole('button', { name: 'Place from code' }));
  expect(screen.getByRole('status')).toHaveTextContent('3');
  scrollTo(300);
  expect(tick).not.toHaveBeenCalled();
});
