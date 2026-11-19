import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearCommentDrafts, readCommentDraft, storeCommentDraft } from './commentDrafts';

vi.mock('./auth', () => ({ getSignedInUser: () => ({ id: 'user-1' }) }));
vi.mock('./serverUrl', () => ({ getServerUrl: () => 'https://tasks.example' }));

const body = [{ type: 'paragraph', content: [{ type: 'text', text: 'Half a thought' }] }];

afterEach(() => localStorage.clear());

describe('comment drafts', () => {
  it('keeps a draft per task for this account until it is cleared', () => {
    storeCommentDraft('task-1', body as never);
    expect(readCommentDraft('task-1')).toEqual(body);
    expect(readCommentDraft('task-2')).toBeNull();
    expect(Object.keys(localStorage)).toEqual([
      'throw-comment:https://tasks.example:user-1:task-1',
    ]);
    storeCommentDraft('task-1', null);
    expect(readCommentDraft('task-1')).toBeNull();
  });

  it('signing out clears only this account’s drafts', () => {
    storeCommentDraft('task-1', body as never);
    localStorage.setItem('throw-comment:https://tasks.example:user-2:task-1', '[]');
    clearCommentDrafts();
    expect(Object.keys(localStorage)).toEqual([
      'throw-comment:https://tasks.example:user-2:task-1',
    ]);
  });

  it('ignores a draft that does not parse', () => {
    localStorage.setItem('throw-comment:https://tasks.example:user-1:task-1', '{not json');
    expect(readCommentDraft('task-1')).toBeNull();
  });
});
