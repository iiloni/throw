import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ThemePicker } from './ThemePicker';

it('marks the chosen theme and reports only a different one', () => {
  const onChange = vi.fn();
  render(<ThemePicker value="light" onChange={onChange} />);
  expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'Light' }));
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
  expect(onChange).toHaveBeenCalledWith('dark');
});
