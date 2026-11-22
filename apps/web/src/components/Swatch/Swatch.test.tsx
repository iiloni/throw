import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Swatch } from './Swatch';

it('picks its color when pressed', () => {
  const onClick = vi.fn();
  render(<Swatch color="teal" label="Teal" pressed={false} onClick={onClick} />);
  const swatch = screen.getByRole('button', { name: 'Teal' });
  expect(swatch).toHaveAttribute('data-color', 'teal');
  expect(swatch).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(swatch);
  expect(onClick).toHaveBeenCalledOnce();
});

it('keeps an unavailable color focusable, says why and ignores presses', () => {
  const onClick = vi.fn();
  render(
    <Swatch
      color="red"
      label="Red"
      hint="Red: already used by another root"
      pressed={false}
      unavailable
      onClick={onClick}
    />,
  );
  const swatch = screen.getByRole('button', { name: 'Red' });
  expect(swatch).toHaveAttribute('aria-disabled', 'true');
  expect(swatch).toHaveAccessibleDescription('Red: already used by another root');
  fireEvent.click(swatch);
  expect(onClick).not.toHaveBeenCalled();
});
