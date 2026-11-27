import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const updates = vi.hoisted(() => ({ android: false, target: null as string | null }));
vi.mock('@/lib/updates', () => ({ useAndroidUpdateAvailable: () => updates.android }));
vi.mock('@/lib/webUpdates', () => ({ useWebUpdates: () => ({ target: updates.target }) }));

import { UpdateDot } from './UpdateDot';

const dot = (container: HTMLElement) => container.querySelector('[data-update-dot]');

beforeEach(() => {
  updates.android = false;
  updates.target = null;
});

describe('UpdateDot', () => {
  it('draws nothing while no update is waiting', () => {
    const { container } = render(<UpdateDot />);
    expect(container).toBeEmptyDOMElement();
  });

  it('marks a newer Android app', () => {
    updates.android = true;
    const { container } = render(<UpdateDot className="ml-auto" />);
    expect(dot(container)).toHaveClass('bg-brand', 'ml-auto');
  });

  it('marks a web build ready to load, only drawn so its control keeps its name', () => {
    updates.target = 'build-2';
    const { container } = render(<UpdateDot />);
    expect(dot(container)).toHaveAttribute('aria-hidden', 'true');
    expect(container).toHaveTextContent('');
  });
});
