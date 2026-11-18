import { describe, expect, it } from 'vitest';
import { mockBoards } from './mockData';
import {
  compareTasks,
  groupByPriority,
  type Priority,
  placeTask,
  sendToStatus,
  type Task,
} from './model';

const [{ project, tasks }] = mockBoards() as [ReturnType<typeof mockBoards>[number]];
const status = (name: string) => project.statuses.find((item) => item.name === name)!.id;
const column = (all: Task[], name: string) =>
  all.filter((task) => task.statusId === status(name) && task.parentId === null).sort(compareTasks);
const zone = (all: Task[], name: string, priority: Priority) =>
  column(all, name).filter((task) => task.priority === priority);
const titled = (title: string) => tasks.find((task) => task.title.startsWith(title))!;

describe('placeTask', () => {
  it('reorders within a priority zone without touching the other cards', () => {
    const peers = zone(tasks, 'Building', 3);
    const moved = peers[0]!;
    const next = placeTask(project, tasks, moved.id, { priority: 3, index: 2, peers });
    expect(zone(next, 'Building', 3).map((task) => task.id)).toEqual([
      peers[1]!.id,
      peers[2]!.id,
      moved.id,
      ...peers.slice(3).map((task) => task.id),
    ]);
    expect(next.filter((task) => task.id !== moved.id)).toEqual(
      tasks.filter((task) => task.id !== moved.id),
    );
  });

  it('changes priority when placed in another zone', () => {
    const moved = zone(tasks, 'Building', 3)[0]!;
    const peers = zone(tasks, 'Building', 2);
    const next = placeTask(project, tasks, moved.id, { priority: 2, index: peers.length, peers });
    expect(zone(next, 'Building', 2).at(-1)?.id).toBe(moved.id);
  });

  it('moves to another column at the chosen place', () => {
    const moved = zone(tasks, 'Building', 3)[0]!;
    const peers = zone(tasks, 'In review', 3);
    const next = placeTask(project, tasks, moved.id, {
      statusId: status('In review'),
      priority: 3,
      index: 1,
      peers,
    });
    expect(zone(next, 'In review', 3)[1]?.id).toBe(moved.id);
  });
});

describe('sendToStatus', () => {
  it('keeps each priority and lands at the top of its zone, in the order given', () => {
    const [first, second] = zone(tasks, 'Building', 3);
    const high = zone(tasks, 'Building', 2)[0]!;
    const next = sendToStatus(project, tasks, [first!.id, high.id, second!.id], status('Testing'));
    expect(
      zone(next, 'Testing', 3)
        .slice(0, 2)
        .map((task) => task.id),
    ).toEqual([first!.id, second!.id]);
    expect(zone(next, 'Testing', 2)[0]?.id).toBe(high.id);
  });

  it('stamps the close time on closing and clears it on reopening', () => {
    const task = titled('Jade focus ring');
    const closed = sendToStatus(project, tasks, [task.id], status('Shipped'), 1000);
    expect(closed.find((item) => item.id === task.id)?.closedAt).toBe(1000);
    const refiled = sendToStatus(project, closed, [task.id], status("Won't do"), 2000);
    expect(refiled.find((item) => item.id === task.id)?.closedAt).toBe(1000);
    const reopened = sendToStatus(project, refiled, [task.id], status('Building'), 3000);
    expect(reopened.find((item) => item.id === task.id)?.closedAt).toBeNull();
  });
});

describe('groupByPriority', () => {
  it('returns all five zones in rank order, empty ones included', () => {
    const groups = groupByPriority(column(tasks, 'Testing'));
    expect(groups.map((group) => group.priority)).toEqual([1, 2, 3, 4, 5]);
    expect(groups[0]?.tasks).toEqual([]);
  });
});
