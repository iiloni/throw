import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { BoardColumn } from './BoardColumn';
import {
  armBlockerSpotlight,
  blockedHint,
  blockedLabel,
  blockerMatchesBacklog,
  blockerMatchesColumn,
  blockerMatchesStatus,
  blockerSpotlight,
  cancelBlockerSpotlight,
  SPOTLIGHT_DWELL_MS,
  SPOTLIGHT_HOLD_MS,
  syncBlockerSpotlight,
  type TaskBlocker,
  TaskBlockersContext,
} from './blockers';
import { type DragState, drag, isPrimed, TOUCH_SLOP } from './drag';
import type { BoardData, Project, Task } from './model';
import { railGeometry, SideZone } from './SideZone';
import { board, initialBoard, receiveBoard, update } from './state';
import { TaskCard } from './TaskCard';

function makeProject(id: string, key: string | null, name: string, members?: Project[]): Project {
  return {
    id,
    key,
    name,
    color: 'teal',
    icon: null,
    statuses: [
      { id: `${id}-backlog`, name: 'Backlog', category: 'backlog', isDefault: true },
      { id: `${id}-working`, name: 'Working', category: 'active', isDefault: true },
      { id: `${id}-review`, name: 'Review', category: 'active', isDefault: false },
      { id: `${id}-done`, name: 'Done', category: 'done', isDefault: true },
    ],
    tags: [],
    priorityNames: [null, null, null, null, null],
    ...(members ? { members } : {}),
  };
}

function makeTask(id: string, number: number, statusId: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    number,
    title: `Task ${number}`,
    statusId,
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

function makeBlocker(
  id: string,
  identifier: string,
  extra: Partial<TaskBlocker> = {},
): TaskBlocker {
  return {
    id,
    identifier,
    projectId: 'app',
    projectName: 'App',
    statusId: 'app-working',
    category: 'active',
    parentId: null,
    parentStatusId: null,
    parentCategory: null,
    ...extra,
  };
}

const reducedMotionListeners = new Set<(event: { matches: boolean }) => void>();
let reducedMotionMatches = false;

function stubDesktop(desktop: boolean, reducedMotion = false) {
  reducedMotionMatches = reducedMotion;
  for (const listener of reducedMotionListeners) listener({ matches: reducedMotionMatches });
  vi.stubGlobal('innerWidth', desktop ? 1280 : 390);
  vi.stubGlobal('matchMedia', (query: string) => {
    if (query.includes('prefers-reduced-motion')) {
      return {
        get matches() {
          return reducedMotionMatches;
        },
        media: query,
        addEventListener: (_event: string, listener: (event: { matches: boolean }) => void) =>
          reducedMotionListeners.add(listener),
        removeEventListener: (_event: string, listener: (event: { matches: boolean }) => void) =>
          reducedMotionListeners.delete(listener),
        addListener: (listener: (event: { matches: boolean }) => void) =>
          reducedMotionListeners.add(listener),
        removeListener: (listener: (event: { matches: boolean }) => void) =>
          reducedMotionListeners.delete(listener),
      };
    }
    return {
      matches: query === '(width >= 48rem)' ? desktop : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  });
}

function makeBoardData(): BoardData {
  const app = makeProject('app', 'APP', 'App');
  return {
    project: app,
    tasks: [
      makeTask('blocked-task', 1, 'app-working', { title: 'Ship release' }),
      makeTask('blocker-task', 2, 'app-working', { title: 'Finish API' }),
      makeTask('unrelated-task', 3, 'app-working', { title: 'Write docs' }),
      makeTask('backlog-blocker', 4, 'app-backlog', { title: 'Prepare keys' }),
      makeTask('review-blocker', 5, 'app-review', { title: 'Sign off QA' }),
    ],
  };
}

const dummyDrag: DragState = {
  ids: ['unrelated-task'],
  width: 280,
  height: 80,
  grab: { x: 20, y: 20 },
  origin: 'active',
  priority: 3,
  target: null,
  rail: null,
  phase: 'dragging',
  swallowed: false,
  touch: false,
  over: false,
  page: 0,
  moved: false,
};

beforeEach(() => {
  vi.useFakeTimers();
  stubDesktop(true);
  board.set(initialBoard([makeBoardData()]));
  drag.set(null);
  cancelBlockerSpotlight();
});

afterEach(() => {
  cancelBlockerSpotlight();
  drag.set(null);
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('blockedLabel and blockedHint', () => {
  const app = makeProject('app', 'APP', 'App');
  const ops = makeProject('ops', 'OPS', 'Operations');
  const workspace = makeProject('ws', null, 'All projects', [app, ops]);

  it('formats labels for both identifier strings and TaskBlocker entries', () => {
    expect(blockedLabel(['APP-2'])).toBe('Blocked by APP-2');
    expect(blockedLabel(['APP-2', 'OPS-7'])).toBe('Blocked by 2 tasks');
    expect(blockedLabel([makeBlocker('b1', 'APP-2')])).toBe('Blocked by APP-2');
    expect(blockedLabel([makeBlocker('b1', 'APP-2'), makeBlocker('b2', 'OPS-7')])).toBe(
      'Blocked by 2 tasks',
    );
  });

  it('names external projects in the tooltip on single-project boards, and stays concise on workspace boards', () => {
    const local = makeBlocker('b1', 'APP-2');
    const opsOne = makeBlocker('b2', 'OPS-1', { projectId: 'ops', projectName: 'Operations' });
    const opsTwo = makeBlocker('b3', 'OPS-2', { projectId: 'ops', projectName: 'Operations' });
    const infra = makeBlocker('b4', 'INF-1', { projectId: 'infra', projectName: 'Infra' });
    const unnamed = makeBlocker('b5', 'EXT-1', { projectId: 'ext', projectName: null });

    expect(blockedHint([local], app)).toBe('Blocked by APP-2');
    expect(blockedHint([opsOne], app)).toBe('Blocked by OPS-1 · Operations');
    expect(blockedHint([unnamed], app)).toBe('Blocked by EXT-1 · another project');
    expect(blockedHint([opsOne, opsTwo], app)).toBe('Blocked by 2 tasks · Operations');
    expect(blockedHint([opsOne, infra], app)).toBe('Blocked by 2 tasks · other projects');
    expect(blockedHint([local, opsOne], app)).toBe('Blocked by 2 tasks · 1 in Operations');
    expect(blockedHint([local, opsOne, infra], app)).toBe(
      'Blocked by 3 tasks · 2 in other projects',
    );
    expect(blockedHint([opsOne], workspace)).toBe('Blocked by OPS-1');
  });
});

describe('blocker spotlight dwell and cancellation', () => {
  const blockers = [makeBlocker('blocker-task', 'APP-2')];

  it('waits for the full dwell delay before activating, and emits nothing on brief hover', () => {
    const listener = vi.fn();
    const unsub = blockerSpotlight.subscribe(listener);

    armBlockerSpotlight('blocked-task', blockers);
    vi.advanceTimersByTime(SPOTLIGHT_DWELL_MS - 1);
    expect(blockerSpotlight.get()).toBeNull();
    expect(listener).not.toHaveBeenCalled();

    // Leaving before the dwell completes cancels without ever triggering a render.
    cancelBlockerSpotlight('blocked-task');
    vi.advanceTimersByTime(SPOTLIGHT_DWELL_MS);
    expect(blockerSpotlight.get()).toBeNull();
    expect(listener).not.toHaveBeenCalled();

    // Lingering for the full dwell activates the spotlight once.
    armBlockerSpotlight('blocked-task', blockers);
    vi.advanceTimersByTime(SPOTLIGHT_DWELL_MS);
    expect(blockerSpotlight.get()?.blockedTaskId).toBe('blocked-task');
    expect(blockerSpotlight.get()?.blockerIds.has('blocker-task')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    // Cancelling another task does not disturb the active spotlight.
    cancelBlockerSpotlight('other-task');
    expect(blockerSpotlight.get()?.blockedTaskId).toBe('blocked-task');

    cancelBlockerSpotlight('blocked-task');
    expect(blockerSpotlight.get()).toBeNull();
    unsub();
  });

  it('cancels immediately on drag start, Escape, pointerdown, blur, board changes, and non-desktop viewports', () => {
    // Non-desktop never activates.
    stubDesktop(false);
    armBlockerSpotlight('blocked-task', blockers);
    vi.advanceTimersByTime(SPOTLIGHT_DWELL_MS);
    expect(blockerSpotlight.get()).toBeNull();
    stubDesktop(true);

    // Drag start cancels active spotlight.
    armBlockerSpotlight('blocked-task', blockers);
    vi.advanceTimersByTime(SPOTLIGHT_DWELL_MS);
    expect(blockerSpotlight.get()).not.toBeNull();
    drag.set(dummyDrag);
    expect(blockerSpotlight.get()).toBeNull();
    drag.set(null);

    // Escape cancels and prevents default only when visibly active.
    armBlockerSpotlight('blocked-task', blockers);
    const pendingEscape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    window.dispatchEvent(pendingEscape);
    expect(pendingEscape.defaultPrevented).toBe(false);
    vi.advanceTimersByTime(SPOTLIGHT_DWELL_MS);
    expect(blockerSpotlight.get()).toBeNull();

    armBlockerSpotlight('blocked-task', blockers);
    vi.advanceTimersByTime(SPOTLIGHT_DWELL_MS);
    const activeEscape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    window.dispatchEvent(activeEscape);
    expect(activeEscape.defaultPrevented).toBe(true);
    expect(blockerSpotlight.get()).toBeNull();

    // Pointerdown cancels.
    armBlockerSpotlight('blocked-task', blockers);
    vi.advanceTimersByTime(SPOTLIGHT_DWELL_MS);
    window.dispatchEvent(new Event('pointerdown'));
    expect(blockerSpotlight.get()).toBeNull();

    // Opening a task cancels.
    armBlockerSpotlight('blocked-task', blockers);
    vi.advanceTimersByTime(SPOTLIGHT_DWELL_MS);
    update({ openTaskId: 'blocked-task' });
    expect(blockerSpotlight.get()).toBeNull();
    update({ openTaskId: null });

    // Window blur cancels.
    armBlockerSpotlight('blocked-task', blockers);
    vi.advanceTimersByTime(SPOTLIGHT_DWELL_MS);
    window.dispatchEvent(new Event('blur'));
    expect(blockerSpotlight.get()).toBeNull();
  });

  it('survives background board sync updates while selection stays empty, and updates live blockers', () => {
    const data = makeBoardData();
    const actions = {
      beforeLeave: () => true,
      discard: () => {},
      create: () => 'new',
      rename: () => {},
      place: () => true,
      send: () => true,
    };
    receiveBoard(data, actions, false);

    armBlockerSpotlight('blocked-task', blockers);
    vi.advanceTimersByTime(SPOTLIGHT_DWELL_MS);
    expect(blockerSpotlight.get()?.blockedTaskId).toBe('blocked-task');

    // A background sync that re-delivers board data with an empty selection keeps spotlight alive.
    receiveBoard(makeBoardData(), actions, false);
    expect(blockerSpotlight.get()?.blockedTaskId).toBe('blocked-task');

    // Closing the last blocker clears the spotlight.
    syncBlockerSpotlight('blocked-task', []);
    expect(blockerSpotlight.get()).toBeNull();
  });
});

describe('collapsed column and backlog blocker lookup', () => {
  const app = makeProject('app', 'APP', 'App');
  const ops = makeProject('ops', 'OPS', 'Operations');
  const workspace = makeProject('ws', null, 'All projects', [app, ops]);

  it('matches collapsed status columns, workspace category columns, backlog strips, filters, and tucked subtasks', () => {
    const activeBlocker = makeBlocker('b-review', 'APP-5', {
      statusId: 'app-review',
      category: 'active',
    });
    const backlogBlocker = makeBlocker('b-backlog', 'APP-4', {
      statusId: 'app-backlog',
      category: 'backlog',
    });
    const otherProjectBlocker = makeBlocker('b-ops', 'OPS-1', {
      projectId: 'ops',
      projectName: 'Operations',
      statusId: 'ops-backlog',
      category: 'backlog',
    });
    const subtaskBlocker = makeBlocker('b-sub', 'APP-9', {
      statusId: 'app-working',
      category: 'active',
      parentId: 'parent-in-review',
      parentStatusId: 'app-review',
      parentCategory: 'active',
    });

    armBlockerSpotlight('blocked-task', [activeBlocker, backlogBlocker, otherProjectBlocker]);
    vi.advanceTimersByTime(SPOTLIGHT_DWELL_MS);
    const active = blockerSpotlight.get();

    // Project board collapsed active column & backlog strip.
    expect(blockerMatchesColumn(active, 'app-review', app, false, null)).toBe(true);
    expect(blockerMatchesColumn(active, 'app-working', app, false, null)).toBe(false);
    expect(blockerMatchesBacklog(active, app, false, null)).toBe(true);
    expect(blockerMatchesStatus(active, 'app-backlog', app, false, null)).toBe(true);

    // Filtered-out blockers do not falsely light up an empty strip.
    expect(blockerMatchesColumn(active, 'app-review', app, false, new Set(['blocked-task']))).toBe(
      false,
    );
    expect(blockerMatchesBacklog(active, app, false, new Set(['blocked-task']))).toBe(false);

    // Workspace board matches category columns across member projects.
    expect(blockerMatchesColumn(active, 'category:active', workspace, false, null)).toBe(true);
    expect(blockerMatchesColumn(active, 'category:backlog', workspace, false, null)).toBe(true);
    expect(blockerMatchesColumn(active, 'category:done', workspace, false, null)).toBe(false);
    expect(blockerMatchesBacklog(active, workspace, false, null)).toBe(false);

    // Tucked subtask follows its parent's column when subtasksAsCards is false, and its own when true.
    armBlockerSpotlight('blocked-task', [subtaskBlocker]);
    const subSpotlight = blockerSpotlight.get();
    expect(blockerMatchesColumn(subSpotlight, 'app-review', app, false, null)).toBe(true);
    expect(blockerMatchesColumn(subSpotlight, 'app-working', app, false, null)).toBe(false);
    expect(blockerMatchesColumn(subSpotlight, 'app-working', app, true, null)).toBe(true);
    expect(blockerMatchesColumn(subSpotlight, 'app-review', app, true, null)).toBe(false);
  });
});

describe('component spotlight rendering', () => {
  it('spotlights blocked and blocker cards, dims unrelated cards, and highlights collapsed strips on dwell', () => {
    const data = makeBoardData();
    board.set({ ...initialBoard([data]), backlog: 'strip' });
    const blockerMap = new Map<string, readonly TaskBlocker[]>([
      [
        'blocked-task',
        [
          makeBlocker('blocker-task', 'APP-2', { statusId: 'app-working', category: 'active' }),
          makeBlocker('review-blocker', 'APP-5', { statusId: 'app-review', category: 'active' }),
          makeBlocker('backlog-blocker', 'APP-4', { statusId: 'app-backlog', category: 'backlog' }),
        ],
      ],
    ]);
    const geometry = railGeometry({
      rowWidth: 1200,
      views: { backlog: 'strip', closed: 'strip' },
      widths: { backlog: null, closed: null },
      resize: null,
      holding: false,
      origin: null,
    });

    render(
      <TooltipProvider>
        <TaskBlockersContext.Provider value={blockerMap}>
          <SideZone zone="backlog" geometry={geometry.backlog} />
          <BoardColumn
            columnId="app-review"
            name="Review"
            category="active"
            count={1}
            collapsed
            onToggle={() => {}}
            index={1}
            className="grow"
          >
            {() => null}
          </BoardColumn>
          <TaskCard task={data.tasks[0]!} />
          <TaskCard task={data.tasks[1]!} />
          <TaskCard task={data.tasks[2]!} />
        </TaskBlockersContext.Provider>
      </TooltipProvider>,
    );

    const blockedCard = screen.getByRole('article', { name: 'APP-1 Ship release' });
    const blockerCard = screen.getByRole('article', { name: 'APP-2 Finish API' });
    const unrelatedCard = screen.getByRole('article', { name: 'APP-3 Write docs' });
    const reviewStrip = screen.getByRole('button', { name: 'Expand Review column' });
    const backlogStrip = screen.getByRole('button', { name: /Open backlog/ });
    const badge = blockedCard.querySelector<HTMLElement>('[data-blocked]')!;

    // Touch hover is ignored.
    fireEvent.pointerEnter(badge, { pointerType: 'touch', buttons: 0 });
    act(() => vi.advanceTimersByTime(SPOTLIGHT_DWELL_MS));
    expect(blockedCard).not.toHaveAttribute('data-spotlight');

    // Mouse hover activates after dwell.
    fireEvent.pointerEnter(badge, { pointerType: 'mouse', buttons: 0 });
    act(() => vi.advanceTimersByTime(SPOTLIGHT_DWELL_MS - 10));
    expect(blockedCard).not.toHaveAttribute('data-spotlight');

    act(() => vi.advanceTimersByTime(10));
    expect(blockedCard).toHaveAttribute('data-spotlight', 'blocked');
    expect(blockerCard).toHaveAttribute('data-spotlight', 'blocker');
    expect(unrelatedCard).toHaveAttribute('data-spotlight', 'dimmed');
    expect(reviewStrip).toHaveAttribute('data-spotlight', 'blocker');
    expect(backlogStrip).toHaveAttribute('data-spotlight', 'blocker');

    // Pointer leave clears everything immediately.
    fireEvent.pointerLeave(badge, { pointerType: 'mouse' });
    expect(blockedCard).not.toHaveAttribute('data-spotlight');
    expect(blockerCard).not.toHaveAttribute('data-spotlight');
    expect(unrelatedCard).not.toHaveAttribute('data-spotlight');
    expect(reviewStrip).not.toHaveAttribute('data-spotlight');
    expect(backlogStrip).not.toHaveAttribute('data-spotlight');
  });

  it('highlights the subtask underlay and blocking subtask pip without bordering the parent card when blocked by its own subtask', () => {
    const app = makeProject('app', 'APP', 'App');
    const parent = makeTask('parent-task', 1, 'app-working', { title: 'Launch feature' });
    const blockingSub = makeTask('sub-blocker', 2, 'app-working', {
      title: 'Verify migration',
      parentId: 'parent-task',
    });
    const otherSub = makeTask('sub-other', 3, 'app-backlog', {
      title: 'Update readme',
      parentId: 'parent-task',
    });
    const unrelated = makeTask('unrelated-task', 4, 'app-working', { title: 'Clean cache' });
    board.set(initialBoard([{ project: app, tasks: [parent, blockingSub, otherSub, unrelated] }]));
    const blockerMap = new Map<string, readonly TaskBlocker[]>([
      [
        'parent-task',
        [
          makeBlocker('sub-blocker', 'APP-2', {
            statusId: 'app-working',
            category: 'active',
            parentId: 'parent-task',
            parentStatusId: 'app-working',
            parentCategory: 'active',
          }),
        ],
      ],
    ]);

    const { rerender } = render(
      <TooltipProvider>
        <TaskBlockersContext.Provider value={blockerMap}>
          <TaskCard task={parent} />
          <TaskCard task={unrelated} />
        </TaskBlockersContext.Provider>
      </TooltipProvider>,
    );

    const parentCard = screen.getByRole('article', { name: 'APP-1 Launch feature' });
    const unrelatedCard = screen.getByRole('article', { name: 'APP-4 Clean cache' });
    const underlay = document.querySelector<HTMLElement>('[data-subtask-underlay]')!;
    const blockerPip = document.querySelector<HTMLElement>('[data-subtask-pip="sub-blocker"]')!;
    const otherPip = document.querySelector<HTMLElement>('[data-subtask-pip="sub-other"]')!;
    const badge = parentCard.querySelector<HTMLElement>('[data-blocked]')!;

    fireEvent.pointerEnter(badge, { pointerType: 'mouse', buttons: 0 });
    act(() => vi.advanceTimersByTime(SPOTLIGHT_DWELL_MS));

    // Parent card stays undimmed without a blocked/blocker border; underlay and pip carry the highlight.
    expect(parentCard).toHaveAttribute('data-spotlight', 'parent');
    expect(underlay).toHaveAttribute('data-spotlight', 'blocker');
    expect(blockerPip).toHaveAttribute('data-spotlight', 'blocker');
    expect(blockerPip.className).toContain('bg-destructive');
    expect(otherPip).not.toHaveAttribute('data-spotlight');
    expect(unrelatedCard).toHaveAttribute('data-spotlight', 'dimmed');

    fireEvent.pointerLeave(badge, { pointerType: 'mouse' });
    expect(parentCard).not.toHaveAttribute('data-spotlight');
    expect(underlay).not.toHaveAttribute('data-spotlight');
    expect(blockerPip).not.toHaveAttribute('data-spotlight');

    // When subtasks are shown as top-level cards, there is no underlay and both cards highlight normally.
    act(() => update({ subtasksAsCards: true }));
    rerender(
      <TooltipProvider>
        <TaskBlockersContext.Provider value={blockerMap}>
          <TaskCard task={parent} />
          <TaskCard task={blockingSub} />
        </TaskBlockersContext.Provider>
      </TooltipProvider>,
    );
    const topParentCard = screen.getByRole('article', { name: 'APP-1 Launch feature' });
    const topSubtaskCard = screen.getByRole('article', { name: 'APP-2 Verify migration' });
    fireEvent.pointerEnter(topParentCard.querySelector<HTMLElement>('[data-blocked]')!, {
      pointerType: 'mouse',
      buttons: 0,
    });
    act(() => vi.advanceTimersByTime(SPOTLIGHT_DWELL_MS));
    expect(topParentCard).toHaveAttribute('data-spotlight', 'blocked');
    expect(topSubtaskCard).toHaveAttribute('data-spotlight', 'blocker');
  });

  it('marks cards and strips as instant when reduced motion is enabled', () => {
    stubDesktop(true, true);
    const data = makeBoardData();
    board.set(initialBoard([data]));
    const blockerMap = new Map<string, readonly TaskBlocker[]>([
      ['blocked-task', [makeBlocker('blocker-task', 'APP-2')]],
    ]);

    render(
      <TooltipProvider>
        <TaskBlockersContext.Provider value={blockerMap}>
          <TaskCard task={data.tasks[0]!} />
          <TaskCard task={data.tasks[1]!} />
        </TaskBlockersContext.Provider>
      </TooltipProvider>,
    );

    const blockedCard = screen.getByRole('article', { name: 'APP-1 Ship release' });
    expect(blockedCard).toHaveAttribute('data-spotlight-instant', '');
  });
});

describe('touch press-and-hold on the blocked badge', () => {
  const blockerMap = new Map<string, readonly TaskBlocker[]>([
    ['blocked-task', [makeBlocker('blocker-task', 'APP-2')]],
  ]);
  const finger = { pointerType: 'touch', pointerId: 7, button: 0, clientX: 100, clientY: 100 };

  /** Cards as a board lays them out: side by side (`full`), paged (`compact`) or a phone's. */
  function renderBoard(layout: 'full' | 'compact' | 'phone') {
    const data = makeBoardData();
    board.set(initialBoard([data]));
    const cards = (
      <>
        <TaskCard task={data.tasks[0]!} />
        <TaskCard task={data.tasks[1]!} />
        <TaskCard task={data.tasks[2]!} />
      </>
    );
    render(
      <TooltipProvider>
        <TaskBlockersContext.Provider value={blockerMap}>
          {layout === 'phone' ? (
            <div>{cards}</div>
          ) : (
            <div data-board-layout="" data-compact-board={layout === 'compact' ? '' : undefined}>
              {cards}
            </div>
          )}
        </TaskBlockersContext.Provider>
      </TooltipProvider>,
    );
    const blockedCard = screen.getByRole('article', { name: 'APP-1 Ship release' });
    const blockerCard = screen.getByRole('article', { name: 'APP-2 Finish API' });
    const badge = blockedCard.querySelector<HTMLElement>('[data-blocked]')!;
    return { blockedCard, blockerCard, badge };
  }

  it('spotlights the blockers once the finger has held, and hides them the moment it lifts', () => {
    const { blockedCard, blockerCard, badge } = renderBoard('full');

    fireEvent.pointerDown(badge, finger);
    act(() => vi.advanceTimersByTime(SPOTLIGHT_HOLD_MS - 10));
    expect(blockedCard).not.toHaveAttribute('data-spotlight');

    act(() => vi.advanceTimersByTime(10));
    expect(blockedCard).toHaveAttribute('data-spotlight', 'blocked');
    expect(blockerCard).toHaveAttribute('data-spotlight', 'blocker');
    expect(badge).toHaveAttribute('data-spotlight-trigger', 'active');

    // Held well past the board's long press: the card is neither picked up nor selected.
    act(() => vi.advanceTimersByTime(1000));
    expect(isPrimed()).toBe(false);
    expect(board.get().selection).toEqual([]);
    expect(blockedCard).toHaveAttribute('data-spotlight', 'blocked');

    fireEvent.pointerUp(badge, finger);
    expect(blockedCard).not.toHaveAttribute('data-spotlight');
    expect(blockerCard).not.toHaveAttribute('data-spotlight');
    expect(blockerSpotlight.get()).toBeNull();

    // The click the lift sends neither opens nor selects the card.
    fireEvent.click(badge);
    expect(board.get().openTaskId).toBeNull();
    expect(board.get().selection).toEqual([]);
  });

  it('hides at once when the browser cancels the touch or the badge loses its capture', () => {
    const { blockedCard, badge } = renderBoard('full');

    fireEvent.pointerDown(badge, finger);
    act(() => vi.advanceTimersByTime(SPOTLIGHT_HOLD_MS));
    expect(blockedCard).toHaveAttribute('data-spotlight', 'blocked');
    fireEvent.pointerCancel(badge, finger);
    expect(blockedCard).not.toHaveAttribute('data-spotlight');

    fireEvent.pointerDown(badge, finger);
    act(() => vi.advanceTimersByTime(SPOTLIGHT_HOLD_MS));
    expect(blockedCard).toHaveAttribute('data-spotlight', 'blocked');
    fireEvent.lostPointerCapture(badge, finger);
    expect(blockedCard).not.toHaveAttribute('data-spotlight');
  });

  it('lets a finger that sets off scrolling go, before or after the spotlight shows', () => {
    const { blockedCard, badge } = renderBoard('full');

    // A small wobble keeps the hold.
    fireEvent.pointerDown(badge, finger);
    fireEvent.pointerMove(badge, { ...finger, clientX: 100 + TOUCH_SLOP - 2 });
    act(() => vi.advanceTimersByTime(SPOTLIGHT_HOLD_MS));
    expect(blockedCard).toHaveAttribute('data-spotlight', 'blocked');
    fireEvent.pointerMove(badge, { ...finger, clientY: 100 + TOUCH_SLOP + 5 });
    expect(blockedCard).not.toHaveAttribute('data-spotlight');
    fireEvent.pointerUp(badge, finger);

    // A scroll that starts on the badge never lights the board.
    fireEvent.pointerDown(badge, finger);
    fireEvent.pointerMove(badge, { ...finger, clientY: 100 + TOUCH_SLOP + 5 });
    act(() => vi.advanceTimersByTime(SPOTLIGHT_HOLD_MS * 2));
    expect(blockedCard).not.toHaveAttribute('data-spotlight');
    expect(blockerSpotlight.get()).toBeNull();
  });

  it('keeps the browser menu away while held, and a short tap still opens the card', () => {
    const { blockedCard, badge } = renderBoard('full');

    fireEvent.pointerDown(badge, finger);
    act(() => vi.advanceTimersByTime(SPOTLIGHT_HOLD_MS));
    expect(fireEvent.contextMenu(badge)).toBe(false);
    fireEvent.pointerUp(badge, finger);
    fireEvent.click(badge);
    expect(board.get().openTaskId).toBeNull();
    act(() => vi.advanceTimersByTime(100));

    fireEvent.pointerDown(badge, finger);
    act(() => vi.advanceTimersByTime(SPOTLIGHT_HOLD_MS / 2));
    fireEvent.pointerUp(badge, finger);
    fireEvent.click(badge);
    expect(blockedCard).not.toHaveAttribute('data-spotlight');
    expect(board.get().openTaskId).toBe('blocked-task');
  });

  it('leaves the badge to the card on paged boards: the compact board and a phone', () => {
    for (const layout of ['compact', 'phone'] as const) {
      stubDesktop(layout === 'compact');
      const { blockedCard, badge } = renderBoard(layout);

      fireEvent.pointerDown(badge, finger);
      act(() => vi.advanceTimersByTime(SPOTLIGHT_HOLD_MS));
      expect(blockedCard).not.toHaveAttribute('data-spotlight');
      expect(blockerSpotlight.get()).toBeNull();
      // The card's own long press selects it, as anywhere else on the card.
      expect(isPrimed()).toBe(true);
      expect(board.get().selection).toEqual(['blocked-task']);
      fireEvent.pointerUp(badge, finger);
      cleanup();
    }
  });

  it('leaves a mouse press on the badge to the card, which still drags from it', () => {
    const { blockedCard, badge } = renderBoard('full');
    const mouse = { pointerType: 'mouse', pointerId: 1, button: 0, clientX: 100, clientY: 100 };
    document.elementFromPoint = () => null;

    fireEvent.pointerDown(badge, mouse);
    fireEvent.pointerMove(window, { ...mouse, clientX: 140 });
    expect(drag.get()?.ids).toEqual(['blocked-task']);
    expect(blockedCard).not.toHaveAttribute('data-spotlight');
    fireEvent.pointerCancel(window, mouse);
    expect(drag.get()?.phase).not.toBe('dragging');
  });
});
