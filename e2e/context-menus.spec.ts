import { expect, type Page, test } from '@playwright/test';
import { card, finger, fixture, workspaceFixture } from './board-helpers';
import { APP_LOAD_TIMEOUT } from './helpers';

const rail = (page: Page) => page.getByRole('complementary', { name: 'Navigation rail' });
const menu = (page: Page) => page.getByRole('menu');
const item = (page: Page, name: string) => menu(page).getByRole('menuitem', { name, exact: true });

test.describe('desktop context menus', () => {
  test.skip(({ isMobile }) => isMobile, 'Right-click menus are on the desktop rail and columns');
  test.beforeEach(async ({ page }) => page.setViewportSize({ width: 1440, height: 900 }));

  test('a project in the rail offers its actions on a right click, expanded and collapsed', async ({
    page,
  }) => {
    const board = await fixture(page);
    const row = rail(page).getByRole('link', { name: 'Real board', exact: true });
    await row.click({ button: 'right' });
    await expect(menu(page)).toBeVisible();
    for (const name of ['Project settings', 'Project trash', 'Rename…', 'Open in new tab'])
      await expect(item(page, name)).toBeVisible();

    // The `…` menu offers the same actions.
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    await rail(page).getByRole('button', { name: 'Project menu for Real board' }).click();
    for (const name of ['Project settings', 'Project trash', 'Rename…', 'Open in new tab'])
      await expect(item(page, name)).toBeVisible();
    await page.keyboard.press('Escape');

    await row.click({ button: 'right' });
    await item(page, 'Rename…').click();
    const dialog = page.getByRole('dialog', { name: 'Rename project' });
    await dialog.getByLabel('Project name', { exact: true }).fill('Renamed board');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toHaveCount(0);
    const renamed = rail(page).getByRole('link', { name: 'Renamed board', exact: true });
    await expect(renamed).toBeVisible();

    // A new tab opens the project's board within this account.
    await renamed.click({ button: 'right' });
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      item(page, 'Open in new tab').click(),
    ]);
    expect(new URL(popup.url()).pathname).toBe(`/w/${board.workspaceId}/p/${board.projectId}`);
    await popup.close();

    // A collapsed rail hides the `…` button, so the right click is its way to them.
    await rail(page).getByRole('button', { name: 'Collapse navigation' }).click();
    await expect(rail(page).getByRole('button', { name: /^Project menu for/ })).toHaveCount(0);
    await renamed.click({ button: 'right' });
    await item(page, 'Project trash').click();
    await expect(page).toHaveURL(new RegExp(`/p/${board.projectId}/trash$`), {
      timeout: APP_LOAD_TIMEOUT,
    });
  });

  test('a right click on Settings toggles the board display and jumps to a settings page', async ({
    page,
  }) => {
    await fixture(page);
    const settings = rail(page).getByRole('link', { name: 'Settings', exact: true });
    await settings.click({ button: 'right' });
    const toggle = menu(page).getByRole('menuitemcheckbox', { name: 'Column backgrounds' });
    const before = await toggle.getAttribute('aria-checked');
    const column = page.locator('section[data-column]').first();
    await toggle.click();
    // The menu stays open for the next toggle while the board behind changes.
    await expect(toggle).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');
    if (before === 'true') await expect(column).not.toHaveAttribute('data-surface');
    else await expect(column).toHaveAttribute('data-surface', '');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', String(before));
    await item(page, 'Account').click();
    await expect(page).toHaveURL(/\/settings\/account$/, { timeout: APP_LOAD_TIMEOUT });

    // Away from a board it only jumps between pages.
    await settings.click({ button: 'right' });
    await expect(menu(page).getByRole('menuitemcheckbox')).toHaveCount(0);
    await item(page, 'General').click();
    await expect(page).toHaveURL(/\/settings\/general$/);
  });

  test('a column header and its folded strip offer the column actions', async ({ page }) => {
    const board = await fixture(page);
    const header = page.getByRole('button', { name: 'Collapse Review column', exact: true });
    await header.click({ button: 'right' });
    await expect(menu(page)).toHaveAttribute('aria-label', 'Review column actions');
    await item(page, 'Add task').click();
    // The new task opens in the pane, made in this column.
    await expect(page.getByRole('region', { name: 'Review', exact: true })).toContainText(
      'New task',
    );

    await page.getByRole('button', { name: 'Collapse Build column', exact: true }).click({
      button: 'right',
    });
    await item(page, 'Collapse column').click();
    const strip = page.getByRole('button', { name: 'Expand Build column', exact: true });
    await expect(strip).toBeVisible();
    await strip.click({ button: 'right' });
    await expect(item(page, 'Expand column')).toBeVisible();
    await expect(item(page, 'Collapse other columns')).toBeVisible();
    await item(page, 'Collapse other columns').click();
    await expect(page.getByRole('button', { name: 'Expand Review column' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Expand Build column' })).toBeVisible();

    await page.getByRole('button', { name: 'Expand Review column' }).click({ button: 'right' });
    await item(page, 'Expand all columns').click();
    await expect(page.getByRole('button', { name: 'Collapse Review column' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Collapse Build column' })).toBeVisible();

    await page.getByRole('button', { name: 'Collapse Review column' }).click({ button: 'right' });
    await expect(item(page, 'Expand all columns')).toHaveCount(0);
    await item(page, 'Edit status…').click();
    await expect(page).toHaveURL(new RegExp(`/p/${board.projectId}/settings\\?section=statuses$`), {
      timeout: APP_LOAD_TIMEOUT,
    });
  });

  test('category columns on the workspace board only fold', async ({ page }) => {
    await workspaceFixture(page);
    await page.getByRole('button', { name: 'Collapse Active column', exact: true }).click({
      button: 'right',
    });
    await expect(item(page, 'Collapse column')).toBeVisible();
    await expect(item(page, 'Add task')).toHaveCount(0);
    await expect(item(page, 'Edit status…')).toHaveCount(0);
    await item(page, 'Collapse column').click();
    await expect(page.getByRole('button', { name: 'Expand Active column' })).toBeVisible();
  });

  test('a right click on a card still selects it rather than opening a menu', async ({ page }) => {
    await fixture(page);
    await card(page, 'Earlier position').click({ button: 'right' });
    await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
    await expect(menu(page)).toHaveCount(0);
  });
});

test.describe('a touch screen with the desktop layout', () => {
  test.skip(
    ({ isMobile, browserName }) => !isMobile || browserName !== 'chromium',
    'Touch input through Chromium',
  );
  // A tablet: the rail and the desktop board, under a finger.
  test.beforeEach(async ({ page }) => page.setViewportSize({ width: 1280, height: 800 }));

  test('a long press opens each menu where a right click would, without the tap acting', async ({
    page,
  }) => {
    const board = await fixture(page);
    const touch = await finger(page);
    const boardUrl = page.url();

    // A column header: held, it opens the menu and does not fold the column on the lift.
    const review = page.locator(`[data-column="${board.status('Review')}"]`);
    await touch.press(page.getByRole('button', { name: 'Collapse Review column' }), 650);
    await touch.lift();
    await expect(menu(page)).toHaveAttribute('aria-label', 'Review column actions');
    await expect(review).not.toHaveAttribute('data-collapsed');
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    // A tap still folds it.
    await touch.tap(page.getByRole('button', { name: 'Collapse Review column' }));
    await expect(review).toHaveAttribute('data-collapsed', '');

    // A project in the rail: the menu, and the board stays where it is.
    await touch.press(rail(page).getByRole('link', { name: 'Real board', exact: true }), 650);
    await touch.lift();
    await expect(item(page, 'Project settings')).toBeVisible();
    expect(page.url()).toBe(boardUrl);
    await page.keyboard.press('Escape');

    // Settings: the quick menu rather than the Settings page, then a tap on one of its pages.
    await touch.press(rail(page).getByRole('link', { name: 'Settings', exact: true }), 650);
    await touch.lift();
    await expect(menu(page).getByRole('menuitemcheckbox').first()).toBeVisible();
    await page.waitForTimeout(400);
    expect(page.url()).toBe(boardUrl);
    await touch.tap(item(page, 'Account'));
    await expect(page).toHaveURL(/\/settings\/account$/, { timeout: APP_LOAD_TIMEOUT });
  });
});
