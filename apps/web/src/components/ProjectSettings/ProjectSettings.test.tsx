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
const actions = vi.hoisted(() => ({ setPriorityNames: vi.fn(), changeProjectKey: vi.fn() }));
vi.mock('@/lib/projects', () => actions);
vi.mock('@/lib/collections', () => ({
  useProjects: () => ({ projects: [project], isLoading: false }),
  useStatuses: () => ({ statuses: [], isLoading: false }),
  useTasks: () => ({ tasks: [], isLoading: false }),
}));
vi.mock('@/lib/syncStatus', () => ({ useAwaitingSync: () => false }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock('@/components/TagManager/TagManager', () => ({ TagManager: () => null }));
vi.mock('@/components/ShellForms/ShellForms', () => ({ ManagementForm: () => null }));
vi.mock('@/components/ManagementSurface/ManagementSurface', () => ({
  ManagementSurface: () => null,
}));

import { ProjectSettings } from './ProjectSettings';

beforeEach(() => actions.setPriorityNames.mockReset());

it('saves every priority name in one change, trimmed', () => {
  render(<ProjectSettings project={project} section="priorities" onSectionChange={() => {}} />);
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
  render(<ProjectSettings project={project} section="priorities" onSectionChange={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Use default names' }));
  expect(screen.getByRole('textbox', { name: 'Rank 1 name' })).toHaveValue('');
  expect(actions.setPriorityNames).not.toHaveBeenCalled();
});
