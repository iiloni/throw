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
const mocks = vi.hoisted(() => ({ create: vi.fn(), shell: vi.fn() }));
vi.mock('@/components/AppShell/shell', () => ({ useShell: () => mocks.shell() }));
vi.mock('@/lib/collections', () => ({
  useTasks: () => ({ tasks: [], isLoading: false }),
  useStatuses: () => ({ statuses: [status], isLoading: false }),
}));
vi.mock('@/lib/tasks', () => ({ createTask: (...args: unknown[]) => mocks.create(...args) }));
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => true,
}));
vi.mock('@/lib/media', () => ({ useMedia: () => true }));
vi.mock('@/lib/backButton', () => ({ useBackHandler: () => {} }));
beforeEach(() => {
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
  expect(onModeChange).toHaveBeenCalledWith('capture');
  expect(mocks.create).not.toHaveBeenCalled();
});
