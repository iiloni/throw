import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Project, Status, Task } from '@throw/shared';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TaskDetails } from './TaskDetails';

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const fake = vi.hoisted(() => ({
  trashTask: vi.fn(),
  restoreTask: vi.fn(),
  leaveTask: vi.fn(),
  hapticsWarning: vi.fn(),
  hapticsSuccess: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: fake.toast }));
vi.mock('@/lib/tasks', () => ({
  createTask: vi.fn(),
  restoreTask: fake.restoreTask,
  sendTask: vi.fn(),
  trashTask: fake.trashTask,
}));
vi.mock('@/lib/haptics', () => ({
  haptics: { warning: fake.hapticsWarning, success: fake.hapticsSuccess },
}));
vi.mock('@/lib/collections', () => ({
  useTags: () => ({ tags: [], isLoading: false }),
  useTaskTags: () => ({ taskTags: [], isLoading: false }),
}));
vi.mock('@/components/Board/state', () => ({
  board: { use: () => ({ taskTrail: [], openTaskId: 'task-1' }) },
  canOpenTask: () => true,
  current: () => ({ project: { id: 'project-1', statuses: [] }, tasks: [], hiddenTasks: [] }),
  leaveTask: fake.leaveTask,
  openNewSubtask: vi.fn(),
  openSubtask: vi.fn(),
  update: vi.fn(),
}));
vi.mock('@/components/Board/TaskView', () => ({
  cardSurface: '',
  TaskTitle: ({ task }: { task: { title: string } }) => <h1>{task.title}</h1>,
}));
vi.mock('@/components/TaskRelations/TaskRelations', () => ({
  TaskRelations: () => null,
  useRelationGroups: () => ({ groups: [], isLoading: false }),
}));
vi.mock('./TaskDescription', () => ({ TaskDescription: () => null }));
vi.mock('./TaskDrawer', () => ({ TaskDrawer: () => null }));
vi.mock('./TaskTimeline', () => ({
  TaskRefusalNotice: () => null,
  TaskTimeline: () => null,
}));

const project: Project = {
  id: 'project-1',
  workspaceId: 'workspace-1',
  name: 'Alpha',
  key: 'ALP',
  color: 'teal',
  icon: null,
  position: 'a0',
  priorityNames: ['', '', '', '', ''],
  deletedAt: null,
};

const statuses: Status[] = [
  {
    id: 'status-1',
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    name: 'Working',
    category: 'active',
    position: 'a0',
    isDefault: true,
  },
];

const baseTask: Task = {
  id: 'task-1',
  workspaceId: 'workspace-1',
  projectId: 'project-1',
  title: 'Ship the fix',
  number: 7,
  description: null,
  descriptionVersion: null,
  statusId: 'status-1',
  priority: 3,
  size: null,
  position: 'a0',
  parentId: null,
  primaryTagId: null,
  closedAt: null,
  deletedAt: null,
  createdAt: '2026-10-15T00:00:00Z',
};

beforeEach(() => {
  for (const mock of Object.values(fake)) mock.mockReset();
});

afterEach(() => {
  cleanup();
});

it('trashes the task, closes the view, and offers an Undo toast', () => {
  render(<TaskDetails task={baseTask} project={project} statuses={statuses} tasks={[baseTask]} />);

  fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));

  expect(fake.trashTask).toHaveBeenCalledWith('task-1');
  expect(fake.hapticsWarning).toHaveBeenCalledTimes(1);
  expect(fake.leaveTask).toHaveBeenCalledTimes(1);
  expect(fake.toast).toHaveBeenCalledWith(
    'ALP-7 moved to the trash',
    expect.objectContaining({
      action: expect.objectContaining({ label: 'Undo' }),
    }),
  );

  const options = fake.toast.mock.calls[0]?.[1] as { action: { onClick: () => void } };
  options.action.onClick();
  expect(fake.restoreTask).toHaveBeenCalledWith('task-1');
  expect(fake.hapticsSuccess).toHaveBeenCalledTimes(1);
});

it('uses a generic toast label when the task has no identifier yet', () => {
  const pending = { ...baseTask, number: null };
  render(<TaskDetails task={pending} project={project} statuses={statuses} tasks={[pending]} />);

  fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));

  expect(fake.toast).toHaveBeenCalledWith(
    'Task moved to the trash',
    expect.objectContaining({
      action: expect.objectContaining({ label: 'Undo' }),
    }),
  );
});

it('restores an already-trashed task in place without closing', () => {
  const trashed = { ...baseTask, deletedAt: '2026-10-16T00:00:00Z' };
  render(<TaskDetails task={trashed} project={project} statuses={statuses} tasks={[trashed]} />);

  expect(screen.getByText('This task is in the trash. Restore it from the toolbar.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Restore task' }));

  expect(fake.restoreTask).toHaveBeenCalledWith('task-1');
  expect(fake.hapticsSuccess).toHaveBeenCalledTimes(1);
  expect(fake.leaveTask).not.toHaveBeenCalled();
  expect(fake.toast).not.toHaveBeenCalled();
});
