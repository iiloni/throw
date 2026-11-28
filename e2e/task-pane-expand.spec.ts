import { expect, type Page, test } from '@playwright/test';
import { card, fixture } from './board-helpers';
import { APP_LOAD_TIMEOUT } from './helpers';

/** The expanded pane (ADR 0012): Catch's “Expand note” beside Back, over the whole board. */

const pane = (page: Page) => page.getByLabel('Task', { exact: true });
const boardUnder = (page: Page) => page.locator('[data-board-under-pane]');
const activity = (page: Page) => page.getByRole('complementary', { name: 'Task activity' });
const expandButton = (page: Page) => pane(page).getByRole('button', { name: 'Expand task' });
const collapseButton = (page: Page) => pane(page).getByRole('button', { name: 'Show the board' });
const width = async (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((element) => element.getBoundingClientRect().width);

async function openTask(page: Page, title = 'Earlier position') {
  await card(page, title).click();
  await expect(pane(page)).toBeVisible();
  await expect(pane(page).locator('.bn-editor[contenteditable="true"]')).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
}

/** The pane frame's width on every painted frame until it rests at `goal`. */
function sampleFrames(page: Page, goal: number) {
  return page.evaluate(
    (goal) =>
      new Promise<{ frame: number; card: number }[]>((resolve) => {
        const samples: { frame: number; card: number }[] = [];
        const started = performance.now();
        let rested = 0;
        const step = () => {
          const frame = document.querySelector('[data-task-pane-frame]');
          const card = document.querySelector('[aria-label="Task"] [data-task-card]');
          const sample = {
            frame: frame?.getBoundingClientRect().width ?? 0,
            card: card?.getBoundingClientRect().width ?? 0,
          };
          samples.push(sample);
          if (Math.abs(sample.frame - goal) < 1) rested += 1;
          if (rested >= 3 || performance.now() - started > 4000) return resolve(samples);
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    goal,
  );
}

test.describe('the expanded task pane', () => {
  test.skip(({ isMobile }) => isMobile, 'A phone’s task already has the whole screen');

  test('springs over the board on a narrow desktop and gives it back as it was', async ({
    page,
    browser,
  }, testInfo) => {
    testInfo.annotations.push({ type: 'browser version', description: browser.version() });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await fixture(page);
    await openTask(page);
    const split = await width(page, '[data-task-pane-frame]');
    const board = await boardUnder(page).boundingBox();
    const full = split + board!.width;

    // Expanding grows the pane continuously to the board's whole width, the card with it.
    const growing = sampleFrames(page, full);
    await expandButton(page).click();
    const grown = await growing;
    expect(grown.filter((s) => s.frame > split + 20 && s.frame < full - 20).length).toBeGreaterThan(
      3,
    );
    for (let index = 1; index < grown.length; index++)
      expect(grown[index]!.frame).toBeGreaterThanOrEqual(grown[index - 1]!.frame - 1);
    await expect(collapseButton(page)).toBeVisible();
    // The board stays mounted beneath, laid out for the split, and out of reach.
    await expect(boardUnder(page)).toHaveAttribute('inert', '');
    await expect(boardUnder(page)).toHaveCSS('visibility', 'hidden');
    expect((await boardUnder(page).boundingBox())?.width ?? board!.width).toBeCloseTo(
      board!.width,
      0,
    );
    await expect(page.getByRole('separator', { name: 'Resize task' })).toHaveCount(0);
    // Under the workspace's breakpoint, the card keeps its comments.
    await expect(activity(page)).toHaveCount(0);
    await expect(pane(page).getByRole('region', { name: 'Task history' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('narrow-expanded.png') });
    // A wider window: it follows the board's new width at once.
    await page.setViewportSize({ width: 1360, height: 800 });
    await expect.poll(() => width(page, '[data-task-pane-frame]')).toBeCloseTo(full + 80, 0);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect.poll(() => width(page, '[data-task-pane-frame]')).toBeCloseTo(full, 0);

    // Its shortcut collapses it again, to the split it came from.
    const shrinking = sampleFrames(page, split);
    await page.locator('body').press('f');
    await shrinking;
    await expect(expandButton(page)).toBeVisible();
    await expect(boardUnder(page)).not.toHaveAttribute('inert');
    await expect(boardUnder(page)).toHaveCSS('opacity', '1');
    await expect(page.getByRole('separator', { name: 'Resize task' })).toBeVisible();
    expect(Math.round(await width(page, '[data-task-pane-frame]'))).toBe(Math.round(split));

    // Escape leaves an expanded task as it leaves a split one; the next opens expanded.
    await expandButton(page).click();
    await expect(boardUnder(page)).toHaveCSS('visibility', 'hidden');
    await page.locator('body').press('Escape');
    await expect(pane(page)).toHaveCount(0);
    await expect(boardUnder(page)).toHaveCSS('opacity', '1');
    await expect(card(page, 'Earlier position')).toBeVisible();
    await openTask(page, 'Review this');
    await expect(collapseButton(page)).toBeVisible();
    await expect.poll(() => width(page, '[data-task-pane-frame]')).toBeCloseTo(full, 0);
    await collapseButton(page).click();
    await expect.poll(() => width(page, '[data-task-pane-frame]')).toBeCloseTo(split, 0);
  });

  test('becomes a workspace on a wide monitor, with comments beside the description', async ({
    page,
    browser,
  }, testInfo) => {
    testInfo.annotations.push({ type: 'browser version', description: browser.version() });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await fixture(page);
    await openTask(page, 'Board parent');
    await expect(activity(page)).toHaveCount(0);
    await expandButton(page).click();

    // Comments and history leave the card for their own pane, which scrolls on its own; the
    // subtasks are in the column beside the card, and only one copy of each can be reached.
    await expect(activity(page)).toBeVisible();
    await expect(pane(page).getByRole('region', { name: 'Task history' })).toHaveCount(1);
    await expect(activity(page).getByRole('region', { name: 'Task history' })).toBeVisible();
    const column = pane(page).getByRole('complementary', { name: 'Task sidebar' });
    await expect(column).toBeVisible();
    await expect(column.getByRole('region', { name: 'Subtasks' })).toBeVisible();
    await expect
      .poll(async () => {
        const [cardBox, columnBox, activityBox] = await Promise.all([
          pane(page).locator('[data-task-card]').boundingBox(),
          column.boundingBox(),
          activity(page).boundingBox(),
        ]);
        return (
          cardBox!.x + cardBox!.width <= columnBox!.x + 1 &&
          columnBox!.x + columnBox!.width <= activityBox!.x + 1 &&
          Math.abs(cardBox!.height - activityBox!.height) < 2
        );
      })
      .toBe(true);
    // The card keeps a reading measure, and the workspace stands centred on the screen. The
    // order above holds while the pane still springs open, so the width is read once it rests.
    await expect
      .poll(() => width(page, '[aria-label="Task"] [data-task-card]'))
      .toBeGreaterThan(600);
    expect(await width(page, '[aria-label="Task"] [data-task-card]')).toBeLessThanOrEqual(841);

    // A comment is written in the pane, beside the description.
    await page.locator('body').press('c');
    const composer = activity(page).locator('.comment-composer [contenteditable="true"]');
    await expect(composer).toBeFocused({ timeout: APP_LOAD_TIMEOUT });
    await page.keyboard.type('Reviewed beside the description');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(
      activity(page)
        .getByRole('article', { name: 'You commented' })
        .getByText('Reviewed beside the description'),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('wide-workspace.png') });

    // Collapsing brings them back into the card.
    await collapseButton(page).click();
    await expect(activity(page)).toHaveCount(0);
    const inline = pane(page).locator('[data-task-card]').getByRole('region', {
      name: 'Task history',
    });
    await expect(inline).toBeVisible();
    await expect(
      inline
        .getByRole('article', { name: 'You commented' })
        .getByText('Reviewed beside the description'),
    ).toBeVisible();
  });

  test('leaves the compact board beside a task as it is while expanding and collapsing', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 884, height: 800 });
    await fixture(page);
    await openTask(page);
    const compact = page.locator('[data-compact-board]');
    await expect(compact).toBeVisible();
    const before = await compact.boundingBox();
    await expandButton(page).click();
    await expect(boardUnder(page)).toHaveCSS('visibility', 'hidden');
    // Still the compact layout beneath, at its split width.
    await expect(compact).toHaveCount(1);
    expect(await compact.boundingBox()).toEqual(before);
    await collapseButton(page).click();
    await expect(boardUnder(page)).toHaveCSS('opacity', '1');
    await expect(compact).toBeVisible();
    expect(await compact.boundingBox()).toEqual(before);
  });
});
