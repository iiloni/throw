import type { RefusedField } from '@throw/shared';

/**
 * `changeId` is also the id of the update's activity entry, which records the refused values
 * and reaches the device through the log's shape.
 */
type Listener = (taskId: string, refused: readonly RefusedField[], changeId: string) => void;

const listeners = new Set<Listener>();

/**
 * Hears about task changes the server did not apply because the field had changed or the
 * value was no longer valid (ADR 0005). The task notice reads the synced log so it also
 * reaches other devices; this callback is only for immediate sending-device handling.
 */
export function onRefusedChanges(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function reportRefusedChanges(
  taskId: string,
  refused: readonly RefusedField[],
  changeId: string,
) {
  if (refused.length === 0) return;
  for (const listener of listeners) listener(taskId, refused, changeId);
}
