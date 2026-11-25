import { fireEvent, render, screen } from '@testing-library/react';
import type { Project, Status } from '@throw/shared';
import { beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CommandPalette } from './CommandPalette';

const project: Project = {
  id: 'project',
  workspaceId: 'workspace',
  name: 'Catch',
  key: 'CAT',
  color: 'teal',
  icon: null,
  position: 'a0',
  deletedAt: null,
  priorityNames: ['', '', '', '', ''],
};
const status: Status = {
  id: 'status',
  workspaceId: 'workspace',
  projectId: 'project',
  name: 'Ideas',
  category: 'backlog',
  isDefault: true,
  position: 'a0',
};
const doneStatus: Status = { ...status, id: 'done', name: 'Shipped', category: 'done' };
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  shell: vi.fn(),
  tasks: { tasks: [] as unknown[], isLoading: false },
}));
vi.mock('@/components/AppShell/shell', () => ({ useShell: () => mocks.shell() }));
vi.mock('@/lib/collections', () => ({
  useTasks: () => mocks.tasks,
  useAllTags: () => ({ tags: [], isLoading: false }),
  useAllTaskTags: () => ({ taskTags: [], isLoading: false }),
  useStatuses: () => ({ statuses: [status, doneStatus], isLoading: false }),
}));
vi.mock('@/lib/tasks', () => ({ createTask: (...args: unknown[]) => mocks.create(...args) }));
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => true,
}));
vi.mock('@/lib/media', () => ({ useDesktop: () => true }));
vi.mock('@/lib/backButton', () => ({ useBackHandler: () => {} }));
beforeEach(() => {
  mocks.tasks = { tasks: [], isLoading: false };
  mocks.create.mockReset().mockReturnValue('new-task');
  mocks.shell.mockReturnValue({
    project,
    projects: [project],
    workspace: { id: 'workspace', name: 'Personal' },
  });
});

it('does not capture an IME confirmation, and creates only a nonblank title', () => {
  const onOpenTask = vi.fn();
  render(
    <TooltipProvider>
      <CommandPalette mode="capture" onClose={() => {}} onOpenTask={onOpenTask} />
    </TooltipProvider>,
  );
  const input = screen.getByRole('textbox', { name: 'Task title' });
  fireEvent.change(input, { target: { value: '   ' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(mocks.create).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '  日本語  ' } });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(mocks.create).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.keyDown(input, { key: 'Enter', repeat: true });
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.create).toHaveBeenCalledWith('project', { title: '日本語' });
  expect(onOpenTask).toHaveBeenCalledWith('project', 'new-task', true);
});
it('keeps the title and the palette open if capture fails locally', () => {
  mocks.create.mockImplementation(() => {
    throw new Error('The project has no backlog status');
  });
  const onClose = vi.fn();
  render(
    <TooltipProvider>
      <CommandPalette mode="capture" onClose={onClose} onOpenTask={() => {}} />
    </TooltipProvider>,
  );
  const input = screen.getByRole('textbox', { name: 'Task title' });
  fireEvent.change(input, { target: { value: 'Keep this title' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getByRole('alert')).toHaveTextContent('The project has no backlog status');
  expect(input).toHaveValue('Keep this title');
  expect(onClose).not.toHaveBeenCalled();
});
it('requires a destination from the workspace board and rejects an oversized title', () => {
  mocks.shell.mockReturnValue({
    projects: [project],
    workspace: { id: 'workspace', name: 'Personal' },
  });
  render(
    <TooltipProvider>
      <CommandPalette mode="capture" onClose={() => {}} onOpenTask={() => {}} />
    </TooltipProvider>,
  );
  const input = screen.getByRole('textbox', { name: 'Task title' });
  fireEvent.change(input, { target: { value: 'Needs a project' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(mocks.create).not.toHaveBeenCalled();
  // Enter without a project opens the project list instead.
  fireEvent.click(screen.getByRole('option', { name: 'Catch' }));
  fireEvent.change(input, { target: { value: 'x'.repeat(501) } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getByRole('alert')).toHaveTextContent('500 characters');
  expect(mocks.create).not.toHaveBeenCalled();
});
it('hands a title search cannot place to the capture window', () => {
  mocks.shell.mockReturnValue({
    projects: [project],
    workspace: { id: 'workspace', name: 'Personal' },
  });
  const onModeChange = vi.fn();
  render(
    <TooltipProvider>
      <CommandPalette
        mode="search"
        onClose={() => {}}
        onOpenTask={() => {}}
        onModeChange={onModeChange}
      />
    </TooltipProvider>,
  );
  const input = screen.getByRole('combobox', { name: 'Search tasks and projects' });
  fireEvent.change(input, { target: { value: 'Somewhere new' } });
  expect(screen.getByRole('option', { name: /^Create “Somewhere new”/ })).toHaveTextContent(
    'Choose a project',
  );
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
  expect(onModeChange).toHaveBeenCalledWith('capture', 'Somewhere new');
  expect(mocks.create).not.toHaveBeenCalled();
});
it('holds an Enter pressed while tasks load, then opens the task it finds', () => {
  mocks.shell.mockReturnValue({
    projects: [project],
    workspace: { id: 'workspace', name: 'Personal' },
  });
  mocks.tasks = { tasks: [], isLoading: true };
  const onOpenTask = vi.fn();
  const onModeChange = vi.fn();
  // A new element each time, so React renders it again rather than reusing the last result.
  const palette = () => (
    <TooltipProvider>
      <CommandPalette
        mode="search"
        onClose={() => {}}
        onOpenTask={onOpenTask}
        onModeChange={onModeChange}
      />
    </TooltipProvider>
  );
  const { rerender } = render(palette());
  const input = screen.getByRole('combobox', { name: 'Search tasks and projects' });
  fireEvent.change(input, { target: { value: 'water' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onModeChange).not.toHaveBeenCalled();
  expect(onOpenTask).not.toHaveBeenCalled();
  mocks.tasks = {
    isLoading: false,
    tasks: [
      {
        id: 'water',
        workspaceId: 'workspace',
        projectId: 'project',
        number: 4,
        title: 'Water tomatoes',
        description: null,
        descriptionVersion: null,
        parentId: null,
        deletedAt: null,
        closedAt: null,
        createdAt: '2026-10-15T00:00:00Z',
        statusId: 'status',
        priority: 3,
        size: null,
        position: 'a0',
        primaryTagId: null,
      },
    ],
  };
  rerender(palette());
  expect(onOpenTask).toHaveBeenCalledWith('project', 'water', false);
  expect(onModeChange).not.toHaveBeenCalled();
});
it('keeps closed tasks behind a toggle the arrows reach, unless named by identifier', () => {
  const task = (id: string, number: number, title: string, statusId: string) => ({
    id,
    workspaceId: 'workspace',
    projectId: 'project',
    number,
    title,
    description: null,
    descriptionVersion: null,
    parentId: null,
    deletedAt: null,
    closedAt: statusId === 'done' ? '2026-10-16T00:00:00Z' : null,
    createdAt: '2026-10-15T00:00:00Z',
    statusId,
    priority: 3,
    size: null,
    position: 'a0',
    primaryTagId: null,
  });
  mocks.tasks = {
    isLoading: false,
    tasks: [task('tomatoes', 4, 'Water tomatoes', 'status'), task('lawn', 5, 'Water lawn', 'done')],
  };
  const onOpenTask = vi.fn();
  render(
    <TooltipProvider>
      <CommandPalette mode="search" onClose={() => {}} onOpenTask={onOpenTask} />
    </TooltipProvider>,
  );
  const input = screen.getByRole('combobox', { name: 'Search tasks' });
  const option = (name: RegExp) => screen.queryByRole('option', { name });

  // Its identifier finds a closed task straight away.
  fireEvent.change(input, { target: { value: 'cat-5' } });
  expect(option(/^Water\s*lawn/)).toBeInTheDocument();
  expect(option(/closed tasks/)).not.toBeInTheDocument();

  fireEvent.change(input, { target: { value: 'water' } });
  expect(option(/^Water\s*tomatoes/)).toBeInTheDocument();
  expect(option(/^Water\s*lawn/)).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('1 open task');
  const toggle = screen.getByRole('option', { name: /^Show closed tasks/ });
  expect(toggle).toHaveTextContent('1');

  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(toggle).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onOpenTask).not.toHaveBeenCalled();
  expect(screen.getByRole('option', { name: /^Hide closed tasks/ })).toBeInTheDocument();
  expect(option(/^Water\s*lawn/)).toBeInTheDocument();

  // Showing them lasts through new words.
  fireEvent.change(input, { target: { value: 'lawn' } });
  expect(screen.getByRole('status')).toHaveTextContent('No open tasks');
  expect(option(/^Water\s*lawn/)).toBeInTheDocument();
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onOpenTask).toHaveBeenCalledWith('project', 'lawn', false);
});
