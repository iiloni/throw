import { beforeEach, expect, it, vi } from 'vitest';
import { readDescriptionDraft, storeDescriptionDraft } from './descriptionDrafts';
import { commitDescriptionDraft } from './descriptionEditing';

const actions = vi.hoisted(() => ({ save: vi.fn(), get: vi.fn() }));
vi.mock('./auth', () => ({ getSignedInUser: () => ({ id: 'user' }) }));
vi.mock('./serverUrl', () => ({ getServerUrl: () => 'https://throw.example' }));
vi.mock('./tasks', () => ({ getTask: actions.get, saveDescription: actions.save }));
const draft = {
  document: [{ type: 'paragraph', content: 'My text' }],
  baseVersion: 'base',
  editorKey: 'editor',
  submittedVersion: null,
  status: 'editing' as const,
};
beforeEach(() => {
  localStorage.clear();
  actions.get.mockReturnValue({ id: 'task' });
  actions.save.mockReset();
  actions.save.mockReturnValue({
    version: 'new',
    transaction: { isPersisted: { promise: new Promise(() => {}) } },
  });
});
it('queues only one save even if back, unmount and another close all flush', () => {
  storeDescriptionDraft('task', draft);
  expect(commitDescriptionDraft('task')).toBe('queued');
  expect(commitDescriptionDraft('task')).toBe('unchanged');
  expect(actions.save).toHaveBeenCalledTimes(1);
  expect(actions.save).toHaveBeenCalledWith('task', draft.document, 'base');
});
it('keeps stale text for review instead of queueing it against a fresh version', () => {
  storeDescriptionDraft('task', draft);
  actions.save.mockReturnValue(null);
  expect(commitDescriptionDraft('task')).toBe('conflict');
  expect(readDescriptionDraft('task')).toMatchObject({ ...draft, status: 'conflict' });
  expect(commitDescriptionDraft('task')).toBe('conflict');
  expect(actions.save).toHaveBeenCalledTimes(1);
});
it('retains a failed local write for the next close', async () => {
  storeDescriptionDraft('task', draft);
  actions.save.mockReturnValue({
    version: 'new',
    transaction: { isPersisted: { promise: Promise.reject(new Error('Storage failed')) } },
  });
  commitDescriptionDraft('task');
  await Promise.resolve();
  expect(readDescriptionDraft('task')).toEqual(draft);
});
it('leaves a newer draft alone when persistence of an older save fails', async () => {
  storeDescriptionDraft('task', draft);
  actions.save.mockReturnValue({
    version: 'new',
    transaction: { isPersisted: { promise: Promise.reject(new Error('Storage failed')) } },
  });
  commitDescriptionDraft('task');
  storeDescriptionDraft('task', { ...draft, document: [{ content: 'Newer text' }] });
  await Promise.resolve();
  expect(readDescriptionDraft('task')?.document).toEqual([{ content: 'Newer text' }]);
});
