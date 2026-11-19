import { fireEvent, render, screen } from '@testing-library/react';
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
  expect(screen.getByRole('tab', { name: 'Second' })).toHaveAttribute('tabindex', '-1');
  fireEvent.click(screen.getByRole('tab', { name: 'Second' }));
  expect(onValueChange).toHaveBeenLastCalledWith('b');
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  expect(onValueChange).toHaveBeenCalledTimes(2);
});
