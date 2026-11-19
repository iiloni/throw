import { fireEvent, render, screen } from '@testing-library/react';
import type { Project } from '@throw/shared';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const project: Project = {
  id: 'project',
  workspaceId: 'workspace',
  name: 'Kitchen',
  key: 'KIT',
  color: 'teal',
  icon: null,
  position: 'a0',
  deletedAt: null,
  priorityNames: ['Now', '', '', '', 'Someday'],
};
const actions = vi.hoisted(() => ({
  setPriorityNames: vi.fn(),
  changeProjectKey: vi.fn(),
  updateProject: vi.fn(),
  trashProject: vi.fn(),
}));
vi.mock('@/lib/projects', () => actions);
vi.mock('@/lib/collections', () => ({
  useProjects: () => ({ projects: [project], isLoading: false }),
  useStatuses: () => ({ statuses: [], isLoading: false }),
  useTasks: () => ({ tasks: [], isLoading: false }),
}));
vi.mock('@/lib/syncStatus', () => ({ useAwaitingSync: () => false }));
vi.mock('@/components/AppShell/shell', () => ({ useShell: () => ({ selectWorkspace: vi.fn() }) }));
vi.mock('@/components/SettingsLayout/SettingsLayout', () => ({
  SettingsLayout: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/lib/media', () => ({ useDesktop: () => true }));
vi.mock('@/components/TagManager/TagManager', () => ({ TagManager: () => null }));
vi.mock('@/components/ManagementSurface/ManagementSurface', () => ({
  ManagementSurface: () => null,
}));

import { ProjectSettings } from './ProjectSettings';

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
});

it('saves every priority name in one change, trimmed', () => {
  render(<ProjectSettings project={project} section="priorities" />);
  const save = screen.getByRole('button', { name: 'Save priority names' });
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: 'Rank 1 name' }), {
    target: { value: ' Today ' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Rank 3 name' }), {
    target: { value: 'Soon' },
  });
  fireEvent.click(save);
  expect(actions.setPriorityNames).toHaveBeenCalledTimes(1);
  expect(actions.setPriorityNames).toHaveBeenCalledWith(project.id, [
    'Today',
    '',
    'Soon',
    '',
    'Someday',
  ]);
});

it('puts back the default names for review before saving', () => {
  render(<ProjectSettings project={project} section="priorities" />);
  fireEvent.click(screen.getByRole('button', { name: 'Use default names' }));
  expect(screen.getByRole('textbox', { name: 'Rank 1 name' })).toHaveValue('');
  expect(actions.setPriorityNames).not.toHaveBeenCalled();
});

it('saves appearance as it changes, and a name only once left with a real change', () => {
  render(<ProjectSettings project={project} section="general" />);
  const name = screen.getByLabelText('Project name');
  fireEvent.change(name, { target: { value: 'Kitchen' } });
  fireEvent.blur(name);
  fireEvent.change(name, { target: { value: '   ' } });
  fireEvent.blur(name);
  expect(name).toHaveValue('Kitchen');
  fireEvent.change(name, { target: { value: 'Draft' } });
  fireEvent.keyDown(name, { key: 'Escape' });
  expect(name).toHaveValue('Kitchen');
  expect(actions.updateProject).not.toHaveBeenCalled();
  fireEvent.change(name, { target: { value: ' Kitchen refit ' } });
  fireEvent.blur(name);
  expect(actions.updateProject).toHaveBeenCalledWith(project.id, { name: 'Kitchen refit' });
  fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
  expect(actions.updateProject).toHaveBeenLastCalledWith(project.id, { color: 'blue' });
  fireEvent.click(screen.getByRole('button', { name: 'Home icon' }));
  expect(actions.updateProject).toHaveBeenLastCalledWith(project.id, { icon: 'house' });
});
