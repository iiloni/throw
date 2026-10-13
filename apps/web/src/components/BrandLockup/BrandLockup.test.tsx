import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BrandLockup } from './BrandLockup';

const state = vi.hoisted(() => ({ theme: 'light', resize: (_width: number) => {} }));
vi.mock('@/lib/theme', () => ({ useResolvedTheme: () => state.theme }));

beforeEach(() => {
  state.theme = 'light';
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        state.resize = (width) =>
          callback([{ contentRect: { width } } as ResizeObserverEntry], this as ResizeObserver);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

it.each(['stable', 'preview', 'dev'] as const)(
  'uses identical lettering with %s artwork and follows the surface theme',
  (channel) => {
    const { rerender } = render(
      <BrandLockup orientation="horizontal" iconSize={48} channel={channel} />,
    );
    expect(screen.getByRole('img', { name: 'Throw' })).toHaveAttribute(
      'src',
      `/wordmarks/throw-lockup-horizontal-${channel}-dark-small.svg`,
    );
    state.theme = 'dark';
    rerender(<BrandLockup orientation="stacked" iconSize={96} channel={channel} />);
    expect(screen.getByRole('img', { name: 'Throw' })).toHaveAttribute(
      'src',
      `/wordmarks/throw-lockup-stacked-${channel}-light-small.svg`,
    );
    expect(screen.getAllByRole('img')).toHaveLength(1);
    rerender(<BrandLockup orientation="stacked" iconSize={96} channel={channel} surface="light" />);
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      `/wordmarks/throw-lockup-stacked-${channel}-dark-small.svg`,
    );
  },
);

it.each([
  [40, '-micro'],
  [48, '-small'],
  [127, '-small'],
  [128, ''],
] as const)(
  'selects the tier from a %i CSS px icon, even on retina displays',
  (iconSize, suffix) => {
    vi.stubGlobal('devicePixelRatio', 3);
    render(<BrandLockup orientation="horizontal" iconSize={iconSize} />);
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      `/wordmarks/throw-lockup-horizontal-stable-dark${suffix}.svg`,
    );
  },
);

it('changes detail and falls back to an icon when the container becomes too narrow', () => {
  render(<BrandLockup orientation="horizontal" iconSize={128} channel="preview" />);
  act(() => state.resize(193));
  expect(screen.getByRole('img')).toHaveAttribute(
    'src',
    '/wordmarks/throw-lockup-horizontal-preview-dark-small.svg',
  );
  act(() => state.resize(164));
  expect(screen.getByRole('img')).toHaveAttribute(
    'src',
    '/wordmarks/throw-lockup-horizontal-preview-dark-micro.svg',
  );
  act(() => state.resize(100));
  expect(screen.getByRole('img')).toHaveAttribute('src', '/preview/icon-small.svg');
  act(() => state.resize(44));
  expect(screen.getByRole('img')).toHaveAttribute('src', '/preview/favicon-mark.svg');
  expect(screen.getAllByRole('img')).toHaveLength(1);
});

it('uses icon-only artwork below the stacked minimum', () => {
  render(<BrandLockup orientation="stacked" iconSize={64} />);
  act(() => state.resize(110));
  expect(screen.getByRole('img')).toHaveAttribute('src', '/icon-small.svg');
});
