import {
  identifier,
  isClosed,
  moveTo,
  type Priority,
  priorityName,
  sendToStatus,
  statusById,
} from './model';
import {
  board,
  carryTo,
  current,
  finishCarrying,
  type ListId,
  listTasks,
  placeInList,
  revealStatus,
  startCarrying,
  update,
} from './state';

/**
 * Moving a card from the keyboard: Space picks it up, the arrows move it, Space or Enter
 * sets it down and Escape puts it back. Up and down cross priority zones the way a drag
 * does; left and right walk the project's statuses, opening a side zone to follow the card.
 * The card is shown where it is carried and written once, when it is set down, so a walk
 * across five columns is one move in the task's history, not five.
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
  // A card travels with its subtasks folded away.
  update((state) => ({ expanded: state.expanded.filter((id) => id !== taskId) }));
  if (!startCarrying(taskId)) return;
  update({
    announcement: `Picked up. ${describe(taskId)}. Arrows move it, Space sets it down, Escape puts it back.`,
  });
}

export function setDown() {
  const carrying = board.get().carrying;
  if (!carrying) return;
  const result = finishCarrying();
  update({
    announcement:
      result === 'refused'
        ? `Not moved: it changed on another device while it was carried. ${describe(carrying.taskId)}`
        : result === 'unchanged'
          ? `Set down where it was. ${describe(carrying.taskId)}`
          : `Set down. ${describe(carrying.taskId)}`,
  });
}

export function putBack() {
  if (!board.get().carrying) return;
  update({ carrying: null, announcement: 'Put back where it was.' });
}

/** Shows the carried card at its new place. */
function carryPlaced(taskId: string, listId: ListId, priority: Priority, index: number) {
  const { project, tasks } = current();
  const task = tasks.find((item) => item.id === taskId);
  const place = placeInList(taskId, listId, priority, index);
  if (task && place) carryTo(moveTo(project, task, place));
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
    carryPlaced(taskId, listId, task.priority, next);
  } else {
    // Off the end of its zone: into the neighbouring priority, at the near end.
    const priority = task.priority + direction;
    if (priority < 1 || priority > 5) return;
    const size = tasks.filter((item) => item.priority === priority).length;
    carryPlaced(taskId, listId, priority as Priority, direction === 1 ? 0 : size);
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
  const moved = sendToStatus(project, tasks, [taskId], next.id).find((item) => item.id === taskId);
  if (moved) carryTo(moved);
  revealStatus(next.id);
  update({ announcement: describe(taskId) });
}
