import { identifier, isClosed, type Priority, priorityName, statusById } from './model';
import {
  board,
  current,
  type ListId,
  listTasks,
  placeInList,
  restoreTasks,
  revealStatus,
  sendTasks,
  update,
} from './state';

/**
 * Moving a card from the keyboard: Space picks it up, the arrows move it, Space or Enter
 * sets it down and Escape puts it back. Up and down cross priority zones the way a drag
 * does; left and right walk the project's statuses, opening a side zone to follow the card.
 */

function describe(taskId: string) {
  const state = board.get();
  const { project, tasks } = current(state);
  const task = tasks.find((item) => item.id === taskId);
  const status = task && statusById(project, task.statusId);
  if (!task || !status) return '';
  const zone = listTasks(state, listOf(taskId) ?? 'closed').filter(
    (item) => isClosed(status.category) || item.priority === task.priority,
  );
  const place = zone.findIndex((item) => item.id === taskId) + 1;
  const rank = isClosed(status.category) ? '' : `${priorityName(project, task.priority)}, `;
  return `${identifier(project, task)}: ${status.name}, ${rank}${place} of ${zone.length}`;
}

function listOf(taskId: string): ListId | null {
  const { project, tasks } = current();
  const task = tasks.find((item) => item.id === taskId);
  const status = task && statusById(project, task.statusId);
  if (!status) return null;
  if (status.category === 'active') return `status:${status.id}`;
  return status.category === 'backlog' ? 'backlog' : 'closed';
}

export function pickUp(taskId: string) {
  update((state) => ({
    // A card travels with its subtasks folded away.
    expanded: state.expanded.filter((id) => id !== taskId),
    carrying: { taskId, before: current().tasks },
    announcement: `Picked up. ${describe(taskId)}. Arrows move it, Space sets it down, Escape puts it back.`,
  }));
}

export function setDown() {
  const carrying = board.get().carrying;
  if (!carrying) return;
  update({ carrying: null, announcement: `Set down. ${describe(carrying.taskId)}` });
}

export function putBack() {
  const carrying = board.get().carrying;
  if (!carrying) return;
  restoreTasks(carrying.before);
  update({ carrying: null, announcement: 'Put back where it was.' });
}

export function carryVertically(direction: -1 | 1) {
  const state = board.get();
  const taskId = state.carrying?.taskId;
  const listId = taskId && listOf(taskId);
  if (!taskId || !listId) return;
  if (listId === 'closed') {
    update({ announcement: 'Closed work is ordered by when it was closed.' });
    return;
  }
  const tasks = listTasks(state, listId);
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return;
  const zone = tasks.filter((item) => item.priority === task.priority);
  const index = zone.findIndex((item) => item.id === taskId);
  const next = index + direction;
  if (next >= 0 && next < zone.length) {
    placeInList(taskId, listId, task.priority, next);
  } else {
    // Off the end of its zone: into the neighbouring priority, at the near end.
    const priority = task.priority + direction;
    if (priority < 1 || priority > 5) return;
    const size = tasks.filter((item) => item.priority === priority).length;
    placeInList(taskId, listId, priority as Priority, direction === 1 ? 0 : size);
  }
  update({ announcement: describe(taskId) });
}

export function carryAcross(direction: -1 | 1) {
  const taskId = board.get().carrying?.taskId;
  const { project, tasks } = current();
  const task = tasks.find((item) => item.id === taskId);
  if (!taskId || !task) return;
  const index = project.statuses.findIndex((status) => status.id === task.statusId);
  const next = project.statuses[index + direction];
  if (!next) return;
  sendTasks([taskId], next.id);
  revealStatus(next.id);
  update({ announcement: describe(taskId) });
}
