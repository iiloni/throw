import { expect, type Page, test } from '@playwright/test';
import { card, finger, fixture, taskRow, workspaceFixture } from './board-helpers';
import { shapeRows } from './helpers';
import { newTag } from './tag-helpers';

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Selected tasks' });
const rows = async (page: Page, headers: Record<string, string>, ids: string[]) => {
  const tasks = await shapeRows(page.request, 'tasks', headers);
  return ids.map((id) => tasks.find((task) => task.id === id));
};
const secondaryTags = async (page: Page, headers: Record<string, string>, tagId: string) =>
  (await shapeRows(page.request, 'task-tags', headers))
    .filter((row) => row.tag_id === tagId)
    .map((row) => String(row.task_id))
    .sort();

test.describe('desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'The phone selects by long press; its test is below');

  test('a right click selects cards, and the selection bar changes them together', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const board = await fixture(page);
    const fragile = await newTag(page.request, board, board.projectId, {
      name: 'Fragile',
      color: 'red',
    });
    const spare = await newTag(page.request, board, board.projectId, { name: 'Spare' });
    const titles = ['Earlier position', 'Later position'];
    const ids = titles.map((title) => board.ids[title]!);

    // A right click selects, and another lets the card go, without the browser's menu.
    await card(page, titles[0]!).click({ button: 'right' });
    await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
    await card(page, titles[1]!).click({ button: 'right' });
    await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
    await card(page, titles[1]!).click({ button: 'right' });
    await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
    await card(page, titles[1]!).click({ button: 'right' });
    await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
    // Right-clicking the board around the cards leaves the selection alone.
    await page
      .getByRole('region', { name: 'Build', exact: true })
      .click({ button: 'right', position: { x: 8, y: 8 } });
    await expect(page.getByText('2 selected', { exact: true })).toBeVisible();

    // Priority and size apply to every card and keep the selection.
    const bar = toolbar(page);
    await bar.getByRole('button', { name: /^Priority: Default/ }).click();
    await page
      .getByRole('region', { name: 'Priority' })
      .getByRole('radio', { name: 'High' })
      .click();
    await expect
      .poll(async () => (await rows(page, board.headers, ids)).map((row) => row?.priority))
      .toEqual(['2', '2']);
    await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
    await bar.getByRole('button', { name: /^Size: none/ }).click();
    await page.getByRole('region', { name: 'Size' }).getByText('M', { exact: true }).click();
    await expect
      .poll(async () => (await rows(page, board.headers, ids)).map((row) => row?.size))
      .toEqual(['3', '3']);
    await expect(bar.getByRole('button', { name: /^Size: M/ })).toBeVisible();

    // Tags: one color for all, and a secondary tag checked for all.
    await bar.getByRole('button', { name: 'Change tags' }).click();
    const tags = page.getByRole('region', { name: 'Tags' });
    await tags.getByRole('button', { name: 'Red: Fragile', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('desktop-tags.png') });
    await expect
      .poll(async () => (await rows(page, board.headers, ids)).map((row) => row?.primary_tag_id))
      .toEqual([fragile.id, fragile.id]);
    await tags.getByRole('tab', { name: 'Secondary' }).click();
    await tags.getByRole('checkbox', { name: 'Spare', exact: true }).check();
    await expect.poll(() => secondaryTags(page, board.headers, spare.id)).toEqual([...ids].sort());
    // Escape closes the picker first, then lets the selection go.
    await page.keyboard.press('Escape');
    await expect(tags).toHaveCount(0);
    await expect(page.getByText('2 selected', { exact: true })).toBeVisible();

    // Status moves them all and lets the selection go.
    await bar.getByRole('button', { name: /^Status: Build/ }).click();
    await page
      .getByRole('region', { name: 'Status' })
      .locator(`[data-drop-status="${board.status('Review')}"]`)
      .click();
    await expect
      .poll(async () => (await rows(page, board.headers, ids)).map((row) => row?.status_id))
      .toEqual([board.status('Review'), board.status('Review')]);
    await expect(page.getByText('2 selected', { exact: true })).toHaveCount(0);

    // The trash takes both, and Undo brings both back.
    for (const title of titles) await card(page, title).click({ button: 'right' });
    await toolbar(page).getByRole('button', { name: 'Move to trash' }).click();
    const toast = page.locator('[data-sonner-toast]', { hasText: '2 tasks moved to the trash' });
    await expect(toast).toBeVisible();
    await expect(card(page, titles[0]!)).toHaveCount(0);
    await expect(page.getByText('2 selected', { exact: true })).toHaveCount(0);
    await expect
      .poll(async () =>
        (await rows(page, board.headers, ids)).map((row) => row?.deleted_at != null),
      )
      .toEqual([true, true]);
    await toast.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(card(page, titles[0]!)).toBeVisible();
    await expect(card(page, titles[1]!)).toBeVisible();
    await expect
      .poll(async () =>
        (await rows(page, board.headers, ids)).map((row) => row?.deleted_at ?? null),
      )
      .toEqual([null, null]);
  });

  test('the selection bar rises above the floating search instead of covering it', async ({
    page,
  }) => {
    // Narrower than the docked search sidebar, so search floats at the foot of the board.
    await page.setViewportSize({ width: 1100, height: 800 });
    await fixture(page);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const field = page.getByRole('search', { name: 'Search the board' });
    await expect(field).toBeVisible();
    await card(page, 'Earlier position').click({ button: 'right' });
    const bar = toolbar(page);
    await expect(bar).toBeVisible();
    await expect
      .poll(async () => {
        const [over, under] = [await bar.boundingBox(), await field.boundingBox()];
        return over && under ? over.y + over.height <= under.y : false;
      })
      .toBe(true);
  });

  test('the workspace board edits several projects’ cards, offering tags within one project', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const board = await workspaceFixture(page);
    await newTag(page.request, board, board.projectIds.Kitchen!, { name: 'Oven', color: 'red' });
    await card(page, 'Bake bread').click({ button: 'right' });
    await card(page, 'Simmer stock').click({ button: 'right' });
    const bar = toolbar(page);
    await expect(bar.getByRole('button', { name: 'Change tags' })).toBeVisible();
    // A Garden card joins: Kitchen's tags are no longer every card's to choose.
    await card(page, 'Water tomatoes').click({ button: 'right' });
    await expect(page.getByText('3 selected', { exact: true })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Change tags' })).toHaveCount(0);
    await bar.getByRole('button', { name: 'Change priority' }).click();
    await page
      .getByRole('region', { name: 'Priority' })
      .getByRole('radio', { name: 'Low', exact: true })
      .click();
    const ids = ['Bake bread', 'Simmer stock', 'Water tomatoes'].map((title) => board.ids[title]!);
    await expect
      .poll(async () => (await rows(page, board.headers, ids)).map((row) => row?.priority))
      .toEqual(['4', '4', '4']);
    // Several projects move by category, each to its own default status there.
    await bar.getByRole('button', { name: 'Change status' }).click();
    await page
      .getByRole('region', { name: 'Status' })
      .locator('[data-drop-status="category:done"]')
      .click();
    await expect
      .poll(async () => (await rows(page, board.headers, ids)).map((row) => row?.status_id))
      .toEqual([board.statusIds.Served, board.statusIds.Served, board.statusIds.Harvested]);
  });
});

test.describe('phone', () => {
  test.skip(({ isMobile, browserName }) => !isMobile || browserName !== 'chromium', 'Touch input');

  test('the drawer’s selection controls change priority, size and tags, and trash with undo', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const board = await fixture(page);
    const fragile = await newTag(page.request, board, board.projectId, {
      name: 'Fragile',
      color: 'red',
    });
    const titles = ['Earlier position', 'Later position'];
    const ids = titles.map((title) => board.ids[title]!);
    const touch = await finger(page);
    await touch.press(card(page, titles[0]!));
    await touch.lift();
    await touch.tap(card(page, titles[1]!));
    await expect(page.getByText('2 selected')).toBeVisible();
    const bar = toolbar(page);
    // The move grid shows first, colored by status, as before.
    await expect(page.locator(`[data-drop-status="${board.status('Review')}"]`)).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath('phone-status.png') });
    await touch.tap(bar.getByRole('button', { name: /^Priority: Default/ }));
    await page.screenshot({ path: testInfo.outputPath('phone-priority.png') });
    await touch.tap(
      page.getByRole('region', { name: 'Priority' }).getByText('High', { exact: true }),
    );
    await expect
      .poll(async () => (await rows(page, board.headers, ids)).map((row) => row?.priority))
      .toEqual(['2', '2']);
    // Picking returns to the move grid, keeping the selection.
    await expect(page.locator(`[data-drop-status="${board.status('Review')}"]`)).toBeVisible();
    await expect(page.getByText('2 selected')).toBeVisible();

    await touch.tap(bar.getByRole('button', { name: /^Size: none/ }));
    await touch.tap(page.getByRole('region', { name: 'Size' }).getByText('L', { exact: true }));
    await expect
      .poll(async () => (await rows(page, board.headers, ids)).map((row) => row?.size))
      .toEqual(['4', '4']);

    await touch.tap(bar.getByRole('button', { name: 'Change tags' }));
    await touch.tap(
      page.getByRole('region', { name: 'Tags' }).getByRole('button', { name: 'Red: Fragile' }),
    );
    await expect
      .poll(async () => (await rows(page, board.headers, ids)).map((row) => row?.primary_tag_id))
      .toEqual([fragile.id, fragile.id]);

    await touch.tap(bar.getByRole('button', { name: 'Move to trash' }));
    const toast = page.locator('[data-sonner-toast]', { hasText: '2 tasks moved to the trash' });
    await expect(toast).toBeVisible();
    await expect(page.getByText('2 selected')).toHaveCount(0);
    await expect(card(page, titles[0]!)).toHaveCount(0);
    await toast.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(card(page, titles[0]!)).toBeVisible();
    await expect
      .poll(async () => (await taskRow(page, board.headers, ids[1]!))?.deleted_at ?? null)
      .toBeNull();
  });
});
