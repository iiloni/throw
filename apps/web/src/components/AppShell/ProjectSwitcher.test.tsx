import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const surface = vi.hoisted(() => ({ dismiss: undefined as undefined | (() => boolean) }));
vi.mock('@/components/ManagementSurface/ManagementSurface', () => ({
  ManagementSurface: ({
    open,
    title,
    children,
    dismiss,
  }: {
    open: boolean;
    title: string;
    children: ReactNode;
    dismiss?: () => boolean;
  }) => {
    surface.dismiss = dismiss;
    return (
      open && (
        <section role="dialog" aria-label={title}>
          {children}
        </section>
      )
    );
  },
}));

const workspaces = [
  { id: 'w1', name: 'Personal' },
  { id: 'w2', name: 'Studio' },
];
const projects = [
  { id: 'p1', workspaceId: 'w1', name: 'Kitchen', color: 'amber', icon: null, key: 'KIT' },
  { id: 'p2', workspaceId: 'w1', name: 'Garden', color: 'teal', icon: null, key: null },
];
const shell = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));
vi.mock('@/components/AppShell/shell', () => ({ useShell: () => shell.value }));
// The pathname the router has resolved, which it sets as the next page commits.
const router = vi.hoisted(() => ({ pathname: '/w/w1/p/p1' }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ resolvedLocation: { pathname: router.pathname } }),
}));

const device = vi.hoisted(() => ({
  accounts: [
    { user: { id: 'ada', name: 'Ada', email: 'ada@example.com' }, token: 'a' },
    { user: { id: 'bob', name: '', email: 'bob@example.com' }, token: 'b' },
  ],
  switchAccount: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({
  getAccounts: () => device.accounts,
  getSignedInUser: () => device.accounts[0]?.user ?? null,
  reorderAccounts: vi.fn(),
}));
vi.mock('@/lib/accounts', () => ({
  switchAccount: device.switchAccount,
  signOutAccount: vi.fn(),
  unsyncedChanges: vi.fn(async () => 0),
}));

import { ProjectSwitcher } from './ProjectSwitcher';

function setup(overrides: Record<string, unknown> = {}) {
  const actions = {
    selectProject: vi.fn(),
    selectWorkspace: vi.fn(),
    openForm: vi.fn(),
    goBoard: vi.fn(),
    goSettings: vi.fn(),
    goProjectSettings: vi.fn(),
    goTrash: vi.fn(),
  };
  shell.value = {
    workspaces,
    projects,
    workspace: workspaces[0],
    project: projects[0],
    crossBoard: false,
    settings: false,
    ...actions,
    ...overrides,
  };
  const onClose = vi.fn();
  const view = render(<ProjectSwitcher open onClose={onClose} />);
  /** The router resolving the next page, inside its view transition. */
  const arrive = (pathname: string) => {
    router.pathname = pathname;
    view.rerender(<ProjectSwitcher open onClose={onClose} />);
  };
  return { ...actions, onClose, arrive };
}

const button = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  surface.dismiss = undefined;
  router.pathname = '/w/w1/p/p1';
});

describe('project switcher', () => {
  it('shows the projects as tiles, the open one marked', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Projects' })).toBeInTheDocument();
    expect(button('Kitchen')).toHaveAttribute('aria-current', 'page');
    expect(button('Kitchen')).toHaveAttribute('data-color', 'amber');
    expect(button('Garden')).not.toHaveAttribute('aria-current');
    expect(button('All projects')).not.toHaveAttribute('aria-current');
  });

  it('switches project, closing as the board arrives, or just closes on the open one', () => {
    const { selectProject, onClose, arrive } = setup();
    fireEvent.click(button('Garden'));
    expect(selectProject).toHaveBeenCalledWith('w1', 'p2');
    // Still open in the outgoing snapshot; the drawer closes over the cross-fade.
    expect(onClose).not.toHaveBeenCalled();
    arrive('/w/w1/p/p2');
    expect(onClose).toHaveBeenCalledOnce();
    // Only the switch that was asked for closes it.
    arrive('/w/w1/p/p1');
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.click(button('Kitchen'));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(selectProject).toHaveBeenCalledOnce();
  });

  it('opens the cross-project board, a new project and the footer’s pages', () => {
    const { goBoard, openForm, goProjectSettings, goTrash, goSettings, onClose, arrive } = setup();
    fireEvent.click(button('All projects'));
    expect(goBoard).toHaveBeenCalled();
    arrive('/w/w1/board');
    fireEvent.click(button('New project'));
    expect(openForm).toHaveBeenCalledWith({ kind: 'new-project', workspace: workspaces[0] });
    fireEvent.click(button('Project settings'));
    expect(goProjectSettings).toHaveBeenCalledWith(projects[0]);
    fireEvent.click(button('Workspace trash'));
    expect(goTrash).toHaveBeenCalledWith();
    fireEvent.click(button('Settings'));
    expect(goSettings).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(5);
  });

  it('marks All projects on the cross-project board, without project settings', () => {
    const { goBoard } = setup({ crossBoard: true, project: undefined });
    expect(button('All projects')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: 'Project settings' })).toBeNull();
    fireEvent.click(button('All projects'));
    expect(goBoard).not.toHaveBeenCalled();
  });

  it('switches, makes and renames workspaces from their own view, which Back leaves', () => {
    const { selectWorkspace, openForm, onClose, arrive } = setup();
    fireEvent.click(button('Workspace: Personal'));
    expect(screen.getByRole('dialog', { name: 'Workspaces' })).toBeInTheDocument();
    expect(button('Personal')).toHaveAttribute('aria-current', 'true');
    fireEvent.click(button('Studio'));
    expect(selectWorkspace).toHaveBeenCalledWith('w2');
    expect(onClose).not.toHaveBeenCalled();
    arrive('/w/w2/p/p9');
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.click(button('New workspace'));
    expect(openForm).toHaveBeenCalledWith({ kind: 'new-workspace' });
    fireEvent.click(button('Rename workspace'));
    expect(openForm).toHaveBeenCalledWith({ kind: 'edit-workspace', workspace: workspaces[0] });

    let handled = false;
    act(() => {
      handled = surface.dismiss?.() ?? false;
    });
    expect(handled).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Projects' })).toBeInTheDocument();
    expect(surface.dismiss?.()).toBe(false);
  });

  it('lists the device’s accounts in their own view, switching by a tap or a swipe', () => {
    const { onClose } = setup();
    const account = button('Account: Ada');
    expect(account).toHaveTextContent('2');
    act(() => {
      fireEvent.pointerDown(account, { pointerId: 1, button: 0, clientX: 40, clientY: 10 });
      fireEvent.pointerMove(account, { pointerId: 1, clientX: 0, clientY: 10 });
      fireEvent.pointerUp(account, { pointerId: 1, clientX: 0, clientY: 10 });
      fireEvent.click(account);
    });
    expect(device.switchAccount).toHaveBeenCalledWith('bob');
    expect(screen.getByRole('dialog', { name: 'Projects' })).toBeInTheDocument();

    device.switchAccount.mockClear();
    fireEvent.click(button('Account: Ada'));
    expect(screen.getByRole('dialog', { name: 'Accounts' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add account' })).toHaveAttribute('href', '/login');
    fireEvent.click(button('bob@example.com'));
    expect(device.switchAccount).toHaveBeenCalledWith('bob');
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      surface.dismiss?.();
    });
    expect(screen.getByRole('dialog', { name: 'Projects' })).toBeInTheDocument();
  });
});
