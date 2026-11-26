import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Project, Task } from './model';
import { settleSubtaskLists } from './SubtaskUnderlay';
import { board, initialBoard } from './state';
import { TaskCard } from './TaskCard';

const spotlit = vi.hoisted(() => new Set<string>());
vi.mock('./blockers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./blockers')>()),
  useIsBlockerSpotlightTarget: (taskId: string) => spotlit.has(taskId),
}));

const project: Project = {
  id: 'app',
  key: 'APP',
  name: 'App',
  color: 'teal',
  icon: null,
  statuses: [
    { id: 'todo', name: 'Todo', category: 'backlog', isDefault: true },
    { id: 'done', name: 'Done', category: 'done', isDefault: true },
    { id: 'ideas', name: 'Ideas', category: 'backlog', isDefault: false, color: 'blue' },
    { id: 'shipped', name: 'Shipped', category: 'done', isDefault: false, color: 'green' },
    { id: 'cancelled', name: 'Cancelled', category: 'cancelled', isDefault: true, color: null },
    { id: 'review', name: 'Review', category: 'active', isDefault: false, color: 'violet' },
    { id: 'doing', name: 'Doing', category: 'active', isDefault: false },
    { id: 'dropped', name: 'Dropped', category: 'cancelled', isDefault: false, color: 'red' },
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
  spotlit.clear();
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

describe('SubtaskPip', () => {
  function renderWith(statusIds: string[]) {
    const tasks = statusIds.map((statusId, index) =>
      task(`sub-${index + 1}`, index + 2, { parentId: 'parent', statusId }),
    );
    board.set(initialBoard([{ project, tasks: [parent, ...tasks] }]));
    renderCard();
    return tasks.map(
      (subtask) => document.querySelector<HTMLElement>(`[data-subtask-pip="${subtask.id}"]`)!,
    );
  }

  it('uses more of the status accent as work progresses', () => {
    const [ideas, review, shipped] = renderWith(['ideas', 'review', 'shipped']);
    expect(ideas).toHaveClass('bg-[color:var(--column-accent)]/35');
    expect(shipped).toHaveClass('bg-[color:var(--column-accent)]');
    expect(review).toHaveAttribute('data-column-color', 'violet');
    expect(review).toHaveAttribute('data-category', 'active');
    expect(review).toHaveClass('bg-[color:var(--column-accent)]/80');
  });

  it('keeps the neutral steps for uncolored statuses', () => {
    const [todo, doing, done] = renderWith(['todo', 'doing', 'done']);
    for (const pip of [todo, doing, done]) expect(pip).not.toHaveAttribute('data-column-color');
    expect(todo).toHaveClass('bg-foreground/15');
    expect(doing).toHaveClass('bg-foreground/45');
    expect(done).toHaveClass('bg-foreground/80');
  });

  it('stays hollow when cancelled, tinting only its outline', () => {
    const [dropped, cancelled] = renderWith(['dropped', 'cancelled']);
    expect(cancelled).not.toHaveAttribute('data-column-color');
    expect(cancelled).toHaveClass('bg-transparent', 'outline-1', 'outline-foreground/20');
    expect(dropped).toHaveAttribute('data-column-color', 'red');
    expect(dropped).toHaveClass(
      'bg-transparent',
      'outline-1',
      'outline-[color:var(--column-accent)]/45',
    );
  });

  it('uses destructive fill even for a colored, cancelled blocker', () => {
    spotlit.add('sub-1');
    const [dropped, doing] = renderWith(['dropped', 'doing']);
    expect(dropped).toHaveAttribute('data-spotlight', 'blocker');
    expect(dropped).toHaveClass('bg-destructive');
    expect(dropped).not.toHaveClass('outline-1');
    expect(dropped).not.toHaveClass('bg-transparent');
    expect(doing).not.toHaveAttribute('data-spotlight');
    expect(doing).not.toHaveClass('bg-destructive');
  });

  it("colors each row's status glyph by its status", () => {
    renderWith(['review', 'doing']);
    const glyphs = document.querySelectorAll(
      '[data-subtask-list] button[aria-label^="Status:"] svg',
    );
    expect(glyphs[0]).toHaveAttribute('data-column-color', 'violet');
    expect(glyphs[1]).not.toHaveAttribute('data-column-color');
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
