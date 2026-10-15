import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Status, Task } from '@throw/shared';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Project } from '@/components/Board/model';
import { PriorityPicker, StatusPicker } from './TaskPickers';

const fake = vi.hoisted(() => ({ send: vi.fn(), update: vi.fn() }));
vi.mock('@/lib/tasks', () => ({ sendTask: fake.send, updateTask: fake.update }));

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
  fake.send.mockReset();
  fake.update.mockReset();
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
