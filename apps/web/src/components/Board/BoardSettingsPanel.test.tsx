import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const media = vi.hoisted(() => ({ desktop: true, coarse: false }));

vi.mock('@/lib/media', () => ({
  useDesktop: () => media.desktop,
  useMedia: (query: string) => (query === '(pointer: coarse)' ? media.coarse : false),
}));
vi.mock('@/lib/theme', () => ({
  useThemePreference: () => ['system', vi.fn()] as const,
}));

import { BoardSettingsControls } from './BoardSettingsPanel';

beforeEach(() => {
  media.desktop = true;
  media.coarse = false;
});

it('shows Scrollbars on fine-pointer devices and hides it on coarse-pointer devices', () => {
  const { unmount } = render(<BoardSettingsControls includeTheme={false} />);
  expect(screen.getByRole('switch', { name: 'Scrollbars' })).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: 'Column backgrounds' })).toBeInTheDocument();
  unmount();

  media.coarse = true;
  render(<BoardSettingsControls includeTheme={false} />);
  expect(screen.queryByRole('switch', { name: 'Scrollbars' })).not.toBeInTheDocument();
  expect(screen.getByRole('switch', { name: 'Column backgrounds' })).toBeInTheDocument();
});

it('hides desktop-only column and rail settings on phone viewports', () => {
  media.desktop = false;
  media.coarse = true;
  render(<BoardSettingsControls includeTheme={false} />);
  expect(screen.queryByRole('switch', { name: 'Scrollbars' })).not.toBeInTheDocument();
  expect(screen.queryByRole('switch', { name: 'Column backgrounds' })).not.toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Backlog' })).not.toBeInTheDocument();
  expect(screen.getByRole('switch', { name: 'Subtasks as cards' })).toBeInTheDocument();
});
