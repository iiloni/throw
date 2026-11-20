import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Status, Tag, Task } from '@throw/shared';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Project } from '@/components/Board/model';
import { closeNewTag, newTagHosted, newTagRequest } from '@/components/NewTag/NewTag';
import { ColorTagsPicker, PriorityPicker, StatusPicker, TagsPicker } from './TaskPickers';

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
  const { unmount } = render(<ColorTagsPicker task={{ ...task, primaryTagId: 'work' }} />);
  expect(screen.getByRole('button', { name: 'Teal: Work' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  fireEvent.click(screen.getByRole('button', { name: 'No color tag' }));
  expect(fake.primary).toHaveBeenCalledWith('task', null);
  unmount();
  render(<TagsPicker task={{ ...task, primaryTagId: 'work' }} />);
  expect(screen.getByRole('checkbox', { name: 'Work' })).toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Work' }));
  expect(fake.secondary).toHaveBeenCalledWith('task', 'work', false);
});

it('assigns a tag made from either panel’s corner, and returns the color panel to its branch', async () => {
  newTagHosted.set(true);
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
  fake.taskTags = [];
  const first = render(<ColorTagsPicker task={task} />);
  fireEvent.click(screen.getByRole('button', { name: 'Teal: Work' }));
  await screen.findByRole('button', { name: 'Back from Work' });
  fireEvent.click(screen.getByRole('button', { name: 'New tag' }));
  const asked = newTagRequest.get();
  expect(asked).toMatchObject({ projectId: 'project', parentId: 'work', color: null });
  // On a phone the form takes the picker's page, and Back brings the picker back to its branch.
  first.unmount();
  asked?.onCreated('made');
  expect(fake.primary).toHaveBeenLastCalledWith('task', 'made');
  closeNewTag();
  const second = render(<ColorTagsPicker task={task} />);
  expect(screen.getByRole('button', { name: 'Back from Work' })).toBeInTheDocument();
  second.unmount();
  // Left in place, as on desktop, the picker opens at its colors next time.
  render(<ColorTagsPicker task={task} />);
  fireEvent.click(screen.getByRole('button', { name: 'New tag' }));
  expect(newTagRequest.get()).toMatchObject({ parentId: null, color: 'red' });
  closeNewTag();
  cleanup();
  render(<ColorTagsPicker task={task} />);
  expect(screen.queryByRole('button', { name: 'Back from Work' })).toBeNull();
  cleanup();
  render(<TagsPicker task={task} />);
  fireEvent.click(screen.getByRole('button', { name: 'New tag' }));
  newTagRequest.get()?.onCreated('made');
  expect(fake.secondary).toHaveBeenLastCalledWith('task', 'made', true);
  closeNewTag();
  newTagHosted.set(false);
});

it('closes on picking the current status or priority again, without writing', () => {
  const onPicked = vi.fn();
  render(<StatusPicker task={task} statuses={statuses} onPicked={onPicked} />);
  fireEvent.click(screen.getByRole('radio', { name: 'To do' }));
  render(<PriorityPicker task={task} project={project} onPicked={onPicked} />);
  fireEvent.click(screen.getByRole('radio', { name: 'Default' }));
  expect(onPicked).toHaveBeenCalledTimes(2);
  expect(fake.send).not.toHaveBeenCalled();
  expect(fake.update).not.toHaveBeenCalled();
});
