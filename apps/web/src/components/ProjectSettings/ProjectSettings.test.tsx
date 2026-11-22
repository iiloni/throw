import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Project, Status, Task } from '@throw/shared';
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
const statusActions = vi.hoisted(() => ({
  createStatus: vi.fn(),
  deleteStatus: vi.fn(),
  makeDefaultStatus: vi.fn(),
  moveStatus: vi.fn(),
  renameStatus: vi.fn(),
  statusesOf: () => [],
}));
vi.mock('@/lib/statuses', () => statusActions);
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
  ManagementSurface: ({
    open,
    title,
    children,
  }: {
    open: boolean;
    title: string;
    children: ReactNode;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
}));

import { ProjectSettings } from './ProjectSettings';
import { StatusSettings } from './StatusSettings';

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
  for (const action of Object.values(statusActions)) if ('mockReset' in action) action.mockReset();
});

const status = (name: string, category: Status['category'], isDefault = false): Status => ({
  id: `${name}-id`,
  workspaceId: 'workspace',
  projectId: project.id,
  name,
  category,
  position: 'a0',
  isDefault,
});
const statuses = [
  status('Backlog', 'backlog', true),
  status('In progress', 'active', true),
  status('Review', 'active'),
  status('Testing', 'active'),
  status('Done', 'done', true),
  status('Cancelled', 'cancelled', true),
];
const tasksIn = (statusId: string, count: number) =>
  Array.from({ length: count }, () => ({ statusId }) as Task);

function renderStatuses(tasks: Task[] = []) {
  render(<StatusSettings projectId={project.id} statuses={statuses} tasks={tasks} />);
}
/** Opens a row's menu from the keyboard, as Radix menus open in a test document. */
function openMenu(name: string) {
  fireEvent.keyDown(screen.getByRole('button', { name: `Manage ${name}` }), { key: 'Enter' });
}

it('lists statuses by category with quiet counts and a default badge, not rule text', () => {
  renderStatuses([...tasksIn('In progress-id', 2), ...tasksIn('Review-id', 1)]);
  const active = screen.getByRole('region', { name: 'Active' });
  const rows = within(active).getAllByRole('listitem');
  expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
    'In progress',
    'Review',
    'Testing',
  ]);
  expect(rows[0]).toHaveTextContent('In progressDefault2 tasks');
  expect(rows[1]).toHaveTextContent('Review1 task');
  expect(rows[1]).not.toHaveTextContent('Default');
  expect(screen.queryByText(/Every category keeps/)).toBeNull();
  for (const name of ['Backlog', 'Active', 'Done', 'Cancelled'])
    expect(screen.getByRole('button', { name: `Add status to ${name}` })).toBeInTheDocument();
  // Only a category with more than one status has anything to reorder.
  expect(screen.getByRole('button', { name: 'Reorder Review' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reorder Backlog' })).toBeNull();
});

it('offers only the menu actions that apply to a status', async () => {
  renderStatuses();
  openMenu('In progress');
  const menu = await screen.findByRole('menu');
  expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
  expect(within(menu).queryByRole('menuitem', { name: 'Make default' })).toBeNull();
  expect(within(menu).queryByRole('menuitem', { name: 'Move up' })).toBeNull();
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'Move down' }));
  expect(statusActions.moveStatus).toHaveBeenCalledWith(
    'In progress-id',
    expect.objectContaining({ id: 'Review-id' }),
    expect.objectContaining({ id: 'Testing-id' }),
  );
});

it('makes a status the default from its menu', async () => {
  renderStatuses();
  openMenu('Testing');
  const menu = await screen.findByRole('menu');
  expect(within(menu).queryByRole('menuitem', { name: 'Move down' })).toBeNull();
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'Make default' }));
  expect(statusActions.makeDefaultStatus).toHaveBeenCalledWith('Testing-id');
});

it('moves a status with the arrow keys on its handle', () => {
  renderStatuses();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Testing' }), { key: 'ArrowUp' });
  expect(statusActions.moveStatus).toHaveBeenCalledWith(
    'Testing-id',
    expect.objectContaining({ id: 'In progress-id' }),
    expect.objectContaining({ id: 'Review-id' }),
  );
});

it('says why a status cannot be deleted when someone tries, and deletes one that can go', async () => {
  renderStatuses(tasksIn('Done-id', 12));
  openMenu('Done');
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
  const blocked = await screen.findByRole('dialog', { name: 'Can’t delete Done' });
  expect(blocked).toHaveTextContent('Every category keeps at least one status.');
  expect(blocked).toHaveTextContent('Move its 12 tasks to another status first');
  expect(within(blocked).queryByRole('button', { name: 'Delete status' })).toBeNull();
  fireEvent.click(within(blocked).getByRole('button', { name: 'OK' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  openMenu('Review');
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
  const confirm = await screen.findByRole('dialog', { name: 'Delete status?' });
  fireEvent.click(within(confirm).getByRole('button', { name: 'Delete status' }));
  expect(statusActions.deleteStatus).toHaveBeenCalledWith('Review-id');
  expect(statusActions.deleteStatus).toHaveBeenCalledTimes(1);
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
