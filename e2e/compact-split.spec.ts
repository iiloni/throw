import { expect, type Page, test } from '@playwright/test';
import { card, carry, fixture, settled, taskRow, workspaceFixture } from './board-helpers';

/** An unfolded foldable's inner screen, held in landscape: a desktop, but a narrow one. */
const FOLDABLE = { width: 884, height: 800 };

const compactBoard = (page: Page) => page.locator('[data-compact-board]');
const views = (page: Page) => page.getByRole('tablist', { name: 'Board view' });
const rail = (page: Page, name: 'Backlog' | 'Closed') =>
  page.getByRole('complementary', { name, exact: true });
const flow = (page: Page) => page.getByRole('navigation', { name: 'Columns' });
const dock = (page: Page) => page.locator('[data-compact-dock]');

test.describe('the board beside a task on a narrow desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'A phone has no split view');

  test('takes a phone’s layout beside the task and hands its place back as the task closes', async ({
    page,
  }) => {
    await page.setViewportSize(FOLDABLE);
    await fixture(page);
    // With no task open there is room for the rails and columns.
    await expect(rail(page, 'Backlog')).toBeVisible();
    await expect(compactBoard(page)).toHaveCount(0);

    await card(page, 'Earlier position').click();
    await expect(page.getByRole('separator', { name: 'Resize task' })).toBeVisible();
    await expect(compactBoard(page)).toBeVisible();
    await expect(rail(page, 'Backlog')).toHaveCount(0);
    await expect(rail(page, 'Closed')).toHaveCount(0);
    await expect(views(page).getByRole('tab', { name: /Board/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // The switch is a dock along the half's foot.
    const frame = (await compactBoard(page).boundingBox())!;
    const bar = (await dock(page).boundingBox())!;
    expect(bar.y + bar.height).toBeGreaterThan(frame.y + frame.height - 48);
    // One column across the whole half, the next a page away.
    const build = compactBoard(page).getByRole('region', { name: 'Build', exact: true });
    await expect(build).toBeInViewport();
    const half = (await compactBoard(page).boundingBox())!;
    const column = (await settled(build)).boundingBox();
    expect((await column)!.width).toBeGreaterThan(half.width - 40);
    await expect(
      compactBoard(page).getByRole('region', { name: 'Review', exact: true }),
    ).not.toBeInViewport();

    await flow(page).getByRole('button', { name: 'Review', exact: true }).click();
    await expect(card(page, 'Review this')).toBeInViewport();
    // The turn has landed.
    await expect(flow(page).getByRole('button', { name: 'Review', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // The backlog and closed tasks are views of the same half.
    await views(page)
      .getByRole('tab', { name: /Backlog/ })
      .click();
    await expect(card(page, 'Idea for later')).toBeVisible();
    await expect(card(page, 'Review this')).toBeHidden();
    const idea = (await (await settled(card(page, 'Idea for later'))).boundingBox())!;
    await views(page)
      .getByRole('tab', { name: /Closed/ })
      .click();
    await expect(card(page, 'Finished')).toBeVisible();
    await views(page).getByRole('tab', { name: /Board/ }).click();
    await expect(card(page, 'Review this')).toBeInViewport();
    // Shown again, the backlog's cards are where they were, not laid out afresh.
    await views(page)
      .getByRole('tab', { name: /Backlog/ })
      .click();
    expect(await card(page, 'Idea for later').boundingBox()).toEqual(idea);
    await page.waitForTimeout(300);
    expect(await card(page, 'Idea for later').boundingBox()).toEqual(idea);
    await views(page).getByRole('tab', { name: /Board/ }).click();
    await expect(card(page, 'Review this')).toBeInViewport();

    // The task closes, and the full board comes back on the column the compact one was on.
    await page.getByRole('button', { name: 'Back to the board', exact: true }).click();
    await expect(compactBoard(page)).toHaveCount(0);
    await expect(rail(page, 'Backlog')).toBeVisible();
    await expect(card(page, 'Review this')).toBeInViewport();
  });

  test('keeps the full layout while there is room, and changes once the split handle takes it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await fixture(page);
    await card(page, 'Earlier position').click();
    const handle = page.getByRole('separator', { name: 'Resize task' });
    await expect(handle).toBeVisible();
    await expect(rail(page, 'Backlog')).toBeVisible();
    await expect(compactBoard(page)).toHaveCount(0);

    // Widening the task leaves the board too narrow for its rails.
    await handle.focus();
    for (let step = 0; step < 4; step++) await page.keyboard.press('ArrowLeft');
    await expect(compactBoard(page)).toBeVisible();
    await expect(card(page, 'Earlier position')).toBeInViewport();
    // The task stays open throughout.
    await expect(page.getByRole('region', { name: 'Task', exact: true })).toBeVisible();

    // Narrowing it back gives the board its rails again.
    // Past where it began: once compact, the board waits for clear room to change back.
    for (let step = 0; step < 6; step++) await page.keyboard.press('ArrowRight');
    await expect(compactBoard(page)).toHaveCount(0);
    await expect(rail(page, 'Backlog')).toBeVisible();
  });

  test('sends a held card to another view’s status, or opens the columns to place it', async ({
    page,
  }) => {
    await page.setViewportSize(FOLDABLE);
    const board = await fixture(page);
    await card(page, 'Earlier position').click();
    await expect(compactBoard(page)).toBeVisible();

    // A column's card dropped on a closed status finishes it.
    const targets = compactBoard(page).locator('[data-drop-status]');
    await carry(page, card(page, 'Low priority'), [
      { x: 300, y: 300 },
      compactBoard(page).locator('[data-drop-status]').filter({ hasText: /^Done/ }),
    ]);
    await expect(targets).toHaveCount(0);
    await expect
      .poll(async () => (await taskRow(page, board.headers, board.ids['Low priority']!))?.status_id)
      .toBe(board.status('Done'));

    // A backlog card held on the board's target opens the columns, and is placed in one.
    await views(page)
      .getByRole('tab', { name: /Backlog/ })
      .click();
    await carry(
      page,
      card(page, 'Idea for later'),
      [{ x: 300, y: 400 }, compactBoard(page).locator('[data-drop-expand]')],
      { drop: false, pause: 700 },
    );
    // The dock holds the targets while the card is held; the columns are behind it.
    await expect(compactBoard(page).locator('[data-view="board"]')).toBeVisible();
    await expect(compactBoard(page).locator('[data-view="backlog"]')).toBeHidden();
    const later = await settled(card(page, 'Later position'));
    const box = (await later.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 10, { steps: 12 });
    await page.waitForTimeout(200);
    await page.mouse.up();
    await expect
      .poll(
        async () => (await taskRow(page, board.headers, board.ids['Idea for later']!))?.status_id,
      )
      .toBe(board.status('Build'));
    // The task stays open.
    await expect(page.getByRole('region', { name: 'Task', exact: true })).toBeVisible();
  });

  test('its dock slides away as a list scrolls down, and back as it scrolls up', async ({
    page,
  }) => {
    await page.setViewportSize({ ...FOLDABLE, height: 560 });
    const board = await fixture(page);
    for (let index = 0; index < 8; index++)
      await board.add(`More work ${index + 1}`, 'Build', 3, `b${index}`);
    await card(page, 'Earlier position').click();
    await expect(compactBoard(page)).toBeVisible();
    await expect(card(page, 'More work 8')).toBeAttached();
    await expect(dock(page)).toBeInViewport();

    const build = compactBoard(page).getByRole('region', { name: 'Build', exact: true });
    const box = (await build.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 400);
    await expect(dock(page)).toHaveAttribute('data-away', '');
    await expect(dock(page)).not.toBeInViewport();
    await page.mouse.wheel(0, 4000);
    await page.mouse.wheel(0, -60);
    await expect(dock(page)).not.toHaveAttribute('data-away');
    await expect(dock(page)).toBeInViewport();
    // Near the list's end, its last card stays clear of the dock.
    const last = (await (await settled(card(page, 'More work 8'))).boundingBox())!;
    const shown = (await (await settled(dock(page))).boundingBox())!;
    expect(last.y + last.height).toBeLessThan(shown.y);

    // Turning to another column brings the dock back too.
    await page.mouse.wheel(0, 400);
    await expect(dock(page)).toHaveAttribute('data-away', '');
    await flow(page).getByRole('button', { name: 'Review', exact: true }).click();
    await expect(dock(page)).not.toHaveAttribute('data-away');
  });

  test('opens a task made from its create button beside it, without starting over', async ({
    page,
  }) => {
    await page.setViewportSize(FOLDABLE);
    await fixture(page);
    await card(page, 'Review this').click();
    await expect(compactBoard(page)).toBeVisible();
    await page.waitForTimeout(600);
    // The create button floats beside the dock, not in it, and makes a task in the column on
    // screen: the opened task's own.
    const create = page.getByRole('button', { name: 'New task in Review', exact: true });
    await expect(create).toBeVisible();
    await expect(dock(page).locator('.glass-thick').getByRole('button')).toHaveCount(0);
    await compactBoard(page).evaluate((frame) => {
      (frame as HTMLElement & { kept?: boolean }).kept = true;
    });
    await create.click();
    await expect(page.getByRole('region', { name: 'Task', exact: true })).toContainText(
      /BRD-\d+|Pending/,
    );
    await expect(card(page, 'New task')).toBeVisible();
    // The same board, still at full strength: it never took the full layout in between.
    expect(
      await compactBoard(page).evaluate((frame) => ({
        kept: (frame as HTMLElement & { kept?: boolean }).kept,
        opacity: getComputedStyle(frame).opacity,
      })),
    ).toEqual({ kept: true, opacity: '1' });
  });

  test('cross-fades into the half at its resting width, on the tapped card’s view and column', async ({
    page,
  }) => {
    await page.setViewportSize(FOLDABLE);
    await fixture(page);
    await page.evaluate(() => {
      const frames: { width: number | null; still: boolean; filled: boolean }[] = [];
      (window as unknown as { frames_: typeof frames }).frames_ = frames;
      const sample = () => {
        const board = document.querySelector('[data-compact-board]');
        const still = document.querySelector('[data-layout-swap]');
        frames.push({
          width: board ? board.getBoundingClientRect().width : null,
          still: still !== null,
          // The half shows something: the layout going, still, or the one coming.
          filled:
            still !== null ||
            board !== null ||
            document.querySelector('[data-board-layout]') !== null,
        });
        if (frames.length < 90) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await card(page, 'Review this').click();
    await expect(compactBoard(page)).toBeVisible();
    await page.waitForFunction(
      () => (window as unknown as { frames_: unknown[] }).frames_.length >= 90,
    );
    const frames = await page.evaluate(
      () =>
        (
          window as unknown as {
            frames_: { width: number | null; still: boolean; filled: boolean }[];
          }
        ).frames_,
    );
    const compact = frames.filter((frame) => frame.width !== null);
    expect(compact.length).toBeGreaterThan(0);
    expect(frames.every((frame) => frame.filled)).toBe(true);
    // The layout going fades out over the one coming, and is gone once it has.
    expect(compact[0]!.still).toBe(true);
    await expect(page.locator('[data-layout-swap]')).toHaveCount(0);
    // Laid out once, at the width it rests at, while the pane slides in beside it.
    const widths = compact.map((frame) => frame.width!);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
    // Its resting width is the half's.
    const half = await compactBoard(page).evaluate((frame) => ({
      frame: frame.getBoundingClientRect().width,
      row: frame.parentElement!.getBoundingClientRect().width,
    }));
    expect(Math.abs(half.frame - half.row)).toBeLessThan(1);
    // It opens on the tapped card's column.
    await expect(card(page, 'Review this')).toBeInViewport();

    // A backlog card opens it on the backlog.
    await page.getByRole('button', { name: 'Back to the board', exact: true }).click();
    await expect(compactBoard(page)).toHaveCount(0);
    await page.getByRole('button', { name: /^Open backlog,/ }).click();
    await card(page, 'Idea for later').click();
    await expect(views(page).getByRole('tab', { name: /Backlog/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(card(page, 'Idea for later')).toBeInViewport();
  });

  test('the cross-project board pages through its categories beside a task', async ({ page }) => {
    await page.setViewportSize(FOLDABLE);
    await workspaceFixture(page);
    await card(page, 'Prune roses').click();
    await expect(compactBoard(page)).toBeVisible();
    // It opens on the work in progress.
    await expect(card(page, 'Water tomatoes')).toBeInViewport();
    await expect(card(page, 'Pick apples')).not.toBeInViewport();
    await flow(page).getByRole('button', { name: 'Done', exact: true }).click();
    await expect(card(page, 'Pick apples')).toBeInViewport();
    await page.getByRole('button', { name: 'Back to the board', exact: true }).click();
    await expect(compactBoard(page)).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Active', exact: true })).toBeVisible();
  });
});
