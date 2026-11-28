import { describe, expect, it } from 'vitest';
import { criticalPath, reachable, waitingOn } from './analysis';

const edge = (from: string, to: string) => ({ from, to });
const all = () => true;

describe('criticalPath', () => {
  it('follows the longest chain of open work, blocker first', () => {
    const ids = ['a', 'b', 'c', 'd', 'x'];
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('x', 'd')];
    expect(criticalPath(ids, edges, all)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('leaves closed work out, since it blocks nothing', () => {
    const ids = ['a', 'b', 'c', 'p', 'q'];
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('p', 'q')];
    expect(criticalPath(ids, edges, (id) => id !== 'b')).toEqual(['p', 'q']);
  });

  it('has no chain without an edge between open tasks', () => {
    expect(criticalPath(['a', 'b'], [], all)).toEqual([]);
    expect(criticalPath(['a', 'b'], [edge('a', 'b')], (id) => id === 'a')).toEqual([]);
  });

  it('breaks a tie toward the chain given first', () => {
    const ids = ['a', 'b', 'p', 'q'];
    expect(criticalPath(ids, [edge('p', 'q'), edge('a', 'b')], all)).toEqual(['a', 'b']);
  });

  it('still finds a path through a cycle', () => {
    const path = criticalPath(
      ['a', 'b', 'c'],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')],
      all,
    );
    expect(path).toHaveLength(3);
    expect(new Set(path).size).toBe(3);
  });
});

describe('reachable', () => {
  const edges = [edge('a', 'b'), edge('b', 'c'), edge('x', 'b')];

  it('walks to every dependent', () => {
    expect([...reachable('a', edges, 'down')].sort()).toEqual(['b', 'c']);
  });

  it('walks back to every blocker', () => {
    expect([...reachable('c', edges, 'up')].sort()).toEqual(['a', 'b', 'x']);
  });

  it('ends on a cycle without counting the start', () => {
    expect([...reachable('a', [edge('a', 'b'), edge('b', 'a')], 'down')]).toEqual(['b']);
  });
});

describe('waitingOn', () => {
  it('counts the open work waiting on each open task, further down included', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('a', 'd')];
    const counts = waitingOn(ids, edges, (id) => id !== 'd');
    expect(Object.fromEntries(counts)).toEqual({ a: 2, b: 1, c: 0 });
  });
});
