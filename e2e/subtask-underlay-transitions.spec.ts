import { expect, type Page, test } from '@playwright/test';

import { card, fixture, settled } from './board-helpers';

/**
 * A parent's subtask underlay as its task screen lands back in the card, and a subtask's screen
 * growing out of and back into its row in the underlay, on a phone (THR-148).
 */
test.describe('subtask underlay transitions on a phone', () => {
  test.skip(
    ({ isMobile, browserName }) => !isMobile && browserName !== 'firefox',
    'Phone task screens; Firefox exercises the same phone viewport.',
  );
  test.beforeEach(async ({ page, isMobile }) => {
    if (!isMobile) await page.setViewportSize({ width: 412, height: 915 });
  });

  async function setUp(page: Page, sizes: Record<string, number>) {
    const board = await fixture(page, true);
    for (const [index, [title, count]] of Object.entries(sizes).entries()) {
      const parent = await board.add(title, 'Build', 3, `a${index}`);
      for (let step = 0; step < count; step++)
        await board.add(`${title} step ${step + 1}`, 'Build', 3, `a${step}`, parent);
    }
    await settled(card(page, Object.keys(sizes).at(-1)!));
    return board;
  }

  const underlayOf = (page: Page, parent: string) =>
    page
      .locator('.board-card-group')
      .filter({ has: card(page, parent) })
      .locator('[data-subtask-underlay]');

  async function unfold(page: Page, parent: string) {
    const underlay = underlayOf(page, parent);
    await underlay.getByRole('button', { name: / subtasks done$/ }).click();
    await expect(underlay.locator('[data-subtask-list]')).toHaveAttribute('data-expanded', '');
    await settled(underlay);
  }

  type Frame = {
    surface: boolean;
    cardTop: number;
    cardBottom: number;
    /** The top of what is drawn of the underlay, after its reveal's clip. */
    drawnTop: number;
    shown: boolean;
    moved: boolean;
  };

  /** Every frame from the call until the parent's card has been shown for a few frames. */
  function sampleLanding(page: Page, parentId: string) {
    return page.evaluate(async (id) => {
      const frames: Frame[] = [];
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const step = () => {
          const article = document.querySelector<HTMLElement>(
            `[data-card-id="${id}"]:not([data-overlay])`,
          )!;
          const underlay =
            article.parentElement!.querySelector<HTMLElement>('[data-subtask-underlay]')!;
          const wrapper = underlay.parentElement!;
          const cardBox = article.getBoundingClientRect();
          const box = underlay.getBoundingClientRect();
          const clip = getComputedStyle(wrapper).clipPath;
          // `polygon(x y, …)`: the first point's y is the clip's top, in the wrapper's box.
          const clipTop = clip.startsWith('polygon')
            ? Number.parseFloat(
                clip
                  .slice(clip.indexOf('(') + 1)
                  .split(',')[0]!
                  .trim()
                  .split(/\s+/)[1]!,
              )
            : Number.NEGATIVE_INFINITY;
          frames.push({
            surface: !!document.querySelector('[data-task-surface]'),
            cardTop: cardBox.top,
            cardBottom: cardBox.bottom,
            drawnTop: Math.max(box.top, wrapper.getBoundingClientRect().top + clipTop),
            shown: getComputedStyle(wrapper).visibility === 'visible',
            moved: getComputedStyle(wrapper).transform !== 'none',
          });
          const gone = frames.findIndex((frame) => !frame.surface);
          if (gone >= 0 && frames.length > gone + 30) return resolve();
          if (performance.now() - start > 5000) return resolve();
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      return frames;
    }, parentId);
  }

  function expectNeverAboveCard(frames: Frame[], reduced: boolean) {
    const drawn = frames.filter((frame) => frame.shown);
    const report = JSON.stringify(
      drawn.map((frame) => [Math.round(frame.drawnTop), Math.round(frame.cardBottom)]),
    );
    expect(drawn.length, report).toBeGreaterThan(0);
    // Nothing of it shows above the card's foot, less the tuck under its rounded corners.
    for (const frame of drawn)
      expect(frame.drawnTop, report).toBeGreaterThanOrEqual(frame.cardBottom - 12 - 1);
    // With motion, it slides out from behind the card; with reduced motion it is simply there.
    expect(
      drawn.some((frame) => frame.moved),
      report,
    ).toBe(!reduced);
    expect(frames.at(-1)!.moved).toBe(false);
  }

  for (const reduced of [false, true]) {
    test(`a landing parent's underlay never rises above its card${reduced ? ', reduced motion' : ''}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
      const board = await setUp(page, { 'Tall epic': 7, 'Short epic': 2, 'Folded epic': 3 });
      await unfold(page, 'Tall epic');
      await unfold(page, 'Short epic');
      for (const parent of ['Tall epic', 'Short epic', 'Folded epic']) {
        await card(page, parent).click();
        const screen = page.getByLabel('Task', { exact: true });
        await expect(screen.getByRole('textbox', { name: 'Task title' })).toHaveValue(parent);
        await page.waitForTimeout(600);
        const frames = sampleLanding(page, board.ids[parent]!);
        await screen.getByRole('button', { name: 'Back to the board' }).click();
        expectNeverAboveCard(await frames, reduced);
        await expect(page.locator('[data-task-screen]')).toHaveCount(0);
      }
    });
  }

  type Shape = { x: number; y: number; width: number; height: number };

  /** The task surface on every frame of an opening or closing, until it rests or is gone. */
  function sampleSurface(page: Page, direction: 'opening' | 'closing') {
    return page.evaluate(async (direction) => {
      const frames: Shape[] = [];
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const step = () => {
          const surface = document.querySelector('[data-task-surface]');
          if (surface) {
            const { x, y, width, height } = surface.getBoundingClientRect();
            frames.push({ x, y, width, height });
            if (
              direction === 'opening' &&
              frames.length > 2 &&
              Math.abs(height - innerHeight) < 0.5
            )
              return resolve();
          } else if (direction === 'closing' && frames.length) return resolve();
          if (performance.now() - start > 5000) return resolve();
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      return frames;
    }, direction);
  }

  function expectNear(frame: Shape | undefined, row: Shape) {
    const report = JSON.stringify({ frame, row });
    expect(frame, report).toBeDefined();
    expect(Math.abs(frame!.y - row.y), report).toBeLessThan(24);
    expect(Math.abs(frame!.width - row.width), report).toBeLessThan(24);
    expect(frame!.height, report).toBeLessThan(row.height * 3);
  }

  test('a subtask grows out of its row in the underlay and shrinks back into it', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await setUp(page, { 'Row epic': 4 });
    const underlay = underlayOf(page, 'Row epic');
    const row = underlay.locator('li[data-task-origin]').nth(2);

    // Folded, its rows are laid out but clipped away: not somewhere a task grows out of.
    await expect(row).toHaveCount(1);
    expect(
      await row.evaluate(async (element) => {
        const { isVisibleOrigin } = await import('/src/components/Board/taskTransition.ts');
        return isVisibleOrigin(element as HTMLElement);
      }),
    ).toBe(false);

    await unfold(page, 'Row epic');
    const rowBox = (await row.boundingBox())!;
    const opening = sampleSurface(page, 'opening');
    await row.getByRole('button', { name: 'Row epic step 3' }).click();
    const opened = await opening;
    expectNear(opened[0], rowBox);
    const screen = page.getByLabel('Task', { exact: true });
    await expect(screen.getByRole('textbox', { name: 'Task title' })).toHaveValue(
      'Row epic step 3',
    );
    await page.waitForTimeout(600);

    const closing = sampleSurface(page, 'closing');
    await screen.getByRole('button', { name: /^Back to the board$/ }).click();
    const closed = await closing;
    expectNear(closed.at(-1), (await row.boundingBox())!);
    await expect(page.locator('[data-task-screen]')).toHaveCount(0);

    // Back by the system's Back too.
    await row.getByRole('button', { name: 'Row epic step 3' }).click();
    await expect(screen.getByRole('textbox', { name: 'Task title' })).toHaveValue(
      'Row epic step 3',
    );
    await page.waitForTimeout(600);
    const backed = sampleSurface(page, 'closing');
    await page.goBack();
    expectNear((await backed).at(-1), (await row.boundingBox())!);
    await expect(page.locator('[data-task-screen]')).toHaveCount(0);
  });

  test('a parent opened from its subtask’s breadcrumb lands in its card, underlay below it', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const board = await setUp(page, { 'Crumb epic': 6 });
    await unfold(page, 'Crumb epic');
    const row = underlayOf(page, 'Crumb epic').locator('li[data-task-origin]').first();
    await row.getByRole('button', { name: 'Crumb epic step 1' }).click();
    const screen = page.getByLabel('Task', { exact: true });
    await expect(screen.getByRole('textbox', { name: 'Task title' })).toHaveValue(
      'Crumb epic step 1',
    );
    await screen.getByRole('button', { name: /^Open parent / }).click();
    await expect(screen.getByRole('textbox', { name: 'Task title' })).toHaveValue('Crumb epic');
    await expect(page.locator('[data-task-screen]')).toHaveCount(1);
    await page.waitForTimeout(600);
    const frames = sampleLanding(page, board.ids['Crumb epic']!);
    await screen.getByRole('button', { name: 'Back to the board' }).click();
    expectNeverAboveCard(await frames, false);
    await expect(page.locator('[data-task-screen]')).toHaveCount(0);
    await expect(underlayOf(page, 'Crumb epic').locator('[data-subtask-list]')).toHaveAttribute(
      'data-expanded',
      '',
    );
  });
});
