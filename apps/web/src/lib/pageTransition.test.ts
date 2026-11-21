import { describe, expect, it } from 'vitest';
import { entryDelay, entryDelayForTop } from './entryMotion';
import { pageAt, pageTransition } from './pageTransition';

const at = (pathname: string, search: Record<string, unknown> = {}) => ({ pathname, search });
const board = at('/w/a/p/one', { view: 'board' });

describe('pageTransition', () => {
  it('cross-fades between boards, across projects and workspaces', () => {
    expect(pageTransition(board, at('/w/a/p/two'), true)).toEqual(['fade']);
    expect(pageTransition(board, at('/w/b/p/three'), false)).toEqual(['fade']);
    expect(pageTransition(at('/w/a/board'), board, true)).toEqual(['fade']);
  });

  it('leaves opening a task, the backlog or a view to their own motion', () => {
    expect(pageTransition(board, at('/w/a/p/one', { task: 'x' }), true)).toBe(false);
    expect(pageTransition(board, at('/w/a/p/one', { view: 'backlog' }), false)).toBe(false);
    expect(pageTransition(at('/w/a/board'), at('/w/a/board', { task: 'x' }), false)).toBe(false);
  });

  it('changes redirects and first loads in place', () => {
    expect(pageTransition(undefined, board, true)).toBe(false);
    expect(pageTransition(at('/'), at('/w/a'), true)).toBe(false);
    expect(pageTransition(at('/w/a'), board, true)).toBe(false);
    expect(pageTransition(at('/w/a/'), board, true)).toBe(false);
  });

  it('slides into settings and back out to the board', () => {
    const settings = at('/w/a/p/one/settings');
    expect(pageTransition(board, settings, true)).toEqual(['forward']);
    expect(pageTransition(settings, board, true)).toEqual(['back']);
    expect(pageTransition(board, at('/settings/general'), false)).toEqual(['forward']);
    expect(pageTransition(at('/settings/account'), board, false)).toEqual(['back']);
    expect(pageTransition(settings, at('/settings/general'), true)).toEqual(['forward']);
  });

  it('slides between settings pages in list order on a phone', () => {
    expect(pageTransition(at('/settings/general'), at('/settings/update'), false)).toEqual([
      'forward',
    ]);
    expect(pageTransition(at('/settings/admin/backups'), at('/settings/account'), false)).toEqual([
      'back',
    ]);
    const general = at('/w/a/p/one/settings');
    const tags = at('/w/a/p/one/settings', { section: 'tags' });
    const trash = at('/w/a/p/one/trash');
    expect(pageTransition(general, tags, false)).toEqual(['forward']);
    expect(pageTransition(trash, tags, false)).toEqual(['back']);
    expect(pageTransition(tags, at('/w/a/p/one/settings', { section: 'statuses' }), false)).toEqual(
      ['back'],
    );
  });

  it('changes only the open page beside the list on wide screens', () => {
    expect(pageTransition(at('/settings/general'), at('/settings/update'), true)).toEqual([
      'inner',
    ]);
    expect(pageTransition(at('/w/a/p/one/settings'), at('/w/a/p/one/trash'), true)).toEqual([
      'inner',
    ]);
  });

  it('lets pages without an order enter softly', () => {
    expect(pageTransition(board, at('/w/a/trash'), true)).toEqual(['enter']);
    expect(pageTransition(at('/w/a/trash'), board, false)).toEqual(['enter']);
    expect(pageTransition(at('/w/a/p/one/trash'), at('/w/a/trash'), false)).toEqual(['enter']);
    expect(pageTransition(at('/w/a/p/one/settings'), at('/w/a/p/two/settings'), true)).toEqual([
      'enter',
    ]);
  });

  it('reads a bad section as the general page', () => {
    expect(pageAt(at('/w/a/p/one/settings', { section: 'nope' }))).toEqual(
      pageAt(at('/w/a/p/one/settings')),
    );
    expect(pageAt(at('/settings'))).toBeNull();
    expect(pageAt(at('/login'))).toBeNull();
  });
});

describe('entry stagger', () => {
  it('steps 20 ms at a time and caps at 120 ms', () => {
    expect(entryDelay(0)).toBe(0);
    expect(entryDelay(3)).toBe(60);
    expect(entryDelay(40)).toBe(120);
    expect(entryDelayForTop(-50)).toBe(0);
    expect(entryDelayForTop(240)).toBe(40);
  });
});
