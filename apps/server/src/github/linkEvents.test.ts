import { describe, expect, it } from 'vitest';
import { taskNumbers } from './linkEvents';
import { summarize } from './linkSignals';

describe('project task keys', () => {
  it('matches distinct whole keys in branch names and text within the database integer range', () => {
    expect(
      taskNumbers('A1', 'feat/a1-17, A1-2 and a1-17; BA1-1 A1-3rd A1-0 A1-2147483648 B-5'),
    ).toEqual([17, 2]);
  });
});
describe('GitHub check counts', () => {
  it('counts completed, failing and waiting runs independently; neutral results do not pass', () => {
    const neutral = { state: 'neutral', at: '' } as const;
    expect(summarize({ a: neutral })).toEqual({
      state: 'neutral',
      passed: 0,
      failed: 0,
      pending: 0,
    });
    expect(
      summarize({
        a: neutral,
        b: { state: 'pending', at: '' },
        c: { state: 'passing', at: '' },
        d: { state: 'failing', at: '' },
      }),
    ).toEqual({ state: 'failing', passed: 1, failed: 1, pending: 1 });
  });
});
