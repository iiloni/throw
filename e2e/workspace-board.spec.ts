import { expect, type Locator, type Page, test } from '@playwright/test';
import { card, carry, finger, settled, taskRow, workspaceFixture } from './board-helpers';

const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const names = (cards: Locator) =>
  cards.evaluateAll((items) =>
    items.map((item) => item.getAttribute('aria-label')?.replace(/^\S+ /, '')).sort(),
  );
// Within a band, projects' cards interleave in no promised order, so these compare sets.
const titles = (page: Page, name: string) => names(column(page, name).getByRole('article'));
const band = (page: Page, name: string, priority: string) =>
  names(column(page, name).getByRole('region', { name: priority }).getByRole('article'));

test.describe('desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'The phone has its own test');

  test('every project meets in category columns, banded by priority and colored by project', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await workspaceFixture(page);
    // Bands by priority, across projects.
    await expect(card(page, 'Prune roses')).toBeVisible();
    expect(await band(page, 'Active', 'Critical')).toEqual(['Bake bread', 'Water tomatoes']);
    expect(await band(page, 'Active', 'Default')).toEqual(['Simmer stock', 'Taste the soup']);
    expect(await band(page, 'Active', 'Low')).toEqual(['Prune roses']);
    const regions = await column(page, 'Active')
      .getByRole('region')
      .evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')));
    expect(regions).toEqual(['Critical', 'Default', 'Low']);
    await expect(card(page, 'Water tomatoes')).toHaveAttribute('data-color', 'orange');
    await expect(card(page, 'Bake bread')).toHaveAttribute('data-color', 'teal');
    await expect(card(page, 'Water tomatoes')).toContainText('GDN-');
    expect(await titles(page, 'Done')).toEqual(['Pick apples', 'Wash up']);
    // Cancelled starts folded, and opening it is remembered.
    await expect(column(page, 'Cancelled').getByRole('article')).toHaveCount(0);
    await page.getByRole('button', { name: 'Expand Cancelled column' }).click();
    await expect(card(page, 'Flambé')).toBeVisible();
    await page.reload();
    await expect(card(page, 'Flambé')).toBeVisible({ timeout: 30_000 });
  });

  test('a held card offers its own project’s statuses, and the column takes it to the default', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const board = await workspaceFixture(page);
    // Onto one of Kitchen's active statuses, from its own column.
    await carry(page, card(page, 'Simmer stock'), [column(page, 'Done'), column(page, 'Active')], {
      drop: false,
    });
    const tasting = page.locator(`[data-drop-status="${board.statusIds.Tasting}"]`);
    await expect(column(page, 'Active')).toContainText('Kitchen · Active');
    // Garden's statuses are not offered for a Kitchen card.
    await expect(page.locator(`[data-drop-status="${board.statusIds.Growing}"]`)).toHaveCount(0);
    const box = (await tasting.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await expect
      .poll(async () => (await taskRow(page, board.headers, board.ids['Simmer stock']!))?.status_id)
      .toBe(board.statusIds.Tasting);
    // Onto the Done column but no status: Garden's default done status.
    await expect(page.locator('[data-overlay]')).toHaveCount(0);
    await carry(page, card(page, 'Water tomatoes'), [column(page, 'Done')], { drop: false });
    const label = column(page, 'Done').getByText('Garden · Done');
    const at = (await label.boundingBox())!;
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2, { steps: 6 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await expect
      .poll(
        async () => (await taskRow(page, board.headers, board.ids['Water tomatoes']!))?.status_id,
      )
      .toBe(board.statusIds.Harvested);
    await expect(
      column(page, 'Done').getByRole('article', { name: /Water tomatoes$/ }),
    ).toBeVisible();
  });

  test('a card just picked up keeps its column until it moves', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await workspaceFixture(page);
    const active = column(page, 'Active');
    const start = (await card(page, 'Simmer stock').boundingBox())!;
    const x = start.x + start.width / 2;
    const y = start.y + start.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 4, y + 8, { steps: 4 });
    await expect(page.locator('[data-overlay]')).toBeVisible();
    await page.waitForTimeout(300);
    // Its own column does not turn into its statuses under a card that has not moved.
    await expect(active).not.toContainText('Kitchen · Active');
    await page.mouse.move(x, y + 40, { steps: 6 });
    await expect(active).toContainText('Kitchen · Active');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(page.locator('[data-overlay]')).toHaveCount(0);
  });

  test('a selection across projects moves to a category, each to its own default status', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const board = await workspaceFixture(page);
    await card(page, 'Bake bread').click({ modifiers: ['ControlOrMeta'] });
    await card(page, 'Prune roses').click({ modifiers: ['ControlOrMeta'] });
    await expect(page.getByText('2 selected')).toBeVisible();
    await page
      .getByRole('toolbar', { name: 'Selected tasks' })
      .getByRole('button', { name: 'Change status' })
      .click();
    await page
      .getByRole('region', { name: 'Status', exact: true })
      .locator('[data-drop-status="category:done"]')
      .click();
    await expect
      .poll(async () => [
        (await taskRow(page, board.headers, board.ids['Bake bread']!))?.status_id,
        (await taskRow(page, board.headers, board.ids['Prune roses']!))?.status_id,
      ])
      .toEqual([board.statusIds.Served, board.statusIds.Harvested]);
  });

  test('a card opens its task beside the board, from its own project', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await workspaceFixture(page);
    await card(page, 'Prune roses').click();
    const pane = page.getByLabel('Task', { exact: true });
    await expect(pane).toBeVisible();
    await expect(pane.getByRole('textbox', { name: 'Task title' })).toHaveValue('Prune roses');
    await expect(pane).toContainText('GDN-3');
    // A subtask added here belongs to the card's own project and opens as a new task.
    await pane.getByRole('button', { name: 'Add subtask', exact: true }).click();
    const title = pane.getByRole('textbox', { name: 'Task title' });
    await expect(title).toBeFocused();
    await page.keyboard.type('Sharpen the shears');
    await title.press('Enter');
    await expect(pane.getByRole('button', { name: 'Open parent GDN-3' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(title).toHaveValue('Prune roses');
    await expect(pane.getByRole('article', { name: /^GDN-\d+ Sharpen the shears$/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(pane).toHaveCount(0);
  });

  test('the open task lives in the URL here too: reload keeps it, Back closes it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const fixture = await workspaceFixture(page);
    await card(page, 'Prune roses').click();
    const pane = page.getByLabel('Task', { exact: true });
    await expect(page).toHaveURL(new RegExp(`/w/${fixture.workspaceId}/board\\?.*task=`));
    await page.reload();
    await expect(pane.getByRole('textbox', { name: 'Task title' })).toHaveValue('Prune roses');
    await page.goBack();
    await expect(pane).toHaveCount(0);
    await expect(page).not.toHaveURL(/task=/);
  });
});

test.describe('phone', () => {
  test.skip(({ isMobile, browserName }) => !isMobile || browserName !== 'chromium', 'Touch input');

  test('swiping right over a workspace card turns to the previous category instead of closing it', async ({
    page,
  }) => {
    const board = await workspaceFixture(page);
    const columns = page.getByRole('navigation', { name: 'Columns' });
    const touch = await finger(page);
    const beforeStatus = (await taskRow(page, board.headers, board.ids['Bake bread']!))?.status_id;
    const box = (await (await settled(card(page, 'Bake bread'))).boundingBox())!;
    const start = { x: box.x + 24, y: box.y + box.height / 2 };
    await touch.press(start, 30);
    await touch.move({ x: box.x + box.width - 24, y: start.y }, 250);
    await touch.lift();
    await expect(columns.getByRole('button', { name: 'Backlog' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.waitForTimeout(400);
    expect((await taskRow(page, board.headers, board.ids['Bake bread']!))?.status_id).toBe(
      beforeStatus,
    );
  });

  test('the board pages through categories and the move drawer follows the cards’ projects', async ({
    page,
  }) => {
    const board = await workspaceFixture(page);
    const columns = page.getByRole('navigation', { name: 'Columns' });
    await expect(columns.getByRole('button', { name: 'Active' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const touch = await finger(page);
    // One Kitchen card: Kitchen's statuses.
    await touch.press(card(page, 'Bake bread'));
    await touch.lift();
    await expect(page.getByText('1 selected')).toBeVisible();
    await touch.tap(
      page
        .getByRole('toolbar', { name: 'Selected tasks' })
        .getByRole('button', { name: 'Change status' }),
    );
    await expect(page.locator(`[data-drop-status="${board.statusIds.Tasting}"]`)).toBeVisible();
    await expect(page.locator(`[data-drop-status="${board.statusIds.Growing}"]`)).toHaveCount(0);
    // A Garden card joins: the drawer offers categories.
    await touch.tap(card(page, 'Water tomatoes'));
    await expect(page.getByText('2 selected')).toBeVisible();
    await expect(page.locator(`[data-drop-status="${board.statusIds.Tasting}"]`)).toHaveCount(0);
    await touch.tap(page.locator('[data-drop-status="category:done"]').last());
    await expect
      .poll(async () => [
        (await taskRow(page, board.headers, board.ids['Bake bread']!))?.status_id,
        (await taskRow(page, board.headers, board.ids['Water tomatoes']!))?.status_id,
      ])
      .toEqual([board.statusIds.Served, board.statusIds.Harvested]);
    await columns.getByRole('button', { name: 'Done' }).click();
    await expect(columns.getByRole('button', { name: 'Done' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(card(page, 'Water tomatoes')).toBeInViewport();
  });
});

test('the phone remembers folding and reopening both closed categories', async ({
  page,
  isMobile,
  browserName,
}) => {
  test.skip(!isMobile && browserName !== 'firefox', 'Phone layout');
  if (!isMobile) await page.setViewportSize({ width: 412, height: 915 });
  await workspaceFixture(page);
  const columns = page.getByRole('navigation', { name: 'Columns' });
  const turn = async (name: string) => {
    const tab = columns.getByRole('button', { name: new RegExp(`^${name}, \\d+ tasks?$`) });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-current', 'page');
  };
  await turn('Done');
  await expect(card(page, 'Wash up')).toBeInViewport();
  await column(page, 'Done').getByRole('button', { name: 'Fold done' }).click();
  await expect(card(page, 'Wash up')).toHaveCount(0);

  await turn('Cancelled');
  const cancelled = column(page, 'Cancelled');
  await cancelled.getByRole('button', { name: 'Show 1 cancelled' }).click();
  await expect(card(page, 'Flambé')).toBeInViewport();
  await cancelled.getByRole('button', { name: 'Fold cancelled' }).click();
  await expect(card(page, 'Flambé')).toHaveCount(0);

  await page.reload();
  await turn('Done');
  await column(page, 'Done').getByRole('button', { name: 'Show 2 done' }).click();
  await expect(card(page, 'Wash up')).toBeInViewport();
  await turn('Cancelled');
  await expect(cancelled.getByRole('button', { name: 'Show 1 cancelled' })).toBeInViewport();
});
