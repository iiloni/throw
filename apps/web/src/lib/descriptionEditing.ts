import { readDescriptionDraft, storeDescriptionDraft } from './descriptionDrafts';
import { getTask, saveDescription } from './tasks';

type CommitResult = 'unchanged' | 'queued' | 'conflict' | 'failed';
const editors = new Map<string, () => boolean>();

/** Leaving a task uses the editor's latest text, including a failed draft-storage attempt. */
export function registerDescriptionEditor(taskId: string, flush: () => boolean) {
  editors.set(taskId, flush);
  return () => {
    if (editors.get(taskId) === flush) editors.delete(taskId);
  };
}

export function flushTaskDescription(taskId: string) {
  return editors.get(taskId)?.() ?? commitDescriptionDraft(taskId) !== 'failed';
}

/** Queue once on close, with the version captured when this draft began. */
export function commitDescriptionDraft(taskId: string): CommitResult {
  const draft = readDescriptionDraft(taskId);
  if (!draft || draft.status === 'pending' || !getTask(taskId)) return 'unchanged';
  if (draft.status === 'conflict') return 'conflict';
  try {
    const saved = saveDescription(taskId, draft.document, draft.baseVersion);
    if (!saved) {
      storeDescriptionDraft(taskId, { ...draft, status: 'conflict' });
      return 'conflict';
    }
    storeDescriptionDraft(taskId, {
      ...draft,
      baseVersion: saved.version,
      submittedVersion: saved.version,
      status: 'pending',
    });
    void saved.transaction.isPersisted.promise.catch(() => {
      const pending = readDescriptionDraft(taskId);
      if (pending?.status === 'pending' && pending.submittedVersion === saved.version)
        storeDescriptionDraft(taskId, { ...draft, status: 'editing' });
    });
    return 'queued';
  } catch {
    return 'failed';
  }
}
