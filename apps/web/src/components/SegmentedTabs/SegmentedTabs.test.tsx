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

it('navigates across three tabs and skips a hidden third tab', () => {
  const onValueChange = vi.fn();
  const three = (hideThird: boolean) => [
    { value: 'a', id: 't-a', controls: 'p-a', label: 'Comments', icon: null },
    { value: 'b', id: 't-b', controls: 'p-b', label: 'History', icon: null },
    { value: 'c', id: 't-c', controls: 'p-c', label: 'Links', icon: null, hidden: hideThird },
  ];
  const { rerender } = render(
    <SegmentedTabs label="Tabs" value="a" onValueChange={onValueChange} options={three(false)} />,
  );
  expect(screen.getAllByRole('tab')).toHaveLength(3);
  const first = screen.getByRole('tab', { name: 'Comments' });
  fireEvent.keyDown(first, { key: 'End' });
  expect(onValueChange).toHaveBeenLastCalledWith('c');
  rerender(
    <SegmentedTabs label="Tabs" value="c" onValueChange={onValueChange} options={three(false)} />,
  );
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Links' }), { key: 'ArrowRight' });
  expect(onValueChange).toHaveBeenLastCalledWith('a');

  // Hiding the third tab removes it from the accessible tablist and wraps between the first two.
  rerender(
    <SegmentedTabs label="Tabs" value="b" onValueChange={onValueChange} options={three(true)} />,
  );
  expect(screen.getAllByRole('tab')).toHaveLength(2);
  fireEvent.keyDown(screen.getByRole('tab', { name: 'History' }), { key: 'ArrowRight' });
  expect(onValueChange).toHaveBeenLastCalledWith('a');
});

it('switches to compact icon-only inactive tabs below 368px only when three tabs are visible', () => {
  const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 320,
    bottom: 44,
    width: 320,
    height: 44,
    toJSON: () => {},
  });
  try {
    const three = (hideThird: boolean) => [
      { value: 'a', id: 'c-a', controls: 'cp-a', label: 'Comments', icon: null },
      { value: 'b', id: 'c-b', controls: 'cp-b', label: 'History', icon: null },
      { value: 'c', id: 'c-c', controls: 'cp-c', label: 'Links', icon: null, hidden: hideThird },
    ];
    const { rerender } = render(
      <SegmentedTabs label="Compact" value="a" onValueChange={vi.fn()} options={three(false)} />,
    );
    const list = screen.getByRole('tablist', { name: 'Compact' });
    expect(list).toHaveAttribute('data-compact', '');
    // All three accessible names remain intact even when inactive tabs collapse visually to icons.
    expect(screen.getByRole('tab', { name: 'History' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Links' })).toBeInTheDocument();

    rerender(
      <SegmentedTabs label="Compact" value="a" onValueChange={vi.fn()} options={three(true)} />,
    );
    expect(list).not.toHaveAttribute('data-compact');
  } finally {
    spy.mockRestore();
  }
});
