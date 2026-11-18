import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const media = vi.hoisted(() => ({ wide: false, fractional: false }));
// A fractional width between the breakpoints matches neither query.
vi.mock('@/lib/media', () => ({
  useDesktop: () => !media.fractional && media.wide,
}));
vi.mock('@/components/Drawer/Drawer', () => ({
  Drawer: ({
    page,
    onClosePage,
  }: {
    page: { title: string; content: ReactNode } | null;
    onClosePage: () => void;
  }) =>
    page && (
      <section role="dialog" aria-label={page.title}>
        {page.content}
        <button type="button" onClick={onClosePage}>
          Close drawer
        </button>
      </section>
    ),
}));
vi.mock('@/components/BottomSheet/BottomSheet', () => ({
  BottomSheet: ({ open, title, children }: { open: boolean; title: string; children: ReactNode }) =>
    open && (
      <section role="dialog" aria-label={`Sheet: ${title}`}>
        {children}
      </section>
    ),
}));

import { ManagementSurface, ManagementSurfaceProvider } from './ManagementSurface';

function Screen({ onClose = () => {} }: { onClose?: () => void }) {
  return (
    <ManagementSurfaceProvider active>
      <button type="button">Behind</button>
      <ManagementSurface open title="Rename" onClose={onClose}>
        <p>Form</p>
      </ManagementSurface>
    </ManagementSurfaceProvider>
  );
}

beforeEach(() => {
  media.wide = false;
  media.fractional = false;
});

it('shows a phone surface in the shell’s drawer, with the screen behind it inert', () => {
  const onClose = vi.fn();
  render(<Screen onClose={onClose} />);
  expect(screen.getByRole('dialog', { name: 'Rename' })).toHaveTextContent('Form');
  expect(screen.getByText('Behind').closest('[inert]')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
  expect(onClose).toHaveBeenCalled();
});

it('uses a centred dialog on a desktop', () => {
  media.wide = true;
  render(<Screen />);
  expect(screen.getByRole('dialog', { name: 'Sheet: Rename' })).toHaveTextContent('Form');
  expect(screen.getByText('Behind').closest('[inert]')).toBeNull();
});

it('still shows the surface at a width between the two breakpoints', () => {
  media.fractional = true;
  render(<Screen />);
  expect(screen.getByRole('dialog', { name: 'Rename' })).toHaveTextContent('Form');
});
