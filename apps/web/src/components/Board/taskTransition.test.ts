import { afterEach, expect, it, vi } from 'vitest';
import { trackDrawerTravel } from '@/components/Drawer/travel';
import {
  findTaskCard,
  isVisibleOrigin,
  measureTaskCard,
  presetTaskOrigin,
  rememberTaskOrigin,
  takeTaskOrigin,
} from './taskTransition';

afterEach(() => document.body.replaceChildren());
function card(x: number, y: number, width = 240) {
  const element = document.createElement('article');
  element.dataset.cardId = 'task';
  element.style.borderRadius = '16px';
  element.getBoundingClientRect = () => ({
    x,
    y,
    left: x,
    top: y,
    right: x + width,
    bottom: y + 100,
    width,
    height: 100,
    toJSON: () => {},
  });
  document.body.append(element);
  return element;
}
it('starts from the subtask card in the pane rather than its copy on the board', () => {
  card(20, 80);
  const subtask = card(100, 200, 280);
  rememberTaskOrigin('task');
  subtask.remove();
  expect(takeTaskOrigin('task')).toMatchObject({ x: 100, y: 200, width: 280, radius: 16 });
  expect(takeTaskOrigin('task')).toBeNull();
  expect(measureTaskCard('task')).toMatchObject({ x: 20, y: 80 });
});
it('grows a task out of a preset surface, such as quick capture, over its new card', () => {
  card(20, 80);
  const capture = card(12, 400, 360);
  capture.removeAttribute('data-card-id');
  presetTaskOrigin('task', capture);
  capture.remove();
  rememberTaskOrigin('task');
  expect(takeTaskOrigin('task')).toMatchObject({ x: 12, y: 400, width: 360 });
  // Used once: the next opening finds the task's card again.
  rememberTaskOrigin('task');
  expect(takeTaskOrigin('task')).toMatchObject({ x: 20, y: 80 });
});
it('falls back to a fade when a card was removed or is outside either viewport edge', () => {
  card(innerWidth + 20, 20);
  card(20, -150);
  expect(measureTaskCard('task')).toBeNull();
  document.body.replaceChildren();
  expect(measureTaskCard('task')).toBeNull();
});
it('remeasures the landing card after a status change or scroll', () => {
  const element = card(20, 80);
  rememberTaskOrigin('task');
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 40,
    y: 300,
    left: 40,
    top: 300,
    right: 280,
    bottom: 400,
    width: 240,
    height: 100,
    toJSON: () => {},
  });
  expect(measureTaskCard('task')).toMatchObject({ x: 40, y: 300 });
  expect(takeTaskOrigin('task')).toMatchObject({ x: 20, y: 80 });
});
it('finds a card in a drawer still rising to it, where the drawer is carrying it now', () => {
  const drawer = document.createElement('section');
  drawer.dataset.drawer = '';
  document.body.append(drawer);
  const element = card(20, innerHeight + 40);
  drawer.append(element);
  // At rest, or outside a drawer, a card below the screen is not where a task can land.
  expect(measureTaskCard('task')).toBeNull();
  const untrack = trackDrawerTravel(drawer, () => -300);
  expect(measureTaskCard('task')).toMatchObject({ x: 20, y: innerHeight + 40 });
  untrack();
  expect(measureTaskCard('task')).toBeNull();
});

it('remembers the exact origin element when a task is both a subtask card and a relation row', () => {
  const subtask = card(20, 120, 300);
  const row = document.createElement('li');
  row.dataset.taskOrigin = 'task';
  row.style.borderRadius = '12px';
  row.getBoundingClientRect = () => ({
    x: 20,
    y: 420,
    left: 20,
    top: 420,
    right: 320,
    bottom: 464,
    width: 300,
    height: 44,
    toJSON: () => {},
  });
  document.body.append(row);

  // Tapping the subtask card keeps the card as origin even though the relation row follows it.
  rememberTaskOrigin('task', subtask);
  expect(takeTaskOrigin('task')).toMatchObject({
    y: 120,
    height: 100,
    row: false,
    element: subtask,
  });

  // Tapping the relation row keeps the row as origin.
  rememberTaskOrigin('task', row);
  expect(takeTaskOrigin('task')).toMatchObject({ y: 420, height: 44, row: true, element: row });

  // Filtering by kind keeps card landings on cards and row lookups on rows.
  expect(findTaskCard('task', 'card')).toBe(subtask);
  expect(findTaskCard('task', 'row')).toBe(row);
});

function box(element: HTMLElement, y: number, height: number) {
  element.getBoundingClientRect = () => ({
    x: 20,
    y,
    left: 20,
    top: y,
    right: 320,
    bottom: y + height,
    width: 300,
    height,
    toJSON: () => {},
  });
}

it('grows a subtask out of its row on an open underlay, never out of a folded one', () => {
  const list = document.createElement('div');
  list.dataset.subtaskList = '';
  const row = document.createElement('li');
  row.dataset.taskOrigin = 'task';
  list.append(row);
  document.body.append(list);
  // A folded list clips its rows to nothing, though they are still laid out at full height.
  box(list, 200, 0);
  box(row, 200, 36);
  expect(isVisibleOrigin(row)).toBe(false);
  rememberTaskOrigin('task', row);
  expect(takeTaskOrigin('task')).toBeNull();

  list.dataset.expanded = '';
  box(list, 200, 120);
  expect(isVisibleOrigin(row)).toBe(true);
  rememberTaskOrigin('task', row);
  expect(takeTaskOrigin('task')).toMatchObject({ y: 200, height: 36, row: true, element: row });

  // Still unfolding: a row below what the list shows so far is not there yet.
  box(row, 340, 36);
  expect(isVisibleOrigin(row)).toBe(false);
});

it('skips a row hidden with its parent card', () => {
  const row = document.createElement('li');
  row.dataset.taskOrigin = 'task';
  document.body.append(row);
  box(row, 200, 36);
  row.checkVisibility = () => false;
  expect(isVisibleOrigin(row)).toBe(false);
  expect(findTaskCard('task')).toBeNull();
  // A card hidden while its task is out of it is still where the task lands.
  const hidden = card(20, 80);
  hidden.checkVisibility = () => false;
  expect(isVisibleOrigin(hidden)).toBe(true);
});
