import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { card, carry, finger, fixture, settled, taskRow, workspaceFixture } from './board-helpers';
import { APP_LOAD_TIMEOUT } from './helpers';

const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
// A phone's folded handle also says how many tasks the column holds.
const expand = (page: Page, name: string) =>
  page.getByRole('button', { name: new RegExp(`^Expand ${name} column(, \\d+ tasks?)?$`) });
/** A column's segment on a phone's flow track, named with its count. */
const segment = (name: string) => new RegExp(`^${name}, \\d+ tasks?$`);
const collapse = (page: Page, name: string) =>
  page.getByRole('button', { name: `Collapse ${name} column`, exact: true });

test.describe('desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'A phone pages through its columns and does not fold them');
  test.beforeEach(async ({ page }) => page.setViewportSize({ width: 1440, height: 900 }));

  test('a column folds to a strip and opens again, by pointer and keyboard, remembered per project', async ({
    page,
  }) => {
    const board = await fixture(page);
    await collapse(page, 'Review').click();
    await expect(expand(page, 'Review')).toHaveAttribute('aria-expanded', 'false');
    await expect(card(page, 'Review this')).toHaveCount(0);
    await expect(region(page, 'Review')).toContainText('1');
    // Focus moves to the control that took the folded one's place.
    await expect(expand(page, 'Review')).toBeFocused();
    const strip = (await settled(region(page, 'Review'))).boundingBox();
    expect((await strip)!.width).toBe(64);

    await page.reload();
    await expect(expand(page, 'Review')).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(card(page, 'Earlier position')).toBeVisible();
    await expect(card(page, 'Review this')).toHaveCount(0);

    // Kept for this project alone.
    const stored = await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith('throw-board-collapsed:')),
    );
    expect(stored).toEqual([`throw-board-collapsed:${board.projectId}`]);

    await expand(page, 'Review').focus();
    await page.keyboard.press('Enter');
    await expect(card(page, 'Review this')).toBeVisible();
    await expect(collapse(page, 'Review')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(expand(page, 'Review')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(card(page, 'Review this')).toBeVisible();
    await page.reload();
    await expect(card(page, 'Review this')).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  });

  test('a card dropped on a folded column is sent there, keeping its priority, and the strip stays put', async ({
    page,
  }) => {
    const board = await fixture(page);
    await collapse(page, 'Review').click();
    const strip = expand(page, 'Review');
    const before = await (await settled(strip)).boundingBox();
    await carry(page, card(page, 'Earlier position'), [strip], { drop: false });
    await expect(strip).toHaveAttribute('data-over', '');
    // The strip neither opens nor moves under the held card.
    expect(await strip.boundingBox()).toEqual(before);
    await page.mouse.up();
    await expect
      .poll(async () => {
        const row = await taskRow(page, board.headers, board.ids['Earlier position']!);
        return [row?.status_id, String(row?.priority)];
      })
      .toEqual([board.status('Review'), '3']);
    await expect(page.locator('[data-overlay]')).toHaveCount(0);
    await expect(strip).toContainText('2');
    await expect(card(page, 'Earlier position')).toHaveCount(0);
  });

  test('a card carried from the keyboard into a folded column opens it and is written once', async ({
    page,
  }) => {
    const board = await fixture(page);
    await collapse(page, 'Review').click();
    const held = card(page, 'Earlier position');
    await held.focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowRight');
    await expect(collapse(page, 'Review')).toHaveAttribute('aria-expanded', 'true');
    await expect(
      region(page, 'Review').getByRole('article', { name: /Earlier position$/ }),
    ).toBeFocused();
    await page.keyboard.press('Space');
    await expect
      .poll(
        async () => (await taskRow(page, board.headers, board.ids['Earlier position']!))?.status_id,
      )
      .toBe(board.status('Review'));
    await page.reload();
    await expect(card(page, 'Review this')).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  });

  test('a task opened by link from a folded column opens the column, and closing finds its card', async ({
    page,
  }) => {
    const board = await fixture(page);
    await collapse(page, 'Review').click();
    await expect(card(page, 'Review this')).toHaveCount(0);
    await page.goto(
      `/w/${board.workspaceId}/p/${board.projectId}?view=board&task=${board.ids['Review this']}`,
    );
    const pane = page.getByRole('region', { name: 'Task', exact: true });
    await expect(pane.getByRole('textbox', { name: 'Task title' })).toHaveValue('Review this', {
      timeout: APP_LOAD_TIMEOUT,
    });
    await expect(card(page, 'Review this')).toBeVisible();
    await expect(collapse(page, 'Review')).toBeVisible();
    await page.getByRole('button', { name: 'Back to the board', exact: true }).click();
    await expect(pane).toHaveCount(0);
    await expect(card(page, 'Review this')).toBeVisible();
  });

  test('the workspace board folds any category, and a folded one takes cards at the default status', async ({
    page,
  }) => {
    const board = await workspaceFixture(page);
    // Cancelled starts folded.
    await expect(expand(page, 'Cancelled')).toBeVisible();
    await collapse(page, 'Done').click();
    await expect(card(page, 'Wash up')).toHaveCount(0);
    const strip = expand(page, 'Done');
    const before = await (await settled(strip)).boundingBox();
    await carry(page, card(page, 'Water tomatoes'), [strip], { drop: false });
    await expect(strip).toHaveAttribute('data-over', '');
    expect(await strip.boundingBox()).toEqual(before);
    await page.mouse.up();
    await expect
      .poll(
        async () => (await taskRow(page, board.headers, board.ids['Water tomatoes']!))?.status_id,
      )
      .toBe(board.statusIds.Harvested);
    await page.reload();
    await expect(expand(page, 'Done')).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expand(page, 'Done').click();
    await expect(card(page, 'Water tomatoes')).toBeVisible();
  });
});

test.describe('phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'Phone layout');

  /** The fixture's board with a third active column, Testing, between Build and Review. */
  async function threeColumns(page: Page) {
    const board = await fixture(page);
    const testing = randomUUID();
    const response = await page.request.post('/api/statuses', {
      headers: board.headers,
      data: {
        id: testing,
        projectId: board.projectId,
        category: 'active',
        name: 'Testing',
        position: 'a0V',
        isDefault: false,
      },
    });
    expect(response.status()).toBe(201);
    const columns = page.getByRole('navigation', { name: 'Columns' });
    await expect(columns.getByRole('button')).toHaveCount(3);
    return { ...board, testing, columns };
  }

  const current = (page: Page) =>
    page.getByRole('navigation', { name: 'Columns' }).locator('[aria-current="page"]');

  test('a folded column is skipped by a swipe, remembered, and opens again from its handle', async ({
    page,
    browserName,
  }) => {
    const board = await threeColumns(page);
    await board.columns.getByRole('button', { name: segment('Testing') }).click();
    await expect(current(page)).toHaveAccessibleName(segment('Testing'));
    await collapse(page, 'Testing').click();
    // The next column takes its place, and the folded one is a handle that has focus.
    await expect(current(page)).toHaveAccessibleName(segment('Review'));
    await expect(card(page, 'Review this')).toBeInViewport();
    await expect(expand(page, 'Testing')).toHaveAttribute('aria-expanded', 'false');
    await expect(expand(page, 'Testing')).toBeFocused();
    await expect(page.locator('[data-pager] > [data-page]')).toHaveCount(2);
    // The last column left open does not fold.
    await collapse(page, 'Review').click();
    await expect(collapse(page, 'Build')).toHaveCount(0);
    await expect(current(page)).toHaveAccessibleName(segment('Build'));
    await expand(page, 'Review').click();
    await expect(current(page)).toHaveAccessibleName(segment('Review'));
    await expect(card(page, 'Review this')).toBeInViewport();

    await page.reload();
    await expect(expand(page, 'Testing')).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(current(page)).toHaveAccessibleName(segment('Build'));
    // Build is followed by Review: one swipe turns straight to it.
    await expect(page.getByRole('button', { name: 'Review', exact: true }).last()).toBeVisible();
    if (browserName === 'chromium') {
      const touch = await finger(page);
      const box = (await (await settled(card(page, 'Low priority'))).boundingBox())!;
      const from = { x: box.x + box.width - 24, y: box.y + box.height / 2 };
      await touch.press(from, 30);
      await touch.move({ x: box.x + 24, y: from.y }, 250);
      await touch.lift();
    } else {
      await board.columns.getByRole('button', { name: segment('Review') }).click();
    }
    await expect(current(page)).toHaveAccessibleName(segment('Review'));
    await expect(card(page, 'Review this')).toBeInViewport();

    // The handle opens the column and turns back to it.
    await expand(page, 'Testing').click();
    await expect(current(page)).toHaveAccessibleName(segment('Testing'));
    await expect(page.locator('[data-pager] > [data-page]')).toHaveCount(3);
    await expect(collapse(page, 'Testing')).toBeVisible();
    await page.reload();
    await expect(board.columns.getByRole('button', { name: segment('Testing') })).toBeVisible({
      timeout: APP_LOAD_TIMEOUT,
    });
    await expect(expand(page, 'Testing')).toHaveCount(0);
  });

  test('a column folded on a desktop is a handle on a phone, and the pager always keeps one column', async ({
    page,
  }) => {
    const board = await fixture(page);
    await page.evaluate(
      ([key, id]) => localStorage.setItem(key!, JSON.stringify([id])),
      [`throw-board-collapsed:${board.projectId}`, board.status('Review')],
    );
    await page.reload();
    await expect(expand(page, 'Review')).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.locator('[data-pager] > [data-page]')).toHaveCount(1);
    await expect(card(page, 'Review this')).toHaveCount(0);
    // The last column on screen keeps its page.
    await expect(collapse(page, 'Build')).toHaveCount(0);

    // Every column folded still leaves the first on screen.
    await page.evaluate(
      ([key, ...ids]) => localStorage.setItem(key!, JSON.stringify(ids)),
      [`throw-board-collapsed:${board.projectId}`, board.status('Review'), board.status('Build')],
    );
    await page.reload();
    await expect(card(page, 'Low priority')).toBeInViewport({ timeout: APP_LOAD_TIMEOUT });
    await expand(page, 'Review').click();
    await expect(card(page, 'Review this')).toBeInViewport();
    await expect(page.locator('[data-pager] > [data-page]')).toHaveCount(2);
  });
});
