import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Project, Task } from './model';
import { settleSubtaskLists } from './SubtaskUnderlay';
import { board, initialBoard } from './state';
import { TaskCard } from './TaskCard';

const project: Project = {
  id: 'app',
  key: 'APP',
  name: 'App',
  color: 'teal',
  icon: null,
  statuses: [
    { id: 'todo', name: 'Todo', category: 'backlog', isDefault: true },
    { id: 'done', name: 'Done', category: 'done', isDefault: true },
  ],
  tags: [],
  priorityNames: [null, null, null, null, null],
};

function task(id: string, number: number, extra: Partial<Task> = {}): Task {
  return {
    id,
    number,
    title: `Task ${number}`,
    statusId: 'todo',
    priority: 3,
    size: null,
    position: `a${number}`,
    primaryTagId: null,
    secondaryTagIds: [],
    parentId: null,
    closedAt: null,
    ...extra,
  };
}

const parent = task('parent', 1);
const subtasks = [1, 2, 3].map((n) => task(`sub-${n}`, n + 1, { parentId: 'parent' }));

const motionListeners = new Set<(event: { matches: boolean }) => void>();
let reducedMotion = false;

function preferReducedMotion(reduced: boolean) {
  reducedMotion = reduced;
  for (const listener of motionListeners) listener({ matches: reduced });
}

function renderCard() {
  render(
    <TooltipProvider>
      <TaskCard task={parent} />
    </TooltipProvider>,
  );
  const list = document.querySelector<HTMLElement>('[data-subtask-list]')!;
  const toggle = screen.getByRole('button', { name: /subtasks done$/ });
  return { list, toggle };
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query.includes('prefers-reduced-motion') ? reducedMotion : false;
    },
    media: query,
    addEventListener: (_: string, listener: (event: { matches: boolean }) => void) =>
      motionListeners.add(listener),
    removeEventListener: (_: string, listener: (event: { matches: boolean }) => void) =>
      motionListeners.delete(listener),
    addListener: (listener: (event: { matches: boolean }) => void) => motionListeners.add(listener),
    removeListener: (listener: (event: { matches: boolean }) => void) =>
      motionListeners.delete(listener),
  }));
  board.set(initialBoard([{ project, tasks: [parent, ...subtasks] }]));
});

afterEach(() => {
  cleanup();
  preferReducedMotion(false);
  vi.unstubAllGlobals();
});

describe('SubtaskUnderlay', () => {
  it('starts folded, with its rows out of reach', () => {
    const { list, toggle } = renderCard();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(list.style.height).toBe('0px');
    expect(list).not.toHaveAttribute('data-expanded');
    expect(list.querySelector('ul')).toHaveAttribute('inert');
  });

  it('unfolds from where it is drawn: the spring, not React, opens it', () => {
    const { list, toggle } = renderCard();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(list).toHaveAttribute('data-expanded');
    // Still drawn shut on the frame it is told to open; the spring starts after that paint.
    expect(list.style.height).toBe('0px');
    expect(list.querySelector('ul')).not.toHaveAttribute('inert');
  });

  it('opens and closes in place with reduced motion', async () => {
    preferReducedMotion(true);
    const { list, toggle } = renderCard();
    fireEvent.click(toggle);
    // Open at rest is as tall as its rows, so later rows show at once.
    await waitFor(() => expect(list.style.height).toBe(''));
    fireEvent.click(toggle);
    await waitFor(() => expect(list.style.height).toBe('0px'));
  });
});

describe('settleSubtaskLists', () => {
  function list(height: string, expanded: boolean) {
    const element = document.createElement('div');
    element.dataset.subtaskList = '';
    if (expanded) element.dataset.expanded = '';
    element.style.height = height;
    return element;
  }

  it('draws moving lists at their ends until it is undone', () => {
    const root = document.createElement('div');
    const opening = list('40px', true);
    const closing = list('25px', false);
    const open = list('', true);
    const shut = list('0px', false);
    root.append(opening, closing, open, shut);

    const undo = settleSubtaskLists(root);
    expect(opening.style.height).toBe('');
    expect(closing.style.height).toBe('0px');
    expect(open.style.height).toBe('');
    expect(shut.style.height).toBe('0px');

    undo();
    expect(opening.style.height).toBe('40px');
    expect(closing.style.height).toBe('25px');
    expect(open.style.height).toBe('');
    expect(shut.style.height).toBe('0px');
  });
});
