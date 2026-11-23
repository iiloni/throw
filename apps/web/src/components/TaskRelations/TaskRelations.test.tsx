import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Project, Status, Task, TaskRelation } from '@throw/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blockedLabel } from '@/components/Board/blockers';
import { blockersByTask, RelationPicker, relationGroups, TaskRelations } from './TaskRelations';

const fake = vi.hoisted(() => ({
  add: vi.fn(),
  remove: vi.fn(),
  tasks: [] as Task[],
  projects: [] as Project[],
  statuses: [] as Status[],
  relations: [] as TaskRelation[],
}));
vi.mock('@/lib/taskRelations', () => ({
  addTaskRelation: fake.add,
  removeTaskRelation: fake.remove,
  RelationError: class extends Error {},
}));
vi.mock('@/lib/collections', () => ({
  useTasks: () => ({ tasks: fake.tasks, isLoading: false }),
  useProjects: () => ({ projects: fake.projects, isLoading: false }),
  useStatuses: () => ({ statuses: fake.statuses, isLoading: false }),
  useTaskRelations: () => ({ relations: fake.relations, isLoading: false }),
}));

const project = (id: string, key: string, name: string): Project => ({
  id,
  workspaceId: 'workspace',
  name,
  color: 'teal',
  icon: null,
  position: 'a0',
  key,
  priorityNames: ['', '', '', '', ''],
  deletedAt: null,
});
const status = (id: string, category: Status['category']): Status => ({
  id,
  workspaceId: 'workspace',
  projectId: 'app',
  name: id,
  category,
  position: 'a0',
  isDefault: true,
});
const task = (id: string, number: number, extra: Partial<Task> = {}): Task => ({
  id,
  workspaceId: 'workspace',
  projectId: 'app',
  number,
  title: `Task ${number}`,
  description: null,
  descriptionVersion: null,
  statusId: 'open',
  priority: 3,
  size: null,
  position: 'a0',
  parentId: null,
  primaryTagId: null,
  closedAt: null,
  deletedAt: null,
  createdAt: '2026-11-22T00:00:00.000Z',
  ...extra,
});
const relation = (
  id: string,
  sourceTaskId: string,
  targetTaskId: string,
  kind: TaskRelation['kind'],
): TaskRelation => ({
  id,
  workspaceId: 'workspace',
  sourceTaskId,
  targetTaskId,
  kind,
  createdAt: '2026-11-22T00:00:00.000Z',
});

const me = task('me', 1);
beforeEach(() => {
  fake.projects = [project('app', 'APP', 'App'), project('ops', 'OPS', 'Operations')];
  fake.statuses = [status('open', 'active'), status('shipped', 'done')];
  fake.tasks = [
    me,
    task('blocker', 2),
    task('other-project', 7, { projectId: 'ops' }),
    task('closed', 3, { statusId: 'shipped' }),
    task('trashed', 4, { deletedAt: '2026-11-22T00:00:00.000Z' }),
  ];
  fake.relations = [
    relation('r1', 'blocker', 'me', 'blocks'),
    relation('r2', 'other-project', 'me', 'blocks'),
    relation('r3', 'me', 'closed', 'duplicates'),
    relation('r4', 'closed', 'me', 'blocks'),
    relation('r5', 'trashed', 'me', 'blocks'),
  ];
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('relation groups', () => {
  it('groups as the task sees them, open work first, and hides empty groups', () => {
    const groups = relationGroups('me', fake.relations, fake.tasks, fake.projects, fake.statuses);
    expect(groups.map((group) => group.label)).toEqual(['Blocked by', 'Duplicates']);
    expect(groups[0]!.items.map((item) => item.identifier)).toEqual([
      'APP-2',
      'OPS-7',
      'APP-3',
      'APP-4',
    ]);
  });

  it('counts only open blockers out of the trash for the card', () => {
    const blocked = blockersByTask(fake.relations, fake.tasks, fake.projects, fake.statuses);
    expect(blocked.get('me')).toEqual(['APP-2', 'OPS-7']);
    expect(blocked.has('closed')).toBe(false);
    expect(blockedLabel(['APP-2'])).toBe('Blocked by APP-2');
    expect(blockedLabel(['APP-2', 'OPS-7'])).toBe('Blocked by 2 tasks');
  });
});

describe('the task view', () => {
  it('opens a related task, names another project and removes from a visible button', () => {
    const onOpen = vi.fn();
    const groups = relationGroups('me', fake.relations, fake.tasks, fake.projects, fake.statuses);
    render(<TaskRelations task={me} groups={groups} onOpen={onOpen} />);
    const section = screen.getByRole('region', { name: 'Relations' });
    expect(within(section).getByText('Operations')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open OPS-7 Task 7' }));
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'other-project' }),
      expect.any(HTMLLIElement),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove duplicates APP-3' }));
    expect(fake.remove).toHaveBeenCalledWith('r3');
  });

  it('shows nothing without relations', () => {
    const { container } = render(<TaskRelations task={me} groups={[]} onOpen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('links a found task in the chosen direction, and marks one already linked', () => {
    const onPicked = vi.fn();
    render(<RelationPicker task={me} onPicked={onPicked} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Blocks' }));
    expect(screen.getByText('The task you pick waits until APP-1 is done.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Find a task' }), {
      target: { value: 'task' },
    });
    const results = screen.getByRole('listbox', { name: 'Tasks to link' });
    // Trashed tasks are not offered, nor the task itself.
    expect(within(results).queryByText('Task 4')).not.toBeInTheDocument();
    expect(within(results).queryByText('Task 1')).not.toBeInTheDocument();
    // OPS-7 already blocks this task, so the reverse cannot be added; the row says how they link.
    const ops = within(results).getByRole('option', { name: /OPS-7/ });
    expect(ops).toBeDisabled();
    expect(within(ops).getByText('Blocked by')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Relates to' }));
    fireEvent.click(within(results).getByRole('option', { name: /OPS-7/ }));
    expect(fake.add).toHaveBeenCalledWith('me', 'relates_to', 'other-project');
    expect(onPicked).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: 'Blocked by' }));
    expect(within(results).getByRole('option', { name: /APP-2/ })).toBeDisabled();
  });

  it('suggests open tasks of the project that are not linked yet, and picks from the keyboard', () => {
    fake.tasks.push(
      task('started', 5),
      task('newer', 6, { createdAt: '2026-11-23T00:00:00.000Z' }),
    );
    const onPicked = vi.fn();
    render(<RelationPicker task={me} onPicked={onPicked} />);
    const suggestions = screen.getByRole('listbox', { name: 'Tasks to link' });
    // Linked, closed, trashed and other projects' tasks wait for a search.
    expect(within(suggestions).getAllByRole('option')).toHaveLength(2);
    expect(within(suggestions).getAllByRole('option')[0]).toHaveTextContent('Task 6');
    const field = screen.getByRole('combobox', { name: 'Find a task' });
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(field.getAttribute('aria-activedescendant')).toBe(
      within(suggestions).getAllByRole('option')[1]!.id,
    );
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(fake.add).toHaveBeenCalledWith('me', 'blocked_by', 'started');
    expect(onPicked).toHaveBeenCalled();
  });
});
