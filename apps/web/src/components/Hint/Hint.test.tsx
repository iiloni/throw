import { act, fireEvent, render, screen } from '@testing-library/react';
import { DropdownMenu } from 'radix-ui';
import { expect, it } from 'vitest';
import { Hint } from './Hint';

it('shows on keyboard focus and leaves the name to the element', async () => {
  render(
    <Hint label="Search">
      <button type="button" aria-label="Search" />
    </Hint>,
  );
  const button = screen.getByRole('button', { name: 'Search' });
  act(() => button.focus());
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Search');
  expect(button).not.toHaveAttribute('title');
  act(() => button.blur());
  expect(screen.queryByRole('tooltip')).toBeNull();
});

it('stays closed while disabled, keeping the element mounted', () => {
  const { rerender } = render(
    <Hint label="Projects" disabled>
      <button type="button">Projects</button>
    </Hint>,
  );
  const button = screen.getByRole('button');
  act(() => button.focus());
  expect(screen.queryByRole('tooltip')).toBeNull();
  rerender(
    <Hint label="Projects">
      <button type="button">Projects</button>
    </Hint>,
  );
  expect(screen.getByRole('button')).toBe(button);
  expect(button).toHaveFocus();
});

it('shows a hint for cut-short text only while the text is cut short', async () => {
  render(
    <Hint label="A long project name" whenTruncated>
      <button type="button">
        <span className="truncate">A long project name</span>
      </button>
    </Hint>,
  );
  const button = screen.getByRole('button');
  const text = screen.getByText('A long project name');
  act(() => button.focus());
  expect(screen.queryByRole('tooltip')).toBeNull();
  act(() => button.blur());
  Object.defineProperty(text, 'scrollWidth', { value: 200 });
  Object.defineProperty(text, 'clientWidth', { value: 120 });
  act(() => button.focus());
  expect(await screen.findByRole('tooltip')).toHaveTextContent('A long project name');
});

it('describes the element when the hint says more than its name', () => {
  render(
    <Hint label="D, E" describe>
      <span>+2</span>
    </Hint>,
  );
  expect(screen.getByText('+2')).toHaveAccessibleDescription('D, E');
});

it('stays out of the way of a held pointer, such as a card being dragged over it', () => {
  render(
    <Hint label="Priority: Urgent">
      <span role="img" aria-label="Priority: Urgent" />
    </Hint>,
  );
  const glyph = screen.getByRole('img');
  const held = new MouseEvent('pointermove', { bubbles: true, cancelable: true, buttons: 1 });
  fireEvent(glyph, held);
  expect(held.defaultPrevented).toBe(true);
  const free = new MouseEvent('pointermove', { bubbles: true, cancelable: true });
  fireEvent(glyph, free);
  expect(free.defaultPrevented).toBe(false);
});

it('can be the child of another trigger, such as a menu’s', async () => {
  render(
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Hint label="Work" describe>
          <button type="button" aria-label="Switch workspace" />
        </Hint>
      </DropdownMenu.Trigger>
    </DropdownMenu.Root>,
  );
  const button = screen.getByRole('button', { name: 'Switch workspace' });
  expect(button).toHaveAttribute('aria-haspopup', 'menu');
  expect(button).toHaveAccessibleDescription('Work');
  act(() => button.focus());
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Work');
});
