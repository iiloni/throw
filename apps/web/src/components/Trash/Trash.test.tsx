import { fireEvent, render, screen } from '@testing-library/react';
import type { Project, Task } from '@throw/shared';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const deletedAt = '2026-10-14T12:00:00Z';
const project: Project = {
  id: 'project',
  workspaceId: 'workspace',
  name: 'Kitchen',
  key: 'KIT',
  color: 'teal',
  icon: null,
  position: 'a0',
  deletedAt: null,
  priorityNames: ['', '', '', '', ''],
};
const task = (id: string, fields: Partial<Task> = {}): Task => ({
  id,
  projectId: project.id,
  workspaceId: project.workspaceId,
  number: 1,
  title: id,
  description: null,
  descriptionVersion: null,
  statusId: 'status',
  priority: 3,
  size: null,
  position: 'a0',
  parentId: null,
  primaryTagId: null,
  closedAt: null,
  deletedAt: null,
  createdAt: deletedAt,
  ...fields,
});
const data = vi.hoisted(() => ({ projects: [] as Project[], tasks: [] as Task[] }));
const actions = vi.hoisted(() => ({
  emptyTrash: vi.fn(),
  emptyProjectTrash: vi.fn(),
  purgeTask: vi.fn(),
  restoreTask: vi.fn(),
}));
vi.mock('@/components/AppShell/shell', () => ({
  useShell: () => ({ workspace: { id: 'workspace' } }),
}));
vi.mock('@/lib/collections', () => ({
  useProjects: () => ({ projects: data.projects, isLoading: false }),
  useTasks: () => ({ tasks: data.tasks, isLoading: false }),
}));
vi.mock('@/lib/syncStatus', () => ({ useAwaitingSync: () => false }));
vi.mock('@/lib/tasks', () => actions);
vi.mock('@/lib/projects', () => ({ purgeProject: vi.fn(), restoreProject: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock('@/components/ManagementSurface/ManagementSurface', () => ({
  ManagementSurface: ({
    open,
    title,
    children,
  }: {
    open: boolean;
    title: string;
    children: ReactNode;
  }) =>
    open && (
      <section role="dialog" aria-label={title}>
        {children}
      </section>
    ),
}));

import { Trash } from './Trash';

beforeEach(() => {
  data.projects = [project];
  data.tasks = [];
  for (const action of Object.values(actions)) action.mockReset();
});

it('lists what emptying would remove, even a subtask whose parent has not synced', () => {
  data.tasks = [
    task('Old idea', { deletedAt }),
    task('Orphan step', { parentId: 'not-here', deletedAt }),
    task('Kept', {}),
  ];
  render(<Trash />);
  const listed = screen.getByRole('region', { name: 'Trashed tasks' });
  expect(listed).toHaveTextContent('Old idea');
  expect(listed).toHaveTextContent('Orphan step');
  expect(listed).not.toHaveTextContent('Kept');
  fireEvent.click(screen.getByRole('button', { name: 'Empty trash' }));
  const confirm = screen.getByRole('dialog', { name: 'Empty the trash?' });
  expect(confirm).toHaveTextContent('Remove all 2 listed items');
  fireEvent.click(screen.getByRole('button', { name: 'Empty trash for good' }));
  expect(actions.emptyTrash).toHaveBeenCalledWith('workspace');
});

it('says so when the trash is empty, with nothing to confirm', () => {
  data.tasks = [task('Kept')];
  render(<Trash projectId={project.id} />);
  expect(screen.getByText('The trash is empty.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Empty trash' })).toBeDisabled();
});
