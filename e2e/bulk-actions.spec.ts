import { expect, type Locator, type Page, test } from '@playwright/test';
import { card, centre, finger, fixture, settled, taskRow, workspaceFixture } from './board-helpers';
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
    // Right-clicking the board around the cards leaves the selection alone. Below the header,
    // which has the column's own menu.
    await page
      .getByRole('region', { name: 'Build', exact: true })
      .click({ button: 'right', position: { x: 6, y: 80 } });
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.getByText('2 selected', { exact: true })).toBeVisible();

    // Priority and size apply to every card and keep the selection.
    const bar = toolbar(page);
    await bar.getByRole('button', { name: 'Change priority' }).click();
    await page
      .getByRole('region', { name: 'Priority' })
      .getByRole('radio', { name: 'High' })
      .click();
    await expect
      .poll(async () => (await rows(page, board.headers, ids)).map((row) => row?.priority))
      .toEqual(['2', '2']);
    await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
    await bar.getByRole('button', { name: 'Change size' }).click();
    await page.getByRole('region', { name: 'Size' }).getByText('M', { exact: true }).click();
    await expect
      .poll(async () => (await rows(page, board.headers, ids)).map((row) => row?.size))
      .toEqual(['3', '3']);
    // The controls keep one face whatever the cards share.
    await expect(bar.getByRole('button', { name: 'Change size' })).toBeVisible();

    // Tags: one color for all, and a secondary tag checked for all.
    await bar.getByRole('button', { name: 'Change tags' }).click();
    const tags = page.getByRole('region', { name: 'Tags' });
    await tags.getByRole('button', { name: 'Red: Fragile', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('desktop-tags.png') });
    await expect
      .poll(async () => (await rows(page, board.headers, ids)).map((row) => row?.primary_tag_id))
      .toEqual([fragile.id, fragile.id]);
    await expect(
      bar.getByRole('button', { name: 'Change tags' }).locator('svg'),
    ).not.toHaveAttribute('data-color');
    await tags.getByRole('tab', { name: 'Secondary' }).click();
    await tags.getByRole('checkbox', { name: 'Spare', exact: true }).check();
    await expect.poll(() => secondaryTags(page, board.headers, spare.id)).toEqual([...ids].sort());
    // Escape closes the picker first, then lets the selection go.
    await page.keyboard.press('Escape');
    await expect(tags).toHaveCount(0);
    await expect(page.getByText('2 selected', { exact: true })).toBeVisible();

    // Status moves them all and lets the selection go.
    await bar.getByRole('button', { name: 'Change status' }).click();
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

/**
 * What the move target shows over the next frames: the drawer's top, the views still arriving
 * or shown (by name, with their opacity), the ones leaving, and whether the target has gone.
 */
function watchMoveTarget(page: Page, frames = 45) {
  return page.evaluate(async (count) => {
    const seen: { top: number; shown: Record<string, number>; leaving: number; gone: boolean }[] =
      [];
    for (let frame = 0; frame < count; frame++) {
      await new Promise(requestAnimationFrame);
      const views = [...document.querySelectorAll<HTMLElement>('[data-move-panel]')];
      const shown: Record<string, number> = {};
      for (const view of views)
        if (!view.closest('[inert]'))
          shown[view.dataset.movePanel!] = Number(getComputedStyle(view).opacity);
      seen.push({
        top: Math.round(document.querySelector('[data-drawer]')!.getBoundingClientRect().top),
        shown,
        leaving: views.filter((view) => view.closest('[inert]')).length,
        gone: document.querySelector('[data-move-view]') === null,
      });
    }
    return seen;
  }, frames);
}

/** Taps `target` once it is still, watching the move target from the frame before. */
async function watchTap(
  page: Page,
  touch: Awaited<ReturnType<typeof finger>>,
  target: Locator,
  frames?: number,
) {
  const at = await centre(await settled(target));
  const watching = watchMoveTarget(page, frames);
  await touch.tap(at);
  return watching;
}

test.describe('phone', () => {
  test.skip(({ isMobile, browserName }) => !isMobile || browserName !== 'chromium', 'Touch input');

  test('the selection drawer fades between its pickers and lets each go', async ({ page }) => {
    await fixture(page);
    const touch = await finger(page);
    await touch.press(card(page, 'Earlier position'));
    await touch.lift();
    await touch.tap(card(page, 'Later position'));
    await expect(page.getByText('2 selected')).toBeVisible();
    const bar = toolbar(page);

    // Opening a picker fades it in as the drawer rises to it.
    let seen = await watchTap(page, touch, bar.getByRole('button', { name: 'Change status' }));
    expect(seen.some(({ shown }) => shown.status! > 0 && shown.status! < 1)).toBe(true);
    expect(new Set(seen.map(({ top }) => top)).size).toBeGreaterThan(2);
    expect(seen.at(-1)!.leaving).toBe(0);

    // Switching fades the next across the last, which is out of reach until it has gone.
    seen = await watchTap(page, touch, bar.getByRole('button', { name: 'Change priority' }));
    expect(seen.some(({ leaving }) => leaving > 0)).toBe(true);
    expect(seen.at(-1)!.leaving).toBe(0);
    await expect(page.getByRole('region', { name: 'Priority' })).toBeVisible();
    await expect(page.locator('[data-move-panel="status"]')).toHaveCount(0);

    // Closing it leaves the controls, with nothing left behind.
    seen = await watchTap(page, touch, bar.getByRole('button', { name: 'Change priority' }));
    expect(seen.some(({ leaving }) => leaving > 0)).toBe(true);
    expect(seen.at(-1)!.leaving).toBe(0);
    await expect(page.getByRole('region', { name: 'Priority' })).toHaveCount(0);

    // Letting the selection go fades the target into the dock, still showing what it held.
    await touch.tap(bar.getByRole('button', { name: 'Change status' }));
    await expect(page.locator('[data-move-panel="status"]')).toBeVisible();
    seen = await watchTap(page, touch, page.getByRole('button', { name: 'Clear selection' }));
    expect(seen.some(({ leaving }) => leaving > 0)).toBe(true);
    expect(seen.at(-1)!.gone).toBe(true);
    await expect(page.getByText('0 selected')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New task' })).toBeVisible();
  });

  test('with reduced motion the selection drawer switches its pickers in place', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await fixture(page);
    const touch = await finger(page);
    await touch.press(card(page, 'Earlier position'));
    await touch.lift();
    const bar = toolbar(page);
    await touch.tap(bar.getByRole('button', { name: 'Change status' }));
    await expect(page.locator('[data-move-panel="status"]')).toBeVisible();
    const seen = await watchTap(
      page,
      touch,
      bar.getByRole('button', { name: 'Change priority' }),
      20,
    );
    // Every frame that shows the new picker shows it whole, and the last one has gone with it.
    const priority = seen.filter(({ shown }) => 'priority' in shown);
    expect(priority.length).toBeGreaterThan(0);
    for (const { shown } of priority) expect(shown.priority).toBe(1);
    expect(seen.filter(({ leaving }) => leaving > 0).length).toBeLessThanOrEqual(2);
    expect(seen.at(-1)!.leaving).toBe(0);
  });

  test('the drawer’s selection controls change priority, size and tags, and trash with undo', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const board = await fixture(page);
    const fragile = await newTag(page.request, board, board.projectId, {
      name: 'Fragile',
      color: 'red',
    });
    // Enough secondary tags that the two role views differ in height, as on a real project.
    const area = await newTag(page.request, board, board.projectId, { name: 'Area' });
    for (const name of ['Bug', 'Docs', 'Polish', 'Research'])
      await newTag(page.request, board, board.projectId, { name });
    await newTag(page.request, board, board.projectId, { name: 'Board', parentId: area.id });
    const titles = ['Earlier position', 'Later position'];
    const ids = titles.map((title) => board.ids[title]!);
    const touch = await finger(page);
    await touch.press(card(page, titles[0]!));
    await touch.lift();
    await touch.tap(card(page, titles[1]!));
    await expect(page.getByText('2 selected')).toBeVisible();
    const bar = toolbar(page);
    // Selecting opens the controls alone; the move grid waits for Status.
    const review = page.locator(`[data-drop-status="${board.status('Review')}"]`);
    await expect(bar).toBeVisible();
    await expect(review).toHaveCount(0);
    await touch.tap(bar.getByRole('button', { name: 'Change status' }));
    await expect(review).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath('phone-status.png') });
    await touch.tap(bar.getByRole('button', { name: 'Change priority' }));
    await page.screenshot({ path: testInfo.outputPath('phone-priority.png') });
    await touch.tap(
      page.getByRole('region', { name: 'Priority' }).getByText('High', { exact: true }),
    );
    await expect
      .poll(async () => (await rows(page, board.headers, ids)).map((row) => row?.priority))
      .toEqual(['2', '2']);
    // Picking closes the picker and keeps the selection.
    await expect(page.getByRole('region', { name: 'Priority' })).toHaveCount(0);
    await expect(review).toHaveCount(0);
    await expect(page.getByText('2 selected')).toBeVisible();

    await touch.tap(bar.getByRole('button', { name: 'Change size' }));
    await touch.tap(page.getByRole('region', { name: 'Size' }).getByText('L', { exact: true }));
    await expect
      .poll(async () => (await rows(page, board.headers, ids)).map((row) => row?.size))
      .toEqual(['4', '4']);

    await touch.tap(bar.getByRole('button', { name: 'Change tags' }));
    const tags = page.getByRole('region', { name: 'Tags' });
    await touch.tap(tags.getByRole('button', { name: 'Red: Fragile' }));
    // Switching between the tag roles resizes the drawer as an open task's Tags page does: it
    // follows the views' own height frame by frame, so the panel's foot never leaves the bottom
    // of the screen, rather than chasing it with a second spring.
    const drawer = page.locator('[data-drawer]');
    const top = async () => Math.round((await drawer.boundingBox())!.y);
    const settledTop = async () => {
      let previous = Number.NaN;
      await expect
        .poll(async () => {
          const now = await top();
          const settled = now === previous;
          previous = now;
          return settled;
        })
        .toBe(true);
      return top();
    };
    const rests = [await settledTop()];
    for (const role of ['Secondary', 'Primary']) {
      await touch.tap(tags.getByRole('tab', { name: new RegExp(`^${role}`) }));
      const feet = await page.evaluate(async () => {
        const panel = document.querySelector('[data-move-view]')!;
        const seen: number[] = [];
        for (let frame = 0; frame < 40; frame++) {
          // Read once the frame is drawn, after the drawer has followed the views' layout.
          await new Promise(requestAnimationFrame);
          await new Promise((resolve) => setTimeout(resolve));
          seen.push(Math.round(panel.getBoundingClientRect().bottom));
        }
        return seen;
      });
      expect(Math.max(...feet) - Math.min(...feet)).toBeLessThanOrEqual(1);
      rests.push(await settledTop());
      await page.screenshot({ path: testInfo.outputPath(`phone-tags-${role.toLowerCase()}.png`) });
    }
    // Secondary's longer list raises the drawer, and Primary lowers it again.
    expect(rests[1]).toBeLessThan(rests[0]!);
    expect(rests[2]).toBe(rests[0]);
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
