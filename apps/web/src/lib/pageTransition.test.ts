import { afterEach, describe, expect, it, vi } from 'vitest';
import { entryDelay, entryDelayForTop } from './entryMotion';
import { boardArriving, pageAt, pageMoving, pageTransition } from './pageTransition';

const at = (pathname: string, search: Record<string, unknown> = {}) => ({ pathname, search });
const board = at('/w/a/p/one', { view: 'board' });

describe('pageTransition', () => {
  it('cross-fades between boards, across projects and workspaces', () => {
    expect(pageTransition(board, at('/w/a/p/two'), true)).toEqual(['fade']);
    expect(pageTransition(board, at('/w/b/p/three'), false)).toEqual(['fade', 'docked']);
    expect(pageTransition(at('/w/a/board'), board, true)).toEqual(['fade']);
  });

  it('leaves opening a task, the backlog or a view to their own motion', () => {
    expect(pageTransition(board, at('/w/a/p/one', { task: 'x' }), true)).toBe(false);
    expect(pageTransition(board, at('/w/a/p/one', { view: 'backlog' }), false)).toBe(false);
    expect(pageTransition(at('/w/a/board'), at('/w/a/board', { task: 'x' }), false)).toBe(false);
  });

  it('cross-fades between a board and its dependency graph, and opens tasks in it in place', () => {
    const graph = at('/w/a/p/one', { view: 'graph' });
    expect(pageTransition(board, graph, true)).toEqual(['fade']);
    expect(pageTransition(graph, board, false)).toEqual(['fade', 'docked']);
    expect(pageTransition(at('/w/a/board'), at('/w/a/board', { view: 'graph' }), true)).toEqual([
      'fade',
    ]);
    expect(pageTransition(graph, at('/w/a/p/one', { view: 'graph', task: 'x' }), true)).toBe(false);
    expect(pageTransition(graph, at('/w/a/p/two', { view: 'graph' }), true)).toEqual(['fade']);
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
    expect(pageTransition(board, at('/settings/general'), false)).toEqual(['forward', 'docked']);
    expect(pageTransition(at('/settings/account'), board, false)).toEqual(['back', 'docked']);
    expect(pageTransition(settings, at('/settings/general'), false)).toEqual(['forward', 'docked']);
    expect(pageTransition(at('/settings/general'), settings, false)).toEqual(['back', 'docked']);
  });

  it('slides between settings pages in list order on a phone', () => {
    expect(pageTransition(at('/settings/general'), at('/settings/update'), false)).toEqual([
      'forward',
      'docked',
    ]);
    expect(pageTransition(at('/settings/admin/backups'), at('/settings/account'), false)).toEqual([
      'back',
      'docked',
    ]);
    const general = at('/w/a/p/one/settings');
    const tags = at('/w/a/p/one/settings', { section: 'tags' });
    const trash = at('/w/a/p/one/trash');
    expect(pageTransition(general, tags, false)).toEqual(['forward', 'docked']);
    expect(pageTransition(trash, tags, false)).toEqual(['back', 'docked']);
    expect(pageTransition(tags, at('/w/a/p/one/settings', { section: 'statuses' }), false)).toEqual(
      ['back', 'docked'],
    );
  });

  it('changes only the open page beside the unified list on wide screens', () => {
    expect(pageTransition(at('/settings/general'), at('/settings/update'), true)).toEqual([
      'inner',
    ]);
    expect(pageTransition(at('/w/a/p/one/settings'), at('/w/a/p/one/trash'), true)).toEqual([
      'inner',
    ]);
    expect(pageTransition(at('/w/a/p/one/settings'), at('/settings/general'), true)).toEqual([
      'inner',
    ]);
    expect(pageTransition(at('/settings/account'), at('/w/a/p/one/trash'), true)).toEqual([
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
    expect(pageTransition(at('/w/a/p/one/settings'), at('/w/a/p/two/settings'), false)).toEqual([
      'enter',
      'docked',
    ]);
  });

  it('keeps the dock live on a phone only between pages that both show it', () => {
    expect(pageTransition(board, at('/w/a/p/two'), true)).toEqual(['fade']);
    expect(pageTransition(board, at('/w/a/trash'), false)).toEqual(['enter']);
    expect(pageTransition(at('/w/a/trash'), at('/settings/general'), false)).toEqual(['enter']);
  });

  it('reads a bad section as the general page', () => {
    expect(pageAt(at('/w/a/p/one/settings', { section: 'nope' }))).toEqual(
      pageAt(at('/w/a/p/one/settings')),
    );
    expect(pageAt(at('/settings'))).toBeNull();
    expect(pageAt(at('/login'))).toBeNull();
  });
});

describe('the transition running', () => {
  afterEach(() => vi.restoreAllMocks());

  it('tells a board arriving apart from a page moving as a whole', () => {
    const matches = vi.spyOn(document.documentElement, 'matches');
    matches.mockImplementation((selector) => selector === ':active-view-transition-type(fade)');
    expect(boardArriving()).toBe(true);
    expect(pageMoving()).toBe(false);
    matches.mockImplementation((selector) => selector.includes('forward'));
    expect(boardArriving()).toBe(false);
    expect(pageMoving()).toBe(true);
  });

  it('reads as no transition in an engine without transition types', () => {
    vi.spyOn(document.documentElement, 'matches').mockImplementation(() => {
      throw new SyntaxError('unknown pseudo-class');
    });
    expect(boardArriving()).toBe(false);
    expect(pageMoving()).toBe(false);
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
