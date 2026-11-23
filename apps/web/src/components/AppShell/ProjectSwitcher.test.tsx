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
  render(<ProjectSwitcher open onClose={onClose} />);
  return { ...actions, onClose };
}

const button = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  surface.dismiss = undefined;
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

  it('switches project, or just closes on the open one', () => {
    const { selectProject, onClose } = setup();
    fireEvent.click(button('Garden'));
    expect(onClose).toHaveBeenCalledOnce();
    expect(selectProject).toHaveBeenCalledWith('w1', 'p2');
    fireEvent.click(button('Kitchen'));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(selectProject).toHaveBeenCalledOnce();
  });

  it('opens the cross-project board, a new project and the footer’s pages', () => {
    const { goBoard, openForm, goProjectSettings, goTrash, goSettings, onClose } = setup();
    fireEvent.click(button('All projects'));
    expect(goBoard).toHaveBeenCalled();
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
    const { selectWorkspace, openForm } = setup();
    fireEvent.click(button('Workspace: Personal'));
    expect(screen.getByRole('dialog', { name: 'Workspaces' })).toBeInTheDocument();
    expect(button('Personal')).toHaveAttribute('aria-current', 'true');
    fireEvent.click(button('Studio'));
    expect(selectWorkspace).toHaveBeenCalledWith('w2');
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
});
