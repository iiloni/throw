import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GpuWarmup } from './GpuWarmup';

const HOOKS = '[role], [aria-label], [data-color], button, a, input, [tabindex]';
const findable = (container: HTMLElement) =>
  container.querySelector(HOOKS) !== null ||
  [...container.querySelectorAll('*')].some((element) =>
    [...element.attributes].some((attribute) => attribute.name.startsWith('data-')),
  );

describe('GpuWarmup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('draws its samples a moment after the app starts, then removes them', () => {
    const { container } = render(<GpuWarmup />);
    expect(container).toBeEmptyDOMElement();

    act(() => vi.advanceTimersByTime(1199));
    expect(container).toBeEmptyDOMElement();

    act(() => vi.advanceTimersByTime(1));
    const task = container.firstElementChild;
    expect(task).toHaveClass('opacity-[0.01]', 'pointer-events-none', 'fixed', 'inset-0');
    expect(task).toHaveAttribute('aria-hidden', 'true');
    expect(task).toHaveAttribute('inert');
    expect(task?.querySelector('.rounded-3xl')).not.toBeNull();
    expect(task?.querySelector('.glass-badge')).not.toBeNull();
    expect(task?.querySelector('.glass-thick')).toBeNull();

    act(() => vi.advanceTimersByTime(250));
    expect(container.querySelector('.rounded-3xl')).toBeNull();
    expect(container.querySelector('.glass-thick')).not.toBeNull();
    expect(container.querySelector('.glass')).not.toBeNull();

    act(() => vi.advanceTimersByTime(250));
    expect(container).toBeEmptyDOMElement();
  });

  it('gives a test or a screen reader nothing to find', () => {
    const { container } = render(<GpuWarmup />);
    act(() => vi.advanceTimersByTime(1200));
    expect(container.firstElementChild).not.toBeNull();
    expect(findable(container)).toBe(false);
    act(() => vi.advanceTimersByTime(250));
    expect(container.firstElementChild).not.toBeNull();
    expect(findable(container)).toBe(false);
  });

  it('draws nothing over a task that is already open', () => {
    const { container } = render(<GpuWarmup skip />);
    act(() => vi.advanceTimersByTime(1500));
    expect(container).toBeEmptyDOMElement();
  });
});
