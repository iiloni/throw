import { type Description, descriptionSchema } from '@throw/shared';
import { useSyncExternalStore } from 'react';
import { getSignedInUser } from './auth';
import { getServerUrl } from './serverUrl';

// A new comment lives only in its editor until it is posted, so its text is kept per task
// on this device until it is posted or cancelled: closing the task or a reload keeps it.
const listeners = new Set<() => void>();
const prefix = () => `throw-comment:${getServerUrl()}:${getSignedInUser()?.id}:`;
const key = (taskId: string) => `${prefix()}${taskId}`;

function read(raw: string | null): Description {
  try {
    const parsed = descriptionSchema.safeParse(JSON.parse(raw ?? 'null'));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function readCommentDraft(taskId: string): Description {
  return read(localStorage.getItem(key(taskId)));
}

export function storeCommentDraft(taskId: string, document: Description) {
  try {
    if (document) localStorage.setItem(key(taskId), JSON.stringify(document));
    else localStorage.removeItem(key(taskId));
  } catch {
    // Storage can be full or blocked; the editor still holds the text while it is open.
  }
  for (const listener of listeners) listener();
}

export function clearCommentDrafts() {
  const owned = prefix();
  for (const name of Object.keys(localStorage))
    if (name.startsWith(owned)) localStorage.removeItem(name);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

/** Whether this task has an unposted comment on this device, following other tabs too. */
export function useHasCommentDraft(taskId: string) {
  // The raw string is a stable snapshot; parsing in getSnapshot would loop React renders.
  return read(useSyncExternalStore(subscribe, () => localStorage.getItem(key(taskId)))) !== null;
}
