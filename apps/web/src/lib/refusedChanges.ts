import type { RefusedField } from '@throw/shared';

type Listener = (taskId: string, refused: readonly RefusedField[]) => void;

const listeners = new Set<Listener>();

/**
 * Hears about task changes the server did not apply because the field had changed or the
 * value was no longer valid (ADR 0005). How the app tells the user is not decided yet
 * (docs/spec.md, open questions); the change is in the task's log either way.
 */
export function onRefusedChanges(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function reportRefusedChanges(taskId: string, refused: readonly RefusedField[]) {
  if (refused.length === 0) return;
  for (const listener of listeners) listener(taskId, refused);
}
