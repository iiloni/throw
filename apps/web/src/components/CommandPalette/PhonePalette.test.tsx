import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import type { Project, Status, Tag } from '@throw/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project as BoardProject } from '@/components/Board/model';
import { board, update } from '@/components/Board/state';
import { usePhonePalette } from './PhonePalette';

const project: Project = {
  id: 'project-1',
  workspaceId: 'workspace-1',
  name: 'Catch',
  key: 'CAT',
  color: 'teal',
  icon: null,
  position: 'a0',
  deletedAt: null,
  priorityNames: ['', '', '', '', ''],
};

const statuses: Status[] = [
  {
    id: 'status-backlog',
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    name: 'Ideas',
    category: 'backlog',
    isDefault: true,
    position: 'a0',
  },
  {
    id: 'status-active',
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    name: 'Build',
    category: 'active',
    isDefault: true,
    position: 'a1',
  },
];

const tags: Tag[] = [
  {
    id: 'tag-1',
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    parentId: null,
    name: 'Home',
    icon: null,
    color: 'teal',
    position: 'a0',
  },
  {
    id: 'tag-2',
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    parentId: null,
    name: 'Errands',
    icon: null,
    color: 'amber',
    position: 'a1',
  },
];

const boardProject: BoardProject = {
  id: project.id,
  name: project.name,
  key: project.key,
  color: project.color,
  icon: project.icon,
  statuses,
  tags: tags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    parentId: tag.parentId,
    color: tag.color ?? undefined,
    icon: tag.icon,
  })),
  priorityNames: project.priorityNames,
};

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  openTask: vi.fn(),
  haptics: {
    success: vi.fn(),
    toggle: vi.fn(),
    selection: vi.fn(),
    threshold: vi.fn(),
    longPress: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/components/AppShell/shell', () => ({
  useShell: () => ({
    project,
    projects: [project],
    workspace: { id: 'workspace-1', name: 'Personal' },
    openTask: (...args: unknown[]) => mocks.openTask(...args),
  }),
}));

vi.mock('@/lib/collections', () => ({
  useStatuses: () => ({ statuses, isLoading: false }),
  useTags: () => ({ tags, isLoading: false }),
  useTasks: () => ({ tasks: [], isLoading: false }),
  useAllTags: () => ({ tags, isLoading: false }),
  useAllTaskTags: () => ({ taskTags: [], isLoading: false }),
}));

vi.mock('@/lib/tasks', () => ({
  createTask: (...args: unknown[]) => mocks.createTask(...args),
}));

vi.mock('@/lib/haptics', () => ({
  haptics: mocks.haptics,
}));

vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => true,
}));

function Harness({ statusId }: { statusId?: string }) {
  const { capture } = usePhonePalette({
    project: boardProject,
    onSearchPage: () => {},
  });
  return (
    <div>
      <button type="button" onClick={() => capture.open(statusId)}>
        Open capture
      </button>
      {capture.card && (
        <div ref={capture.card.surfaceRef} data-testid="capture-card">
          {capture.card.content}
        </div>
      )}
      {capture.controls}
      {capture.page?.content}
    </div>
  );
}

function touch(target: HTMLElement, type: 'start' | 'move' | 'end', y: number, time: number) {
  const touches = type === 'end' ? [] : [{ clientX: 100, clientY: y, identifier: 0 }];
  const factory = {
    start: createEvent.touchStart,
    move: createEvent.touchMove,
    end: createEvent.touchEnd,
  }[type];
  const event = factory(target, { touches, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'timeStamp', { value: time });
  fireEvent(target, event);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createTask.mockReturnValue('created-task');
  update({ backlogFilter: null });
});

describe('mobile quick capture', () => {
  it('stays on the board on Enter and ArrowUp submit, firing success haptic and clearing backlog filter', () => {
    update({ backlogFilter: 'other-backlog-status' });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open capture' }));
    const title = screen.getByRole('textbox', { name: 'Task title' });
    fireEvent.change(title, { target: { value: '  Buy milk  ' } });
    fireEvent.keyDown(title, { key: 'Enter' });

    expect(mocks.createTask).toHaveBeenCalledOnce();
    expect(mocks.createTask).toHaveBeenCalledWith('project-1', {
      title: 'Buy milk',
      statusId: 'status-backlog',
      priority: 3,
      primaryTagId: null,
      secondaryTagIds: [],
    });
    expect(mocks.haptics.success).toHaveBeenCalledOnce();
    expect(mocks.openTask).not.toHaveBeenCalled();
    expect(screen.queryByTestId('capture-card')).toBeNull();
    expect(board.get().backlogFilter).toBeNull();

    // Reopening starts a fresh session and ArrowUp also stays on the board.
    fireEvent.click(screen.getByRole('button', { name: 'Open capture' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Task title' }), {
      target: { value: 'Second task' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(mocks.createTask).toHaveBeenCalledTimes(2);
    expect(mocks.haptics.success).toHaveBeenCalledTimes(2);
    expect(mocks.openTask).not.toHaveBeenCalled();
    expect(screen.queryByTestId('capture-card')).toBeNull();
  });

  it('expands with selected fields into the full task view when clicking Expand', () => {
    render(<Harness statusId="status-active" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open capture' }));
    const title = screen.getByRole('textbox', { name: 'Task title' });
    fireEvent.change(title, { target: { value: 'Write launch notes' } });

    fireEvent.click(screen.getByRole('button', { name: /^Priority:/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'High' }));

    fireEvent.click(screen.getByRole('button', { name: /^Tags:/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Teal: Home' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Secondary' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Errands' }));

    mocks.haptics.toggle.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));

    expect(mocks.createTask).toHaveBeenCalledOnce();
    expect(mocks.createTask).toHaveBeenCalledWith('project-1', {
      title: 'Write launch notes',
      statusId: 'status-active',
      priority: 2,
      primaryTagId: 'tag-1',
      secondaryTagIds: ['tag-2'],
    });
    expect(mocks.haptics.toggle).toHaveBeenCalledOnce();
    expect(mocks.openTask).toHaveBeenCalledWith('project-1', 'created-task', true);
    expect(screen.queryByTestId('capture-card')).toBeNull();
  });

  it('expands an empty draft with an empty title fallback into the full task view', () => {
    render(<Harness statusId="status-active" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open capture' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));

    expect(mocks.createTask).toHaveBeenCalledOnce();
    expect(mocks.createTask).toHaveBeenCalledWith('project-1', {
      title: '',
      statusId: 'status-active',
      priority: 3,
      primaryTagId: null,
      secondaryTagIds: [],
    });
    expect(mocks.openTask).toHaveBeenCalledWith('project-1', 'created-task', true);
  });

  it('prevents double-creation when Expand or Create is tapped rapidly', () => {
    render(<Harness statusId="status-active" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open capture' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Task title' }), {
      target: { value: 'No duplicates' },
    });
    const expand = screen.getByRole('button', { name: 'Expand' });
    const submit = screen.getByRole('button', { name: 'Create task' });
    // Fire both before React unmounts the exiting card.
    fireEvent.click(expand);
    fireEvent.click(expand);
    fireEvent.click(submit);

    expect(mocks.createTask).toHaveBeenCalledOnce();
    expect(mocks.openTask).toHaveBeenCalledOnce();
  });

  it('expands on swipe up and dismisses without creating on swipe down', () => {
    render(<Harness statusId="status-active" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open capture' }));
    const title = screen.getByRole('textbox', { name: 'Task title' });
    fireEvent.change(title, { target: { value: 'Discard me' } });

    // Swipe down dismisses without creating.
    touch(title, 'start', 200, 0);
    touch(title, 'move', 340, 50);
    touch(title, 'end', 340, 80);
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.openTask).not.toHaveBeenCalled();
    expect(screen.queryByTestId('capture-card')).toBeNull();

    // Swipe up expands and opens the task.
    fireEvent.click(screen.getByRole('button', { name: 'Open capture' }));
    const nextTitle = screen.getByRole('textbox', { name: 'Task title' });
    fireEvent.change(nextTitle, { target: { value: 'Swiped up' } });
    touch(nextTitle, 'start', 200, 0);
    touch(nextTitle, 'move', 60, 50);
    touch(nextTitle, 'end', 60, 80);
    expect(mocks.createTask).toHaveBeenCalledOnce();
    expect(mocks.createTask).toHaveBeenCalledWith('project-1', {
      title: 'Swiped up',
      statusId: 'status-active',
      priority: 3,
      primaryTagId: null,
      secondaryTagIds: [],
    });
    expect(mocks.openTask).toHaveBeenCalledWith('project-1', 'created-task', true);
    expect(screen.queryByTestId('capture-card')).toBeNull();
  });

  it('keeps the card open and shows an alert when creation throws locally', () => {
    mocks.createTask.mockImplementationOnce(() => {
      throw new Error('Could not save');
    });
    render(<Harness statusId="status-active" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open capture' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Task title' }), {
      target: { value: 'Retry me' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
    expect(screen.getByTestId('capture-card')).toBeInTheDocument();
    expect(mocks.openTask).not.toHaveBeenCalled();

    // Retrying succeeds once the failure clears.
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(mocks.createTask).toHaveBeenCalledTimes(2);
    expect(mocks.openTask).toHaveBeenCalledWith('project-1', 'created-task', true);
  });
});
