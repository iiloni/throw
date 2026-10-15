import { afterEach, expect, it, vi } from 'vitest';
import { measureTaskCard, rememberTaskOrigin, takeTaskOrigin } from './taskTransition';

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
