import type { PointerEvent as ReactPointerEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drag, MAKE_WAY_DISTANCE, MAKE_WAY_TOUCH_DISTANCE, pressCard } from './drag';
import { mockBoards } from './mockData';
import type { Priority, Task } from './model';
import { board, current, initialBoard } from './state';

vi.mock('@/lib/haptics', () => ({
  haptics: new Proxy({}, { get: () => () => {} }),
}));

/** Frames run when the test says, at the time it says. */
let frames: FrameRequestCallback[] = [];
let now = 0;
let hit: Element | null = null;

function step(ms = 16) {
  now += ms;
  const due = frames;
  frames = [];
  for (const callback of due) callback(now);
}

function move(x: number, y: number) {
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }));
  step();
}

/** A column of the task's status as the board marks it, with a rail for another priority. */
function column(task: Task, rail: Priority) {
  const list = document.createElement('section');
  list.dataset.dropList = `status:${task.statusId}`;
  const header = document.createElement('div');
  header.dataset.zoneHeader = String(rail);
  header.dataset.dropRail = String(rail);
  const slot = document.createElement('div');
  slot.dataset.slot = task.id;
  slot.dataset.zone = String(task.priority);
  const card = document.createElement('article');
  card.dataset.cardRoot = '';
  slot.append(card);
  list.append(header, slot);
  const outside = document.createElement('div');
  document.body.append(list, outside);
  return { list, header, slot, card, outside };
}

/** Gives an element a place on the screen, which jsdom does not lay out. */
function box(element: HTMLElement, top: number, height = 60) {
  element.getBoundingClientRect = () => new DOMRect(0, top, 280, height);
}

function press(card: HTMLElement, taskId: string, x = 100, y = 100, pointerType = 'mouse') {
  pressCard(
    {
      button: 0,
      clientX: x,
      clientY: y,
      pointerType,
      currentTarget: card,
      target: card,
    } as unknown as ReactPointerEvent<HTMLElement>,
    taskId,
  );
}

function activeTask() {
  const { project, tasks } = current();
  const task = tasks.find(
    (item) =>
      item.parentId === null &&
      project.statuses.find((status) => status.id === item.statusId)?.category === 'active',
  );
  if (!task) throw new Error('The mock board has an active task');
  return task;
}

beforeEach(() => {
  localStorage.clear();
  board.set(initialBoard(mockBoards()));
  frames = [];
  now = 1000;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  document.elementFromPoint = () => hit;
});

afterEach(() => {
  window.dispatchEvent(new MouseEvent('pointerup'));
  for (let i = 0; i < 60 && drag.get(); i++) step(16);
  drag.set(null);
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('picking up a card', () => {
  it('holds the board still, with only its own place open, until the card moves', () => {
    const task = activeTask();
    const { slot, card } = column(task, 1);
    hit = slot;
    press(card, task.id);
    move(100, 108);
    const lifted = drag.get();
    expect(lifted?.phase).toBe('dragging');
    expect(lifted?.moved).toBe(false);
    expect(lifted?.target).toMatchObject({ kind: 'place', listId: `status:${task.statusId}` });
    expect(document.documentElement.dataset.dragMoved).toBeUndefined();

    // Counted from where it lifted, not where it was pressed.
    move(100, 108 + MAKE_WAY_DISTANCE - 2);
    expect(drag.get()?.moved).toBe(false);

    move(100, 108 + MAKE_WAY_DISTANCE);
    expect(drag.get()?.moved).toBe(true);
    expect(document.documentElement.dataset.dragMoved).toBe('');
  });

  it('gives a finger more room than a mouse before the board makes way', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const task = activeTask();
      const { slot, card } = column(task, 1);
      hit = slot;
      press(card, task.id, 100, 100, 'touch');
      vi.advanceTimersByTime(300);
      move(100, 112);
      expect(drag.get()?.moved).toBe(false);

      move(100, 112 + MAKE_WAY_TOUCH_DISTANCE - 2);
      expect(drag.get()?.moved).toBe(false);

      move(100, 112 + MAKE_WAY_TOUCH_DISTANCE);
      expect(drag.get()?.moved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps its place as the column changes around it, until it moves on', () => {
    const task = activeTask();
    const { list, slot, card } = column(task, 1);
    const neighbour = document.createElement('div');
    neighbour.dataset.slot = 'neighbour';
    neighbour.dataset.zone = String(task.priority);
    list.append(neighbour);
    box(card, 100);
    box(neighbour, 172);
    hit = slot;
    press(card, task.id);
    move(100, 108);
    const place = { kind: 'place', listId: `status:${task.statusId}`, index: 0 };
    expect(drag.get()?.target).toMatchObject(place);

    move(100, 108 + MAKE_WAY_DISTANCE);
    expect(drag.get()?.moved).toBe(true);
    // The column folds above it and the neighbour slides up under the card, which has not moved.
    box(neighbour, 80);
    for (let i = 0; i < 30; i++) step(16);
    // Dropped now, it would go back where it was.
    expect(drag.get()?.target).toMatchObject(place);

    move(100, 108 + 2 * MAKE_WAY_DISTANCE);
    expect(drag.get()?.target).toMatchObject({ ...place, index: 1 });
  });

  it('places a card that is far off by the next frame where it is', () => {
    const task = activeTask();
    const { list, slot, card } = column(task, 1);
    const neighbour = document.createElement('div');
    neighbour.dataset.slot = 'neighbour';
    neighbour.dataset.zone = String(task.priority);
    list.append(neighbour);
    box(card, 100);
    box(neighbour, 172);
    hit = slot;
    press(card, task.id);
    move(100, 108);
    // A quick move, all of it between two frames.
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, clientY: 240 }));
    step();
    expect(drag.get()?.moved).toBe(true);
    expect(drag.get()?.target).toMatchObject({ kind: 'place', index: 1 });
  });

  it('makes way at once when the card leaves its column, however short the move', () => {
    const task = activeTask();
    const { slot, card, outside } = column(task, 1);
    hit = slot;
    press(card, task.id);
    move(108, 100);
    expect(drag.get()?.moved).toBe(false);
    hit = outside;
    move(110, 100);
    expect(drag.get()?.moved).toBe(true);
  });

  it('puts a card dropped before it moves back as it was, subtasks open and nothing written', () => {
    const task = activeTask();
    const { slot, card } = column(task, 1);
    board.set({ ...board.get(), expanded: [task.id] });
    const before = current().tasks;
    hit = slot;
    press(card, task.id);
    move(100, 110);
    expect(drag.get()?.target?.kind).toBe('place');
    window.dispatchEvent(new MouseEvent('pointerup'));
    expect(drag.get()).toMatchObject({ phase: 'landing', target: null });
    expect(board.get().expanded).toEqual([task.id]);
    expect(current().tasks).toEqual(before);
  });

  it('folds an open card’s subtasks once it moves', () => {
    const task = activeTask();
    const { slot, card } = column(task, 1);
    board.set({ ...board.get(), expanded: [task.id] });
    hit = slot;
    press(card, task.id);
    move(100, 110);
    expect(board.get().expanded).toEqual([task.id]);
    move(100, 140);
    expect(board.get().expanded).toEqual([]);
  });

  it('starts a rail’s wait when the column folds, not when the card lifted', () => {
    const task = { ...activeTask(), priority: 3 as Priority };
    board.set({
      ...board.get(),
      boards: board.get().boards.map((data) => ({
        ...data,
        tasks: data.tasks.map((item) => (item.id === task.id ? task : item)),
      })),
    });
    const { header, slot, card } = column(task, 1);
    hit = slot;
    press(card, task.id);
    move(100, 108);
    // Held still for a long while: a column that has not folded has armed nothing.
    for (let i = 0; i < 60; i++) step(16);
    // The card moves, and as the column folds a rail slides in under it.
    move(100, 140);
    expect(drag.get()?.moved).toBe(true);
    hit = header;
    for (let i = 0; i < 60; i++) step(16);
    expect(drag.get()?.priority).toBe(3);
    expect(drag.get()?.rail).toBeNull();

    // Somewhere else in the column once it has folded, and back: now the rail takes it.
    hit = slot;
    for (let i = 0; i < 25; i++) step(16);
    hit = header;
    for (let i = 0; i < 20; i++) step(16);
    expect(drag.get()?.priority).toBe(1);
  });
});
