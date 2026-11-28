import { fireEvent, render, screen } from '@testing-library/react';
import { createContext, type ReactNode, useCallback, useContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/haptics', () => ({ haptics: { selection: vi.fn(), toggle: vi.fn() } }));
vi.mock('motion/react', async (original) => ({
  ...(await original<typeof import('motion/react')>()),
  useReducedMotion: () => true,
}));

import type { DrawerPage } from './Drawer';
import {
  DrawerBridge,
  DrawerHost,
  type DrawerSlot,
  useDrawerSlot,
  useLentDrawerPage,
  useLentDrawerPageOpen,
} from './DrawerHost';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const drawer = () => document.querySelector<HTMLElement>('[data-drawer]');

function Screen({ slot }: { slot: DrawerSlot | null }) {
  useDrawerSlot(slot);
  return <button type="button">Board</button>;
}

function Lender({ page, onClose }: { page: DrawerPage | null; onClose: () => void }) {
  useLentDrawerPage(page, onClose);
  const open = useLentDrawerPageOpen();
  return <p>{open ? 'Lent open' : 'Nothing lent'}</p>;
}

const board = (name: string): DrawerSlot => ({
  label: name,
  face: 'board',
  dock: <button type="button">{name} dock</button>,
});

describe('DrawerHost', () => {
  it('keeps one drawer as the screens showing in it change', () => {
    const { rerender } = render(
      <DrawerHost enabled>
        <Screen key="a" slot={board('Project')} />
      </DrawerHost>,
    );
    const first = drawer();
    expect(first).toHaveAccessibleName('Project');
    expect(screen.getByRole('button', { name: 'Project dock' })).toBeInTheDocument();

    rerender(
      <DrawerHost enabled>
        <Screen key="b" slot={board('All projects')} />
      </DrawerHost>,
    );
    expect(drawer()).toBe(first);
    expect(first).toHaveAccessibleName('All projects');
    expect(screen.getByRole('button', { name: 'All projects dock' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Project dock' })).toBeNull();
  });

  it('sinks out of sight with no dock, and is inert there', () => {
    const { rerender } = render(
      <DrawerHost enabled>
        <Screen slot={null} />
      </DrawerHost>,
    );
    expect(drawer()).toHaveAttribute('data-sunk');
    expect(drawer()!.closest('[inert]')).not.toBeNull();
    rerender(
      <DrawerHost enabled>
        <Screen slot={board('Settings')} />
      </DrawerHost>,
    );
    expect(drawer()).not.toHaveAttribute('data-sunk');
    expect(drawer()!.closest('[inert]')).toBeNull();
  });

  it('shows the newest screen, and an earlier one again once it goes', () => {
    const { rerender } = render(
      <DrawerHost enabled>
        <Screen slot={board('Settings')} />
        <Screen slot={board('Board')} />
      </DrawerHost>,
    );
    expect(drawer()).toHaveAccessibleName('Board');
    rerender(
      <DrawerHost enabled>
        <Screen slot={board('Settings')} />
      </DrawerHost>,
    );
    expect(drawer()).toHaveAccessibleName('Settings');
  });

  it('lends a page over the screen’s, with the screen inert, and gives the drawer back', () => {
    const onClose = vi.fn();
    const form: DrawerPage = { key: 'form', title: 'New project', content: <p>Form</p> };
    const view = (page: DrawerPage | null) => (
      <DrawerHost enabled>
        <Screen slot={board('Backlog')} />
        <Lender page={page} onClose={onClose} />
      </DrawerHost>
    );
    const { rerender } = render(view(form));
    const dialog = screen.getByRole('dialog', { name: 'New project' });
    expect(dialog).toHaveTextContent('Form');
    expect(screen.getByText('Lent open')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Board', hidden: true }).closest('[inert]')).not.toBe(
      null,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();

    rerender(view(null));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(drawer()).toHaveAccessibleName('Backlog');
    expect(screen.getByText('Nothing lent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Board' }).closest('[inert]')).toBeNull();
  });

  it('carries a boundary’s contexts to the content it draws in the shell', () => {
    const Name = createContext('the shell');
    function Dock() {
      return <p>Dock of {useContext(Name)}</p>;
    }
    function Bridge({ children }: { children: ReactNode }) {
      const name = useContext(Name);
      const wrap = useCallback(
        (node: ReactNode) => <Name.Provider value={name}>{node}</Name.Provider>,
        [name],
      );
      return <DrawerBridge wrap={wrap}>{children}</DrawerBridge>;
    }
    render(
      <DrawerHost enabled>
        <Name.Provider value="the board">
          <Bridge>
            <Screen slot={{ label: 'Board', dock: <Dock /> }} />
          </Bridge>
        </Name.Provider>
      </DrawerHost>,
    );
    expect(screen.getByText('Dock of the board')).toBeInTheDocument();
  });

  it('draws no drawer when it is off, and lends nothing', () => {
    const form: DrawerPage = { key: 'form', title: 'Rename', content: <p>Form</p> };
    render(
      <DrawerHost enabled={false}>
        <Screen slot={board('Board')} />
        <Lender page={form} onClose={() => {}} />
      </DrawerHost>,
    );
    expect(drawer()).toBeNull();
    expect(screen.getByText('Nothing lent')).toBeInTheDocument();
  });
});
