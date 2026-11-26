import { expect, type Page, test } from '@playwright/test';
import { card, carry, fixture, settled, taskRow, workspaceFixture } from './board-helpers';

/** An unfolded foldable's inner screen, held in landscape: a desktop, but a narrow one. */
const FOLDABLE = { width: 884, height: 800 };

const compactBoard = (page: Page) => page.locator('[data-compact-board]');
const views = (page: Page) => page.getByRole('tablist', { name: 'Board view' });
const rail = (page: Page, name: 'Backlog' | 'Closed') =>
  page.getByRole('complementary', { name, exact: true });
const flow = (page: Page) => page.getByRole('navigation', { name: 'Columns' });

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
    await views(page)
      .getByRole('tab', { name: /Closed/ })
      .click();
    await expect(card(page, 'Finished')).toBeVisible();
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
    await card(page, 'Review this').click();
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
    await expect(views(page).getByRole('tab', { name: /Board/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
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
