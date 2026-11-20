import { act, render, screen } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Collapse } from './Collapse';

beforeEach(() => {
  MotionGlobalConfig.skipAnimations = true;
});
afterEach(() => {
  MotionGlobalConfig.skipAnimations = false;
});

const frame = () => screen.getByLabelText('Content').closest('[data-collapse]');
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

it('keeps closed content mounted but hidden and unreachable', async () => {
  const onRest = vi.fn();
  const { rerender } = render(
    <Collapse open onRest={onRest}>
      <input aria-label="Content" defaultValue="Kept" />
    </Collapse>,
  );
  const input = screen.getByLabelText('Content');
  expect(frame()).toHaveAttribute('data-collapse', 'open');
  expect(frame()).not.toHaveAttribute('hidden');

  rerender(
    <Collapse open={false} onRest={onRest}>
      <input aria-label="Content" defaultValue="Kept" />
    </Collapse>,
  );
  // Closing content stays in place to fade, but can no longer be reached.
  expect(frame()).not.toHaveAttribute('hidden');
  expect(frame()).toHaveAttribute('inert');
  await settle();
  expect(frame()).toHaveAttribute('data-collapse', 'closed');
  expect(frame()).toHaveAttribute('hidden');
  expect(onRest).toHaveBeenLastCalledWith(false);
  expect(screen.getByLabelText('Content')).toBe(input);

  rerender(
    <Collapse open onRest={onRest}>
      <input aria-label="Content" defaultValue="Kept" />
    </Collapse>,
  );
  expect(frame()).not.toHaveAttribute('hidden');
  expect(frame()).not.toHaveAttribute('inert');
  await settle();
  expect(frame()).toHaveAttribute('data-collapse', 'open');
  expect(onRest).toHaveBeenLastCalledWith(true);
  expect(screen.getByLabelText('Content')).toBe(input);
});

it('swaps content in place, open or closed', async () => {
  const view = (open: boolean, key: string) => (
    <Collapse open={open} contentKey={key}>
      <input aria-label="Content" defaultValue={key} />
    </Collapse>
  );
  const { rerender } = render(view(true, 'comments'));
  rerender(view(true, 'history'));
  expect(frame()).not.toHaveAttribute('inert');
  await settle();
  expect(frame()).toHaveAttribute('data-collapse', 'open');

  rerender(view(false, 'history'));
  await settle();
  // A swap behind closed panels leaves them closed.
  rerender(view(false, 'comments'));
  await settle();
  expect(frame()).toHaveAttribute('data-collapse', 'closed');
  expect(frame()).toHaveAttribute('hidden');
});
