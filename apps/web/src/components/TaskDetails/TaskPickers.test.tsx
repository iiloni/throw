import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Status, Tag, Task } from '@throw/shared';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Project } from '@/components/Board/model';
import { PriorityPicker, StatusPicker, TagsPicker } from './TaskPickers';

const fake = vi.hoisted(() => ({
  send: vi.fn(),
  update: vi.fn(),
  primary: vi.fn(),
  secondary: vi.fn(),
  tags: [] as Tag[],
  taskTags: [] as { taskId: string; tagId: string }[],
}));
vi.mock('@/lib/tasks', () => ({ sendTask: fake.send, updateTask: fake.update }));
vi.mock('@/lib/tags', () => ({ setPrimaryTag: fake.primary, setSecondaryTag: fake.secondary }));
vi.mock('@/lib/syncStatus', () => ({ useAwaitingSync: () => false }));
vi.mock('@/lib/collections', () => ({
  useTags: () => ({ tags: fake.tags, isLoading: false }),
  useTaskTags: () => ({ taskTags: fake.taskTags, isLoading: false }),
}));

const task: Task = {
  id: 'task',
  workspaceId: 'workspace',
  projectId: 'project',
  title: 'Title',
  number: 1,
  description: null,
  descriptionVersion: null,
  statusId: 'todo',
  priority: 3,
  position: 'a0',
  parentId: null,
  primaryTagId: null,
  closedAt: null,
  deletedAt: null,
  createdAt: '2026-10-15T00:00:00Z',
};
const status = (id: string, name: string, category: Status['category'], position: string) => ({
  id,
  workspaceId: 'workspace',
  projectId: 'project',
  name,
  category,
  position,
  isDefault: position === 'a0',
});
const statuses: Status[] = [
  status('shipped', 'Shipped', 'done', 'a0'),
  status('later', 'Later', 'backlog', 'a1'),
  status('todo', 'To do', 'backlog', 'a0'),
  status('doing', 'Doing', 'active', 'a0'),
  status('dropped', 'Dropped', 'cancelled', 'a0'),
];
const project = { priorityNames: ['Now', null, null, null, ''] } as unknown as Project;

beforeEach(() => {
  for (const mock of [fake.send, fake.update, fake.primary, fake.secondary]) mock.mockReset();
});

it('lists statuses in category order and sends the task to the one picked', () => {
  const onPicked = vi.fn();
  render(<StatusPicker task={task} statuses={statuses} onPicked={onPicked} />);
  const group = screen.getByRole('radiogroup', { name: 'Status' });
  expect(
    within(group)
      .getAllByRole('radio')
      .map((radio) => radio.closest('label')?.textContent),
  ).toEqual(['To do', 'Later', 'Doing', 'Shipped', 'Dropped']);
  expect(within(group).getByRole('radio', { name: 'To do' })).toBeChecked();
  fireEvent.click(within(group).getByRole('radio', { name: 'Doing' }));
  expect(fake.send).toHaveBeenCalledWith('task', 'doing');
  expect(onPicked).toHaveBeenCalledOnce();
});

it('names priorities by the project and updates the task with the one picked', () => {
  const onPicked = vi.fn();
  render(<PriorityPicker task={task} project={project} onPicked={onPicked} />);
  const group = screen.getByRole('radiogroup', { name: 'Priority' });
  expect(within(group).getByRole('radio', { name: 'Now' })).not.toBeChecked();
  fireEvent.click(within(group).getByRole('radio', { name: 'Now' }));
  expect(fake.update).toHaveBeenCalledWith('task', { priority: 1 });
  expect(onPicked).toHaveBeenCalledOnce();
});

it('assigns tags in both roles without closing', () => {
  const tag = (id: string, name: string, parentId: string | null = null): Tag => ({
    id,
    workspaceId: 'workspace',
    projectId: 'project',
    parentId,
    name,
    color: parentId ? null : 'teal',
    icon: null,
  });
  fake.tags = [tag('work', 'Work'), tag('mobile', 'Mobile', 'work')];
  fake.taskTags = [{ taskId: 'task', tagId: 'work' }];
  render(<TagsPicker task={{ ...task, primaryTagId: 'work' }} />);
  expect(screen.getByRole('radio', { name: 'Primary: Work' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Secondary: Work' })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Clear primary' }));
  expect(fake.primary).toHaveBeenCalledWith('task', null);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Secondary: Work' }));
  expect(fake.secondary).toHaveBeenCalledWith('task', 'work', false);
});
