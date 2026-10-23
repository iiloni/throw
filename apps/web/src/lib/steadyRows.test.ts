import { describe, expect, it } from 'vitest';
import { RESET_HOLD_MS, steadyRows } from './steadyRows';

describe('steadyRows', () => {
  it('keeps the rows shown while a collection is emptied and refilled', () => {
    let state = steadyRows({ rows: [], emptySince: null }, ['a', 'b'], 0);
    state = steadyRows(state, [], 100);
    expect(state).toEqual({ rows: ['a', 'b'], emptySince: 100 });
    state = steadyRows(state, [], 900);
    expect(state.rows).toEqual(['a', 'b']);
    state = steadyRows(state, ['a', 'b', 'c'], 1200);
    expect(state).toEqual({ rows: ['a', 'b', 'c'], emptySince: null });
  });

  it('lets the rows go once they stay away', () => {
    let state = steadyRows({ rows: ['a'], emptySince: null }, [], 0);
    state = steadyRows(state, [], RESET_HOLD_MS);
    expect(state).toEqual({ rows: [], emptySince: null });
    // And an empty collection afterwards is shown empty at once.
    expect(steadyRows(state, [], RESET_HOLD_MS + 1).rows).toEqual([]);
  });

  it('shows a collection that was never filled as it is', () => {
    expect(steadyRows({ rows: [], emptySince: null }, [], 0)).toEqual({
      rows: [],
      emptySince: null,
    });
  });
});
