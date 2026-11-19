import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ProjectIconPicker } from './ProjectIconPicker';

it('marks the chosen icon, finds icons by name and offers the default only unfiltered', () => {
  const onChange = vi.fn();
  render(<ProjectIconPicker value="house" color="blue" onChange={onChange} />);
  expect(screen.getByRole('button', { name: 'Home icon' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Default icon' }));
  expect(onChange).toHaveBeenCalledWith(null);
  fireEvent.change(screen.getByLabelText('Find an icon'), { target: { value: 'hom' } });
  expect(screen.queryByRole('button', { name: 'Default icon' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('button')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Home icon' }));
  expect(onChange).toHaveBeenLastCalledWith('house');
});
