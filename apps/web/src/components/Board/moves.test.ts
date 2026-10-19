import type { Project, Status, Task } from '@throw/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { carryAcross, carryVertically, pickUp, putBack, setDown } from './carry';
import { compareTasks, movedElsewhere, type Place } from './model';
import { projectBoardData } from './selection';
import {
  type BoardActions,
  board,
  current,
  holdBoard,
  initialBoard,
  listTasks,
  moveToPlace,
  placeInList,
  receiveBoard,
  releaseBoard,
  sendTasks,
} from './state';

const project: Project = {
  id: 'project',
  workspaceId: 'workspace',
  name: 'Board',
  key: 'BRD',
  color: 'teal',
  icon: null,
  position: 'a0',
  priorityNames: ['', '', '', '', ''],
  deletedAt: null,
};
const status = (id: string, category: Status['category'], position = 'a0'): Status => ({
  id,
  category,
  name: id,
  projectId: project.id,
  workspaceId: project.workspaceId,
  position,
  isDefault: true,
});
const statuses = [
  status('backlog', 'backlog'),
  status('build', 'active'),
  status('review', 'active', 'a1'),
  status('done', 'done'),
];
const task = (id: string, edit: Partial<Task> = {}): Task => ({
  id,
  projectId: project.id,
  workspaceId: project.workspaceId,
  number: 1,
  title: id,
  description: null,
  descriptionVersion: null,
  statusId: 'build',
  priority: 3,
  position: 'a0',
  parentId: null,
  primaryTagId: null,
  closedAt: null,
  deletedAt: null,
  createdAt: '2026-10-14T12:00:00Z',
  ...edit,
});

const rows = [
  task('a', { position: 'a1' }),
  task('b', { position: 'a2' }),
  task('c', { position: 'a3' }),
  task('urgent', { priority: 1, position: 'a1' }),
  task('r', { statusId: 'review', position: 'a1' }),
];

let actions: BoardActions & {
  place: ReturnType<typeof vi.fn<BoardActions['place']>>;
  send: ReturnType<typeof vi.fn<BoardActions['send']>>;
};

function sync(next: Task[]) {
  receiveBoard(projectBoardData(project, statuses, next), actions);
}

const ids = (listId: Parameters<typeof listTasks>[1]) =>
  listTasks(board.get(), listId).map((item) => item.id);

beforeEach(() => {
  board.set(initialBoard());
  actions = {
    create: () => '',
    rename: () => {},
    place: vi.fn(() => true),
    send: vi.fn(() => true),
  };
  sync(rows);
});

describe('placing a held card', () => {
  it('works out the position between the cards it lands between and writes status, priority and position together', () => {
    const place = placeInList('a', 'status:review', 3, 1);
    expect(place).toMatchObject({ statusId: 'review', priority: 3 });
    expect(place!.position > 'a1').toBe(true);
    moveToPlace('a', place!);
    expect(actions.place).toHaveBeenCalledWith('a', place);
    // Shown there before sync brings the row back, so the landing card finds its place.
    expect(ids('status:review')).toEqual(['r', 'a']);
  });

  it('changes priority with the zone it lands in', () => {
    const place = placeInList('c', 'status:build', 1, 0)!;
    expect(place.priority).toBe(1);
    moveToPlace('c', place);
    expect(ids('status:build')).toEqual(['c', 'urgent', 'a', 'b']);
  });

  it('writes nothing for a card put down where it was', () => {
    const place = placeInList('b', 'status:build', 3, 1)!;
    expect(place).toEqual({ statusId: 'build', priority: 3, position: 'a2' });
    moveToPlace('b', place);
    expect(actions.place).not.toHaveBeenCalled();
  });

  it('keeps the status of a card reordered in the mixed backlog', () => {
    sync([
      task('idea', { statusId: 'backlog', position: 'a1' }),
      task('plan', { statusId: 'backlog', position: 'a2' }),
    ]);
    expect(placeInList('plan', 'backlog', 3, 0)).toMatchObject({ statusId: 'backlog' });
  });

  it('keeps the position a subtask has among its parent’s subtasks', () => {
    sync([task('parent'), task('child', { parentId: 'parent', position: 'Zz' })]);
    board.set({ ...board.get(), subtasksAsCards: true });
    moveToPlace('child', { statusId: 'review', priority: 2, position: 'b0' });
    expect(current().tasks.find((item) => item.id === 'child')).toMatchObject({
      statusId: 'review',
      priority: 2,
      position: 'Zz',
    });
  });

  it('falls back to the synced board when the move cannot be queued', () => {
    actions.place.mockReturnValue(false);
    moveToPlace('a', { statusId: 'review', priority: 3, position: 'a0' });
    expect(ids('status:review')).toEqual(['r']);
    expect(ids('status:build')).toContain('a');
  });
});

describe('sync while a card is held', () => {
  it('holds incoming rows until the drop, so the column does not change under the card', () => {
    holdBoard();
    sync([...rows, task('new', { position: 'a0' })].filter((item) => item.id !== 'b'));
    expect(ids('status:build')).toEqual(['urgent', 'a', 'b', 'c']);
    // The drop is worked out against what was shown: after `a`, before `b`.
    const place = placeInList('c', 'status:build', 3, 1)!;
    expect(place.position > 'a1' && place.position < 'a2').toBe(true);
    expect(releaseBoard(['c'])).toEqual(['c']);
    expect(ids('status:build')).toEqual(['urgent', 'new', 'a', 'c']);
    moveToPlace('c', place);
    expect(ids('status:build')).toEqual(['urgent', 'new', 'a', 'c']);
    expect(actions.place).toHaveBeenCalledWith('c', place);
  });

  it('does not move a card another device moved or removed while it was held', () => {
    holdBoard();
    sync([
      task('a', { position: 'a1', statusId: 'review' }),
      task('b', { position: 'a2', priority: 2 }),
      task('c', { position: 'a9' }),
    ]);
    // A reorder elsewhere does not count: the move would still mean the same thing.
    expect(releaseBoard(['a', 'b', 'c', 'urgent'])).toEqual(['c']);
  });

  it('reads a change as a move only when status, priority or parent differ', () => {
    const seen = rows[0]!;
    const shown = current().tasks.find((item) => item.id === seen.id)!;
    expect(movedElsewhere(shown, { ...shown, position: 'z' })).toBe(false);
    expect(movedElsewhere(shown, { ...shown, title: 'renamed' })).toBe(false);
    expect(movedElsewhere(shown, { ...shown, statusId: 'review' })).toBe(true);
    expect(movedElsewhere(shown, { ...shown, parentId: 'p' })).toBe(true);
    expect(movedElsewhere(shown, undefined)).toBe(true);
  });
});

describe('moving several cards', () => {
  it('sends them as a group, each keeping its priority, the first on top', () => {
    sendTasks(['c', 'a', 'urgent'], 'review');
    expect(actions.send).toHaveBeenCalledWith(['c', 'a', 'urgent'], 'review');
    expect(ids('status:review')).toEqual(['urgent', 'c', 'a', 'r']);
    const review = listTasks(board.get(), 'status:review');
    expect(review.map((item) => item.priority)).toEqual([1, 3, 3, 3]);
    expect([...review].sort(compareTasks)).toEqual(review);
  });

  it('leaves cards already in the status where they are', () => {
    sendTasks(['r', 'a'], 'review');
    expect(actions.send).toHaveBeenCalledWith(['a'], 'review');
    sendTasks(['r'], 'review');
    expect(actions.send).toHaveBeenCalledTimes(1);
  });

  it('stamps the closed time for cards sent to done, so they lead the closed list', () => {
    sendTasks(['a', 'b'], 'done');
    expect(ids('closed')).toEqual(expect.arrayContaining(['a', 'b']));
    expect(current().tasks.find((item) => item.id === 'a')?.closedAt).not.toBeNull();
  });
});

describe('carrying a card from the keyboard', () => {
  it('shows each step without writing, then writes once when set down', () => {
    pickUp('a');
    carryVertically(1);
    expect(ids('status:build')).toEqual(['urgent', 'b', 'a', 'c']);
    carryAcross(1);
    expect(ids('status:review')).toEqual(['a', 'r']);
    carryVertically(-1);
    expect(current().tasks.find((item) => item.id === 'a')?.priority).toBe(2);
    expect(actions.place).not.toHaveBeenCalled();
    expect(board.get().announcement).toMatch(/review, High, 1 of 1/);
    setDown();
    expect(actions.place).toHaveBeenCalledTimes(1);
    expect(actions.place.mock.calls[0]![1]).toMatchObject<Partial<Place>>({
      statusId: 'review',
      priority: 2,
    });
    expect(board.get().carrying).toBeNull();
    expect(ids('status:review')).toEqual(['a', 'r']);
  });

  it('puts the card back with Escape and writes nothing', () => {
    pickUp('a');
    carryAcross(1);
    putBack();
    expect(ids('status:build')).toContain('a');
    expect(actions.place).not.toHaveBeenCalled();
  });

  it('keeps showing the carried card where it is going while other rows sync', () => {
    pickUp('a');
    carryAcross(1);
    sync([...rows, task('late', { statusId: 'review', position: 'a0' })]);
    expect(ids('status:review')).toEqual(['a', 'late', 'r']);
  });

  it('does not write over a move another device made while the card was carried', () => {
    pickUp('a');
    carryAcross(1);
    sync(rows.map((item) => (item.id === 'a' ? { ...item, priority: 1 as const } : item)));
    setDown();
    expect(actions.place).not.toHaveBeenCalled();
    expect(board.get().announcement).toMatch(/changed on another device/);
    expect(current().tasks.find((item) => item.id === 'a')).toMatchObject({
      statusId: 'build',
      priority: 1,
    });
  });

  it('lets go of a card that was removed on another device', () => {
    pickUp('a');
    sync(rows.filter((item) => item.id !== 'a'));
    expect(board.get().carrying).toBeNull();
  });
});
