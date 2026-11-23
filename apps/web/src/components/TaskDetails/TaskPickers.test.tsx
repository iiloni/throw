import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Status, Tag, Task } from '@throw/shared';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Project } from '@/components/Board/model';
import { closeNewTag, newTagHosted, newTagRequest } from '@/components/NewTag/NewTag';
import { TaskActions } from './TaskActions';
import { ControlButtons } from './TaskControls';
import { PriorityPicker, SizePicker, StatusPicker, TaskTagsPicker } from './TaskPickers';

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
  size: null,
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

afterEach(() => {
  cleanup();
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

it('assigns tags in both roles from the unified panel without closing', async () => {
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
  render(<TaskTagsPicker task={{ ...task, primaryTagId: 'work' }} />);
  expect(screen.getByRole('tab', { name: 'Primary' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Secondary · 1' })).toHaveAttribute(
    'aria-selected',
    'false',
  );
  expect(screen.getByRole('button', { name: 'Teal: Work' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  fireEvent.click(screen.getByRole('button', { name: 'No color tag' }));
  expect(fake.primary).toHaveBeenCalledWith('task', null);

  fireEvent.click(screen.getByRole('tab', { name: 'Secondary · 1' }));
  // The Primary view slides out before the Secondary one arrives.
  expect(await screen.findByRole('checkbox', { name: 'Work' })).toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Work' }));
  expect(fake.secondary).toHaveBeenCalledWith('task', 'work', false);
});

it('assigns a tag made from either tab’s corner, and restores the tab and branch after unmount', async () => {
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
  const first = render(<TaskTagsPicker task={task} />);
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
  const second = render(<TaskTagsPicker task={task} />);
  expect(screen.getByRole('button', { name: 'Back from Work' })).toBeInTheDocument();
  second.unmount();
  // Left in place, as on desktop, the picker opens at its primary colors next time.
  render(<TaskTagsPicker task={task} />);
  fireEvent.click(screen.getByRole('button', { name: 'New tag' }));
  expect(newTagRequest.get()).toMatchObject({ parentId: null, color: 'red' });
  closeNewTag();
  cleanup();
  render(<TaskTagsPicker task={task} />);
  expect(screen.queryByRole('button', { name: 'Back from Work' })).toBeNull();

  // Making a tag from the Secondary tab returns to the Secondary tab after a phone unmount.
  fireEvent.click(screen.getByRole('tab', { name: 'Secondary' }));
  const secondaryView = await screen.findByRole('tabpanel', { name: 'Secondary' });
  fireEvent.click(within(secondaryView).getByRole('button', { name: 'New tag' }));
  const secondaryAsked = newTagRequest.get();
  cleanup();
  secondaryAsked?.onCreated('made-secondary');
  expect(fake.secondary).toHaveBeenLastCalledWith('task', 'made-secondary', true);
  closeNewTag();
  render(<TaskTagsPicker task={task} />);
  expect(screen.getByRole('tab', { name: 'Secondary' })).toHaveAttribute('aria-selected', 'true');
  expect(await screen.findByRole('checkbox', { name: 'Work' })).toBeInTheDocument();
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

it('sets a size, or clears it through the selected size or None', () => {
  const onPicked = vi.fn();
  const { rerender } = render(<SizePicker task={task} onPicked={onPicked} />);
  expect(screen.getByRole('radio', { name: 'None' })).toBeChecked();
  fireEvent.click(screen.getByRole('radio', { name: 'M' }));
  expect(fake.update).toHaveBeenLastCalledWith('task', { size: 3 });

  rerender(<SizePicker task={{ ...task, size: 3 }} onPicked={onPicked} />);
  expect(screen.getByRole('radio', { name: 'M' })).toBeChecked();
  fireEvent.click(screen.getByRole('radio', { name: 'M' }));
  expect(fake.update).toHaveBeenLastCalledWith('task', { size: null });
  fireEvent.click(screen.getByRole('radio', { name: 'None' }));
  expect(fake.update).toHaveBeenLastCalledWith('task', { size: null });
  expect(fake.update).toHaveBeenCalledTimes(3);
  expect(onPicked).toHaveBeenCalledTimes(3);
});

it('keeps the dock to five spacious controls with a tinted unified tags button', () => {
  const onOpen = vi.fn();
  render(
    <ControlButtons
      status={statuses[2]}
      priority={3}
      size={3}
      project={project}
      tags={{ primary: 'Launch', secondary: ['Launch', 'Press'], color: 'amber' }}
      onOpen={onOpen}
      controlProps={() => ({ 'aria-expanded': false })}
      tooltips={false}
      more
    />,
  );
  const buttons = screen.getAllByRole('button');
  expect(buttons).toHaveLength(5);
  const tagsButton = screen.getByRole('button', { name: 'Tags: Launch, Press. Change' });
  expect(tagsButton.querySelector('[data-color="amber"]')).toHaveClass('text-tint-accent');
  expect(screen.queryByRole('button', { name: /^Color:/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Link a task' })).toBeNull();
  fireEvent.click(tagsButton);
  expect(onOpen).toHaveBeenCalledWith('tags', tagsButton);
});

it('offers Link a task inside More task actions', () => {
  const onLink = vi.fn();
  render(<TaskActions task={task} statuses={statuses} onDone={vi.fn()} onLink={onLink} />);
  fireEvent.click(screen.getByRole('button', { name: 'Link a task' }));
  expect(onLink).toHaveBeenCalledOnce();
});
