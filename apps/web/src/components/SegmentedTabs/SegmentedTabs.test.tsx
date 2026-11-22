import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { SegmentedTabs } from './SegmentedTabs';

const options = [
  { value: 'a', id: 'tab-a', controls: 'panel-a', label: 'First', icon: null },
  { value: 'b', id: 'tab-b', controls: 'panel-b', label: 'Second', icon: null },
] as const;

it('selects a tab by click and by arrow key', () => {
  const onValueChange = vi.fn();
  render(<SegmentedTabs label="Views" value="a" onValueChange={onValueChange} options={options} />);
  const first = screen.getByRole('tab', { name: 'First' });
  expect(first).toHaveAttribute('aria-selected', 'true');
  expect(first).not.toHaveAttribute('aria-expanded');
  expect(screen.getByRole('tab', { name: 'Second' })).toHaveAttribute('tabindex', '-1');
  fireEvent.click(screen.getByRole('tab', { name: 'Second' }));
  expect(onValueChange).toHaveBeenLastCalledWith('b');
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  expect(onValueChange).toHaveBeenCalledTimes(2);
  // Without `collapsible`, choosing the selected tab again keeps it.
  fireEvent.click(first);
  expect(onValueChange).toHaveBeenCalledTimes(2);
});

function Collapsible({ initial = 'a' }: { initial?: 'a' | 'b' | null }) {
  const [value, setValue] = useState<'a' | 'b' | null>(initial);
  return (
    <SegmentedTabs
      label="Views"
      value={value}
      onValueChange={setValue}
      options={options}
      collapsible
    />
  );
}

it('hides both panels when the selected tab is chosen again, and opens either', () => {
  render(<Collapsible />);
  const first = screen.getByRole('tab', { name: 'First' });
  const second = screen.getByRole('tab', { name: 'Second' });
  expect(first).toHaveAttribute('aria-expanded', 'true');
  expect(second).toHaveAttribute('aria-expanded', 'false');

  fireEvent.click(first);
  for (const tab of [first, second]) {
    expect(tab).toHaveAttribute('aria-selected', 'false');
    expect(tab).toHaveAttribute('aria-expanded', 'false');
  }
  // Keyboard focus still enters on the tab that was open.
  expect(first).toHaveAttribute('tabindex', '0');
  expect(second).toHaveAttribute('tabindex', '-1');

  fireEvent.click(second);
  expect(second).toHaveAttribute('aria-selected', 'true');
  expect(second).toHaveAttribute('aria-expanded', 'true');
});

it('moves focus without opening a panel while both are hidden', () => {
  render(<Collapsible initial={null} />);
  const first = screen.getByRole('tab', { name: 'First' });
  const second = screen.getByRole('tab', { name: 'Second' });
  expect(first).toHaveAttribute('tabindex', '0');
  first.focus();
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  expect(second).toHaveFocus();
  expect(second).toHaveAttribute('tabindex', '0');
  expect(first).toHaveAttribute('tabindex', '-1');
  expect(second).toHaveAttribute('aria-selected', 'false');

  // Opening it, the arrows go back to switching panels.
  fireEvent.click(second);
  fireEvent.keyDown(second, { key: 'Home' });
  expect(first).toHaveFocus();
  expect(first).toHaveAttribute('aria-selected', 'true');
});

it('steps through more than two tabs with the arrows, wrapping at the ends', () => {
  const onValueChange = vi.fn();
  const three = [
    ...options,
    { value: 'c', id: 'tab-c', controls: 'panel-c', label: 'Third', icon: null },
  ] as const;
  render(<SegmentedTabs label="Views" value="b" onValueChange={onValueChange} options={three} />);
  const second = screen.getByRole('tab', { name: 'Second' });
  fireEvent.keyDown(second, { key: 'ArrowRight' });
  expect(onValueChange).toHaveBeenLastCalledWith('c');
  fireEvent.keyDown(second, { key: 'ArrowLeft' });
  expect(onValueChange).toHaveBeenLastCalledWith('a');
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Third' }), { key: 'ArrowRight' });
  expect(onValueChange).toHaveBeenLastCalledWith('a');
  fireEvent.keyDown(second, { key: 'End' });
  expect(onValueChange).toHaveBeenLastCalledWith('c');
});
