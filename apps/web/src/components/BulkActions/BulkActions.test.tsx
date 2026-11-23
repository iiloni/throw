import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { Tag } from '@throw/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@/components/Board/model';
import { board, current, initialBoard } from '@/components/Board/state';
import { trashSelected, useSelectionContent } from './BulkActions';

const fake = vi.hoisted(() => ({
  update: vi.fn((ids: readonly string[]) => [...ids]),
  trash: vi.fn((ids: readonly string[]) => [...ids]),
  restore: vi.fn((ids: readonly string[]) => [...ids]),
  primary: vi.fn(),
  secondary: vi.fn(),
  toast: vi.fn(),
  tags: [] as Tag[],
}));
vi.mock('@/lib/tasks', () => ({
  updateTasks: fake.update,
  trashTasks: fake.trash,
  restoreTasks: fake.restore,
  sendTask: vi.fn(),
  updateTask: vi.fn(),
}));
vi.mock('@/lib/tags', () => ({
  setPrimaryTags: fake.primary,
  setSecondaryTags: fake.secondary,
  setPrimaryTag: vi.fn(),
  setSecondaryTag: vi.fn(),
}));
vi.mock('@/lib/syncStatus', () => ({ useAwaitingSync: () => false }));
vi.mock('@/lib/compatibility', () => ({ useTaskSizeSupport: () => true }));
vi.mock('@/lib/collections', () => ({
  useTags: () => ({ tags: fake.tags, isLoading: false }),
  useTaskTags: () => ({ taskTags: [], isLoading: false }),
}));
vi.mock('sonner', () => ({ toast: fake.toast }));

const task = (id: string, fields: Partial<Task> = {}): Task => ({
  id,
  number: 1,
  title: id,
  statusId: 'todo',
  priority: 3,
  size: null,
  position: 'a0',
  primaryTagId: null,
  secondaryTagIds: [],
  parentId: null,
  closedAt: null,
  ...fields,
});

const tag = (id: string, name: string, color: Tag['color'] = null): Tag => ({
  id,
  workspaceId: 'workspace',
  projectId: 'project',
  name,
  parentId: null,
  icon: null,
  color,
});

beforeEach(() => {
  vi.clearAllMocks();
  fake.tags = [tag('red', 'Fragile', 'red'), tag('spare', 'Spare')];
  board.set(
    initialBoard([
      {
        project: {
          id: 'project',
          key: 'BOX',
          name: 'Boxes',
          color: 'teal',
          icon: null,
          statuses: [{ id: 'todo', name: 'To do', category: 'backlog', isDefault: true }],
          tags: [],
          priorityNames: [],
        },
        tasks: [
          task('a', { priority: 2, size: 3, primaryTagId: 'red', secondaryTagIds: ['spare'] }),
          task('b', { priority: 4, size: 3, secondaryTagIds: ['spare'] }),
        ],
      },
    ]),
  );
});

function panel(name: 'priority' | 'size' | 'tags', onDone = vi.fn()) {
  const { result } = renderHook(() => useSelectionContent());
  render(<>{result.current.panel(name, ['a', 'b'], onDone)}</>);
  return onDone;
}

describe('a selection’s pickers', () => {
  it('marks no priority the tasks do not share, and writes only those that change', () => {
    const done = panel('priority');
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'High' }));
    expect(fake.update).toHaveBeenCalledWith(['b'], { priority: 2 });
    expect(done).toHaveBeenCalled();
  });

  it('marks a shared size, and picking it again clears it from all', () => {
    panel('size');
    const medium = screen.getByRole('radio', { name: 'M' });
    expect(medium).toBeChecked();
    fireEvent.click(medium);
    expect(fake.update).toHaveBeenCalledWith(['a', 'b'], { size: null });
  });

  it('checks a secondary tag every task has, and leaves a mixed primary clearable', async () => {
    panel('tags');
    const none = screen.getByRole('button', { name: 'No color tag' });
    expect(none).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(none);
    expect(fake.primary).toHaveBeenCalledWith(['a', 'b'], null);
    fireEvent.click(screen.getByRole('tab', { name: /Secondary/ }));
    const spare = await screen.findByRole('checkbox', { name: 'Spare' });
    expect(spare).toBeChecked();
    fireEvent.click(spare);
    expect(fake.secondary).toHaveBeenCalledWith(['a', 'b'], 'spare', false);
  });
});

describe('trashing a selection', () => {
  it('offers one undo that restores exactly what went', () => {
    fake.trash.mockReturnValueOnce(['a']);
    trashSelected(['a', 'b']);
    expect(fake.trash).toHaveBeenCalledWith(['a', 'b']);
    const [message, options] = fake.toast.mock.calls[0]!;
    expect(message).toBe('BOX-1 moved to the trash');
    options.action.onClick();
    expect(fake.restore).toHaveBeenCalledWith(['a']);
  });

  it('says how many went, and stays quiet when none did', () => {
    trashSelected(['a', 'b']);
    expect(fake.toast.mock.calls[0]![0]).toBe('2 tasks moved to the trash');
    fake.trash.mockReturnValueOnce([]);
    trashSelected(['a']);
    expect(fake.toast).toHaveBeenCalledTimes(1);
    expect(current().tasks).toHaveLength(2);
  });
});
