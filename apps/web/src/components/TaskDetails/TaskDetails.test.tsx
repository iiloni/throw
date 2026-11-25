import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

it('floats a phone task’s toolbars over its full-height scroll and blurs its scrolled edges', () => {
  const { container } = render(
    <TaskDetails task={baseTask} project={project} statuses={statuses} tasks={[baseTask]} phone />,
  );
  const header = container.querySelector<HTMLElement>('[data-task-header]')!;
  expect(header).toHaveClass('absolute', 'top-0', 'pointer-events-none');
  for (const name of ['Task navigation', 'Task trash'])
    expect(screen.getByRole('toolbar', { name })).toHaveClass('pointer-events-auto');
  // The scroll starts at the screen's top edge, and the title rests below the toolbars.
  expect(container.firstElementChild).not.toHaveClass('pt-[var(--safe-top)]');
  const viewport = container.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
  expect(viewport).toHaveClass('scroll-pt-[calc(var(--safe-top)+4.5rem)]');

  const top = container.querySelector<HTMLElement>('[data-task-top-blur]')!;
  const bottom = container.querySelector<HTMLElement>('[data-task-bottom-blur]')!;
  expect(top).toHaveClass('page-top-blur', 'pointer-events-none');
  expect(bottom).toHaveClass('page-bottom-blur', 'pointer-events-none');
  const scrollTo = (scrollTop: number) =>
    act(() => {
      Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 2000 });
      Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 500 });
      viewport.scrollTop = scrollTop;
      viewport.dispatchEvent(new Event('scroll'));
    });
  scrollTo(0);
  expect(top.style.opacity).toBe('0');
  expect(bottom.style.opacity).toBe('1');
  scrollTo(700);
  expect(top.style.opacity).toBe('1');
  expect(bottom.style.opacity).toBe('1');
  scrollTo(1500);
  expect(top.style.opacity).toBe('1');
  expect(bottom.style.opacity).toBe('0');
});

it('keeps the desktop pane’s toolbars above its card, with no edge blurs', () => {
  const { container } = render(
    <TaskDetails task={baseTask} project={project} statuses={statuses} tasks={[baseTask]} />,
  );
  expect(container.querySelector('[data-task-header]')).not.toHaveClass('absolute');
  expect(container.querySelector('[data-task-top-blur]')).toBeNull();
  expect(container.querySelector('[data-task-bottom-blur]')).toBeNull();
});
