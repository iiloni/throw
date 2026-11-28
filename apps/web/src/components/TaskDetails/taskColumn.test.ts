import { motionValue } from 'motion/react';
import { expect, it } from 'vitest';
import { animateSteadySpring, springs, stopSteady } from '@/lib/motion';
import {
  ACTIVITY_GAP,
  ACTIVITY_MAX,
  ACTIVITY_MIN,
  activitySpace,
  activityWidth,
  CARD_MAX,
  COLUMN_GAP,
  COLUMN_MIN,
  COLUMN_WIDTH,
  columnFits,
  columnOpacity,
  columnProgress,
  columnSpace,
  foldHeight,
  WORKSPACE_MIN,
  workspaceFits,
  workspaceMaxWidth,
} from './taskColumn';

it('gives a pane the column from the breakpoint, and never a phone', () => {
  expect(columnFits(null)).toBe(false);
  expect(columnFits(440)).toBe(false);
  expect(columnFits(COLUMN_MIN - 1)).toBe(false);
  expect(columnFits(COLUMN_MIN)).toBe(true);
  // The card beside it keeps more than the narrowest pane a task can have.
  expect(COLUMN_MIN - COLUMN_WIDTH - COLUMN_GAP).toBeGreaterThan(340);
});

it('opens the column only when the layout is to the side and there are extras for it', () => {
  expect(columnProgress(1, 1)).toBe(1);
  expect(columnProgress(1, 0)).toBe(0);
  expect(columnProgress(0, 1)).toBe(0);
  expect(columnProgress(0.5, 1)).toBe(0.5);
  expect(columnProgress(1, 0.25)).toBe(0.25);
});

it('reserves the column and its gap on the same progress', () => {
  expect(columnSpace(0)).toBe(0);
  expect(columnSpace(1)).toBe(COLUMN_WIDTH + COLUMN_GAP);
  expect(columnSpace(0.5)).toBe((COLUMN_WIDTH + COLUMN_GAP) / 2);
});

it('fades the column in only once most of its room is made', () => {
  expect(columnOpacity(0)).toBe(0);
  expect(columnOpacity(0.3)).toBe(0);
  expect(columnOpacity(0.65)).toBeCloseTo(0.5);
  expect(columnOpacity(1)).toBe(1);
});

it('folds an inline copy from its measured height, and leaves it natural at rest', () => {
  expect(foldHeight(1, 120)).toBe('auto');
  expect(foldHeight(0.5, 120)).toBe(60);
  expect(foldHeight(0, 120)).toBe(0);
  // A spring's overshoot cannot draw a negative height.
  expect(foldHeight(-0.1, 120)).toBe(0);
});

it('springs by frames, and a reversal continues from where the value is', async () => {
  const value = motionValue(0);
  const seen: number[] = [];
  value.on('change', (latest) => seen.push(latest));
  void animateSteadySpring(value, 1, springs.pane);
  await expect.poll(() => seen.length, { timeout: 2000 }).toBeGreaterThan(3);
  const turned = value.get();
  expect(turned).toBeGreaterThan(0);
  expect(turned).toBeLessThan(1);
  seen.length = 0;
  const back = animateSteadySpring(value, 0, springs.pane);
  await back;
  expect(value.get()).toBe(0);
  // Back down from where it turned, without jumping to either end first.
  expect(seen[0]).toBeLessThanOrEqual(turned);
  expect(seen[0]).toBeGreaterThan(0);
  expect(seen.every((latest, index) => index === 0 || latest <= seen[index - 1]! + 1e-9)).toBe(
    true,
  );
  stopSteady(value);
});

it('makes a workspace of a pane from its breakpoint, keeping a card worth reading beside it', () => {
  expect(workspaceFits(null)).toBe(false);
  expect(workspaceFits(WORKSPACE_MIN - 1)).toBe(false);
  expect(workspaceFits(WORKSPACE_MIN)).toBe(true);
  // A workspace has room for the column too, so the links leave the tabs for it.
  expect(columnFits(WORKSPACE_MIN)).toBe(true);
  const beside = activityWidth(WORKSPACE_MIN) + ACTIVITY_GAP + COLUMN_WIDTH + COLUMN_GAP;
  expect(WORKSPACE_MIN - beside).toBeGreaterThanOrEqual(560);
});

it('sizes the activity pane by the width, between its narrowest and widest', () => {
  expect(activityWidth(WORKSPACE_MIN)).toBe(ACTIVITY_MIN);
  expect(activityWidth(1600)).toBe(480);
  expect(activityWidth(2600)).toBe(ACTIVITY_MAX);
  expect(activitySpace(0, 400)).toBe(0);
  expect(activitySpace(1, 400)).toBe(400 + ACTIVITY_GAP);
  expect(activitySpace(0.5, 400)).toBe((400 + ACTIVITY_GAP) / 2);
});

it('caps a settled workspace at the card’s measure and what stands beside it, reaching it smoothly', () => {
  const beside = activitySpace(1, ACTIVITY_MAX) + COLUMN_WIDTH + COLUMN_GAP;
  expect(workspaceMaxWidth({ progress: 0, paneWidth: 2400, beside: 0 })).toBe('none');
  expect(workspaceMaxWidth({ progress: 1, paneWidth: 2400, beside })).toBe(CARD_MAX + beside);
  // Part way, the cap stands a share of the pane further out, and only comes in as it settles.
  let last = Number.POSITIVE_INFINITY;
  for (let step = 1; step <= 10; step++) {
    const progress = step / 10;
    const cap = workspaceMaxWidth({ progress, paneWidth: 2400, beside: beside * progress });
    expect(typeof cap).toBe('number');
    expect(cap as number).toBeLessThanOrEqual(last);
    last = cap as number;
  }
});
