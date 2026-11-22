import { sizeLabel } from '@throw/shared';
import {
  categoryTarget,
  identifier,
  isClosed,
  moveTo,
  type Priority,
  priorityName,
  projectOf,
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
  sortedBySize,
  startCarrying,
  update,
} from './state';

/**
 * Moving a card from the keyboard: Space picks it up, the arrows move it, Space or Enter
 * sets it down and Escape puts it back. Up and down cross priority zones the way a drag
 * does; left and right walk the project's statuses, opening a side zone to follow the card.
 * The card is shown where it is carried and written once, when it is set down, so a walk
 * across five columns is one move in the task's history, not five. While the board is sorted
 * by size a column has no manual order, so up and down stay put and left and right send the
 * card on with its priority, as a drop does then (ADR 0008).
 */

function describe(taskId: string) {
  const state = board.get();
  const { project, tasks } = current(state);
  const task = tasks.find((item) => item.id === taskId);
  const status = task && statusById(project, task.statusId);
  if (!task || !status) return '';
  // On the workspace board a card's place is counted in the column it shows in, whose
  // closed columns are banded by priority as well.
  const workspace = project.members !== undefined;
  const bySize = sortedBySize(state);
  const banded = !bySize && (workspace || !isClosed(status.category));
  const list = workspace ? categoryTarget(status.category) : (listOf(taskId) ?? 'closed');
  const zone = listTasks(state, list).filter((item) => !banded || item.priority === task.priority);
  const place = zone.findIndex((item) => item.id === taskId) + 1;
  const rank = banded
    ? `${priorityName(projectOf(project, task), task.priority)}, `
    : bySize
      ? `${task.size === null ? 'no size' : sizeLabel(task.size)}, `
      : '';
  return `${identifier(project, task)}: ${status.name}, ${rank}${place} of ${zone.length}`;
}

function listOf(taskId: string): ListId | null {
  const { project, tasks } = current();
  const task = tasks.find((item) => item.id === taskId);
  const status = task && statusById(project, task.statusId);
  if (!status) return null;
  // The workspace board mixes projects in a column, so a card is ordered within its status.
  if (status.category === 'active' || (project.members && !isClosed(status.category)))
    return `status:${status.id}`;
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
  if (sortedBySize(state)) {
    update({
      announcement: 'Sorted by size: cards keep no order within a column. Left and right move it.',
    });
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
  // A card walks its own project's statuses.
  const { statuses } = projectOf(project, task);
  const index = statuses.findIndex((status) => status.id === task.statusId);
  const next = statuses[index + direction];
  if (!next) return;
  const moved = sendToStatus(project, tasks, [taskId], next.id).find((item) => item.id === taskId);
  if (moved) carryTo(moved);
  revealStatus(next.id);
  update({ announcement: describe(taskId) });
}
