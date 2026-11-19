import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { AnimatedHeight } from './AnimatedHeight';

it('renders its content inside a clipping frame', () => {
  render(
    <AnimatedHeight anchor="top">
      <p>Content</p>
    </AnimatedHeight>,
  );
  const frame = screen.getByText('Content').parentElement?.parentElement;
  expect(frame).toHaveClass('overflow-hidden', 'justify-start');
});
