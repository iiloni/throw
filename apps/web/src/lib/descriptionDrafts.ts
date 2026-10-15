import { type Description, descriptionSchema } from '@throw/shared';
import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { getSignedInUser } from './auth';
import { getServerUrl } from './serverUrl';

const draftSchema = z.object({
  document: descriptionSchema,
  baseVersion: z.string().nullable(),
  editorKey: z.string(),
  status: z.enum(['editing', 'pending', 'conflict']),
  submittedVersion: z.string().nullable(),
});
export type DescriptionDraft = z.infer<typeof draftSchema>;

const listeners = new Set<() => void>();
const prefix = () => `throw-description:${getServerUrl()}:${getSignedInUser()?.id}:`;
const key = (taskId: string) => `${prefix()}${taskId}`;

export function clearDescriptionDrafts() {
  const owned = prefix();
  for (const name of Object.keys(localStorage))
    if (name.startsWith(owned)) localStorage.removeItem(name);
  for (const listener of listeners) listener();
}

export function readDescriptionDraft(taskId: string): DescriptionDraft | null {
  try {
    const parsed = draftSchema.safeParse(JSON.parse(localStorage.getItem(key(taskId)) ?? 'null'));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Drafts survive closing the pane, reloads and refused offline writes. */
export function storeDescriptionDraft(taskId: string, draft: DescriptionDraft | null) {
  if (draft) localStorage.setItem(key(taskId), JSON.stringify(draft));
  else localStorage.removeItem(key(taskId));
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

export function useDescriptionDraft(taskId: string) {
  // The raw string is a stable snapshot; parsing in getSnapshot would loop React renders.
  useSyncExternalStore(subscribe, () => localStorage.getItem(key(taskId)));
  return readDescriptionDraft(taskId);
}

/** Called for replayed outbox writes too, including when their pane is closed. */
export function settleDescriptionDraft(
  taskId: string,
  attempt: { document: Description; version: string },
  refused: boolean,
) {
  const draft = readDescriptionDraft(taskId);
  if (refused) {
    storeDescriptionDraft(taskId, {
      document: draft ? draft.document : attempt.document,
      baseVersion: draft?.baseVersion ?? null,
      editorKey: draft?.editorKey ?? attempt.version,
      submittedVersion: draft?.submittedVersion ?? attempt.version,
      status: 'conflict',
    });
  } else if (draft?.submittedVersion === attempt.version && draft.status === 'pending') {
    storeDescriptionDraft(taskId, null);
  }
}

export function descriptionIsStale(draft: DescriptionDraft, currentVersion: string | null) {
  return draft.baseVersion !== currentVersion && draft.submittedVersion !== currentVersion;
}
