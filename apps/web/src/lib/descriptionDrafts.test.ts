import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearDescriptionDrafts,
  type DescriptionDraft,
  descriptionIsStale,
  readDescriptionDraft,
  settleDescriptionDraft,
  storeDescriptionDraft,
} from './descriptionDrafts';

const session = vi.hoisted(() => ({ user: 'one', server: 'https://throw.example' }));
vi.mock('./auth', () => ({ getSignedInUser: () => ({ id: session.user }) }));
vi.mock('./serverUrl', () => ({ getServerUrl: () => session.server }));

const draft: DescriptionDraft = {
  document: [{ type: 'paragraph', content: 'My work' }],
  baseVersion: 'base',
  editorKey: 'editor',
  status: 'editing',
  submittedVersion: null,
};
beforeEach(() => {
  localStorage.clear();
  session.user = 'one';
  session.server = 'https://throw.example';
});

describe('description recovery drafts', () => {
  it('retains the exact document and base version across readers, scoped to user and server', () => {
    storeDescriptionDraft('task', draft);
    expect(readDescriptionDraft('task')).toEqual(draft);
    session.user = 'two';
    expect(readDescriptionDraft('task')).toBeNull();
    session.user = 'one';
    session.server = 'https://other.example';
    expect(readDescriptionDraft('task')).toBeNull();
  });

  it('detects a remote version without mistaking its own pending save for a remote change', () => {
    expect(descriptionIsStale(draft, 'remote')).toBe(true);
    expect(descriptionIsStale(draft, 'base')).toBe(false);
    expect(descriptionIsStale({ ...draft, submittedVersion: 'own' }, 'own')).toBe(false);
    expect(descriptionIsStale({ ...draft, baseVersion: null }, null)).toBe(false);
    expect(descriptionIsStale(draft, null)).toBe(true);
  });

  it('only clears an acknowledged pending save, preserving a newer draft and later queued save', () => {
    storeDescriptionDraft('task', { ...draft, status: 'pending', submittedVersion: 'saved' });
    settleDescriptionDraft('task', { version: 'old', document: null }, false);
    expect(readDescriptionDraft('task')).not.toBeNull();
    settleDescriptionDraft('task', { version: 'saved', document: null }, false);
    expect(readDescriptionDraft('task')).toBeNull();
    storeDescriptionDraft('task', { ...draft, submittedVersion: 'saved' });
    settleDescriptionDraft('task', { version: 'saved', document: null }, false);
    expect(readDescriptionDraft('task')?.document).toEqual(draft.document);
  });

  it('recovers a refusal after reload or while the pane is closed, including a lost-response replay', () => {
    const attempt = { version: 'refused', document: draft.document };
    settleDescriptionDraft('task', attempt, true);
    expect(readDescriptionDraft('task')).toMatchObject({
      document: draft.document,
      status: 'conflict',
    });
    settleDescriptionDraft('task', attempt, false);
    expect(readDescriptionDraft('task')?.status).toBe('conflict');
  });

  it('keeps a newer unsaved draft when an older save is refused', () => {
    storeDescriptionDraft('task', draft);
    settleDescriptionDraft('task', { version: 'old', document: null }, true);
    expect(readDescriptionDraft('task')).toEqual({
      ...draft,
      submittedVersion: 'old',
      status: 'conflict',
    });
  });

  it('can explicitly discard recovery text', () => {
    storeDescriptionDraft('task', draft);
    storeDescriptionDraft('task', null);
    expect(readDescriptionDraft('task')).toBeNull();
  });

  it('clears this user’s drafts on sign-out without touching another user’s drafts', () => {
    storeDescriptionDraft('task', draft);
    session.user = 'two';
    storeDescriptionDraft('other-task', draft);
    session.user = 'one';
    clearDescriptionDrafts();
    expect(readDescriptionDraft('task')).toBeNull();
    session.user = 'two';
    expect(readDescriptionDraft('other-task')).toEqual(draft);
  });
});
