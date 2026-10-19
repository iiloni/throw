import { expect, type Locator, type Page, test } from '@playwright/test';
import { cardIds, fixture } from './board-helpers';
import { shapeRows } from './helpers';

type Point = { x: number; y: number };

async function centre(target: Locator | Point): Promise<Point> {
  if (!('boundingBox' in target)) return target;
  const box = (await target.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Carries a card with the mouse through `path`, pausing at each point so the board can
 * respond (a rail's dwell, a column folding), then drops it unless told to keep holding.
 */
async function carry(
  page: Page,
  card: Locator,
  path: (Locator | Point)[],
  { pause = 120, drop = true }: { pause?: number; drop?: boolean } = {},
) {
  const start = await centre(card);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // Past the slop, so the press becomes a drag.
  await page.mouse.move(start.x + 4, start.y + 8, { steps: 4 });
  for (const point of path) {
    const { x, y } = await centre(point);
    await page.mouse.move(x, y, { steps: 14 });
    await page.waitForTimeout(pause);
  }
  if (drop) await page.mouse.up();
}

async function taskRow(page: Page, headers: Record<string, string>, id: string) {
  return (await shapeRows(page.request, 'tasks', headers)).find((row) => row.id === id);
}

const card = (page: Page, title: string) =>
  page.getByRole('article', { name: new RegExp(`${title}$`) });

test.describe('desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'Phone moves have their own tests');

  test('a card dragged into another column lands between the cards it was dropped between', async ({
    page,
  }) => {
    const board = await fixture(page);
    await board.add('Second review', 'Review', 3, 'a1');
    await board.add('Third review', 'Review', 3, 'a5');
    const review = page.getByRole('region', { name: 'Review', exact: true });
    await expect(review.getByRole('article')).toHaveCount(3);
    // In Compact the held card's own zone takes the column and High folds into a rail, so
    // read where the two Default cards are once the card is held.
    const held = card(page, 'Later position');
    await carry(page, held, [review], { drop: false });
    const firstBox = (await card(page, 'Second review').boundingBox())!;
    const secondBox = (await card(page, 'Third review').boundingBox())!;
    await page.mouse.move(
      firstBox.x + firstBox.width / 2,
      (firstBox.y + firstBox.height + secondBox.y) / 2,
      { steps: 10 },
    );
    await page.waitForTimeout(200);
    // Every frame of the landing: the card must never show in the column it left, as it
    // would if the board waited for sync to bring the row back.
    const watch = page.evaluate((id) => {
      const lists = new Set<string>();
      const started = performance.now();
      return new Promise<string[]>((resolve) => {
        requestAnimationFrame(function sample(now) {
          const real = document.querySelector(`[data-card-id="${id}"]:not([data-overlay])`);
          const list = real?.closest('[data-drop-list]')?.getAttribute('data-drop-list');
          if (list) lists.add(list);
          if (now - started < 1200) requestAnimationFrame(sample);
          else resolve([...lists]);
        });
      });
    }, board.ids['Later position']!);
    await page.mouse.up();
    expect(await watch).toEqual([`status:${board.status('Review')}`]);
    await expect
      .poll(() => cardIds(page, 'Review'))
      .toEqual([
        board.ids['Review this'],
        board.ids['Second review'],
        board.ids['Later position'],
        board.ids['Third review'],
      ]);
    await expect
      .poll(async () => {
        const row = await taskRow(page, board.headers, board.ids['Later position']!);
        return [row?.status_id, row?.priority];
      })
      .toEqual([board.status('Review'), '3']);
  });

  test('Escape puts a held card back and writes nothing', async ({ page }) => {
    const board = await fixture(page);
    const before = await cardIds(page, 'Build');
    await carry(page, card(page, 'Earlier position'), [card(page, 'Review this')], {
      drop: false,
    });
    await expect(page.locator('[data-overlay]')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(page.locator('[data-overlay]')).toHaveCount(0);
    expect(await cardIds(page, 'Build')).toEqual(before);
    const row = await taskRow(page, board.headers, board.ids['Earlier position']!);
    expect(row?.status_id).toBe(board.status('Build'));
  });
});
