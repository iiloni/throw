import { beforeEach, describe, expect, it } from 'vitest';
import { board, initialBoard, setSubtasksAsCards } from './state';

describe('subtasks as cards', () => {
  beforeEach(() => {
    localStorage.clear();
    board.set(initialBoard());
  });

  it('keeps the choice on the device for the next board', () => {
    localStorage.setItem('throw-board-settings', JSON.stringify({ zoneLabels: true }));
    setSubtasksAsCards(true);
    expect(board.get().subtasksAsCards).toBe(true);
    expect(JSON.parse(localStorage.getItem('throw-board-settings') ?? '{}')).toMatchObject({
      zoneLabels: true,
      subtasksAsCards: true,
    });
    expect(initialBoard().subtasksAsCards).toBe(true);
    setSubtasksAsCards(false);
    expect(initialBoard().subtasksAsCards).toBe(false);
  });

  it('starts off when nothing or something unreadable is stored', () => {
    expect(initialBoard().subtasksAsCards).toBe(false);
    localStorage.setItem('throw-board-settings', '{');
    expect(initialBoard().subtasksAsCards).toBe(false);
  });
});
