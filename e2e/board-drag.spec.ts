import { randomUUID } from 'node:crypto';
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

  test('held over a folded priority, a column opens that zone and the card takes its priority', async ({
    page,
  }) => {
    const board = await fixture(page);
    const review = page.getByRole('region', { name: 'Review', exact: true });
    await carry(page, card(page, 'Later position'), [review], { drop: false });
    // Default is open for the held card; High lies folded above it.
    const high = review.locator('[data-drop-rail="2"]');
    await expect(high).toBeVisible();
    await page.mouse.move(...(Object.values(await centre(high)) as [number, number]), {
      steps: 6,
    });
    await expect(review.locator('[data-zone-header="2"]')).toHaveAttribute('data-mode', 'open');
    await page.mouse.up();
    await expect
      .poll(async () => {
        const row = await taskRow(page, board.headers, board.ids['Later position']!);
        return [row?.status_id, row?.priority];
      })
      .toEqual([board.status('Review'), '2']);
  });

  test('the backlog and closed rails turn into their statuses while a card is held', async ({
    page,
  }) => {
    const board = await fixture(page);
    const backlog = page.getByRole('complementary', { name: 'Backlog' });
    await carry(page, card(page, 'Earlier position'), [backlog], { drop: false });
    const planned = backlog.locator(`[data-drop-status="${board.status('Planned')}"]`);
    await expect(planned).toBeVisible();
    await page.mouse.move(...(Object.values(await centre(planned)) as [number, number]), {
      steps: 6,
    });
    await page.mouse.up();
    await expect(page.locator('[data-overlay]')).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'Build', exact: true }).getByRole('article', {
        name: /Earlier position$/,
      }),
    ).toHaveCount(0);

    const closed = page.getByRole('complementary', { name: 'Closed' });
    await carry(page, card(page, 'Low priority'), [closed], { drop: false });
    const done = closed.locator(`[data-drop-status="${board.status('Done')}"]`);
    await page.mouse.move(...(Object.values(await centre(done)) as [number, number]), {
      steps: 6,
    });
    await page.mouse.up();
    await expect
      .poll(async () => {
        const rows = await Promise.all(
          ['Earlier position', 'Low priority'].map((title) =>
            taskRow(page, board.headers, board.ids[title]!),
          ),
        );
        return rows.map((row) => [
          row?.status_id,
          row?.closed_at !== null && row?.closed_at !== undefined,
        ]);
      })
      .toEqual([
        [board.status('Planned'), false],
        [board.status('Done'), true],
      ]);
  });

  test('a card carried from the keyboard is announced at each step and written once', async ({
    page,
  }) => {
    const board = await fixture(page);
    const announcer = page.locator('[aria-live="assertive"]');
    const held = card(page, 'Earlier position');
    await held.focus();
    await expect(held).toHaveAccessibleDescription(/Space picks it up/);
    await page.keyboard.press('Space');
    await expect(announcer).toContainText(/Picked up/i);
    await page.keyboard.press('ArrowRight');
    await expect(announcer).toContainText('Review');
    // Nothing is written while the card is carried.
    expect((await taskRow(page, board.headers, board.ids['Earlier position']!))?.status_id).toBe(
      board.status('Build'),
    );
    await page.keyboard.press('Space');
    await expect(announcer).toContainText('Set down.');
    await expect(held).toBeFocused();
    await expect
      .poll(
        async () => (await taskRow(page, board.headers, board.ids['Earlier position']!))?.status_id,
      )
      .toBe(board.status('Review'));

    // Escape puts a carried card back.
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('region', { name: 'Review', exact: true }).getByRole('article', {
        name: /Earlier position$/,
      }),
    ).toBeVisible();
  });

  test('the backlog gallery places a reordered card at a caret, left to right', async ({
    page,
  }) => {
    const board = await fixture(page);
    for (const [title, position] of [
      ['Gallery one', 'a1'],
      ['Gallery two', 'a2'],
      ['Gallery three', 'a3'],
    ] as const)
      await board.add(title, 'Ideas', 3, position);
    // A wide window opens the backlog beside the board already.
    const opener = page.getByRole('button', { name: /^Open backlog,/ });
    if (await opener.count()) await opener.click();
    const backlog = page.getByRole('complementary', { name: 'Backlog' });
    await backlog.getByRole('button', { name: 'Open as a gallery' }).click();
    const gallery = backlog.getByRole('region', { name: 'Backlog tasks' });
    await expect(gallery.getByRole('article', { name: /Gallery three$/ })).toBeVisible();
    const first = (await card(page, 'Gallery one').boundingBox())!;
    await carry(
      page,
      card(page, 'Gallery three'),
      [{ x: first.x + first.width * 0.2, y: first.y + first.height / 2 }],
      { drop: false },
    );
    // A caret marks the place; the cards stay where they are.
    await expect(gallery.locator('[data-slot] > span[aria-hidden]')).toHaveCount(1);
    expect((await card(page, 'Gallery one').boundingBox())!.x).toBeCloseTo(first.x, 0);
    await page.mouse.up();
    const order = () =>
      gallery
        .getByRole('article')
        .evaluateAll((cards) =>
          cards.map((item) => item.getAttribute('aria-label')?.replace(/^\S+ /, '')),
        );
    await expect
      .poll(async () => (await order()).filter((title) => title?.startsWith('Gallery')))
      .toEqual(['Gallery three', 'Gallery one', 'Gallery two']);
    await expect
      .poll(async () => {
        const [three, one] = await Promise.all(
          ['Gallery three', 'Gallery one'].map((title) =>
            taskRow(page, board.headers, board.ids[title]!),
          ),
        );
        return String(three?.position) < String(one?.position);
      })
      .toBe(true);
  });
});

test.describe('sync', () => {
  test.skip(({ isMobile }) => isMobile, 'Moves sync the same from either layout');

  test('a move made offline shows at once and reaches the server on reconnect', async ({
    page,
  }) => {
    const board = await fixture(page);
    await page.route('**/api/**', (route) => route.abort('connectionfailed'));
    const review = page.getByRole('region', { name: 'Review', exact: true });
    await carry(page, card(page, 'Later position'), [review]);
    await expect(review.getByRole('article', { name: /Later position$/ })).toBeVisible();
    expect((await taskRow(page, board.headers, board.ids['Later position']!))?.status_id).toBe(
      board.status('Build'),
    );
    await page.unroute('**/api/**');
    await expect
      .poll(
        async () => (await taskRow(page, board.headers, board.ids['Later position']!))?.status_id,
        {
          timeout: 30_000,
        },
      )
      .toBe(board.status('Review'));
    await expect(review.getByRole('article', { name: /Later position$/ })).toBeVisible();
  });

  test('a card another device moves while it is held stays in hand, then is not written over', async ({
    page,
  }) => {
    const board = await fixture(page);
    const id = board.ids['Earlier position']!;
    const review = page.getByRole('region', { name: 'Review', exact: true });
    await carry(page, card(page, 'Earlier position'), [review], { drop: false });
    const moved = await page.request.patch(`/api/tasks/${id}`, {
      headers: board.headers,
      data: {
        changeId: randomUUID(),
        changes: { statusId: { before: board.status('Build'), after: board.status('Done') } },
      },
    });
    expect(moved.status()).toBe(200);
    // The other device's change has arrived by now; the held card neither jumps nor vanishes.
    await page.waitForTimeout(1500);
    await expect(page.locator('[data-overlay]')).toBeVisible();
    await page.mouse.up();
    await expect(page.locator('[aria-live="assertive"]')).toContainText(
      'changed on another device',
    );
    await expect(review.getByRole('article', { name: /Earlier position$/ })).toHaveCount(0);
    await page.waitForTimeout(1000);
    expect((await taskRow(page, board.headers, id))?.status_id).toBe(board.status('Done'));
  });

  test('another device adding to a column while a card is held lands the card where it was dropped', async ({
    page,
  }) => {
    const board = await fixture(page);
    await board.add('Second review', 'Review', 3, 'a5');
    const review = page.getByRole('region', { name: 'Review', exact: true });
    await expect(review.getByRole('article')).toHaveCount(2);
    const held = card(page, 'Later position');
    await carry(page, held, [review], { drop: false });
    const below = (await card(page, 'Second review').boundingBox())!;
    await page.mouse.move(below.x + below.width / 2, below.y + 4, { steps: 8 });
    await page.waitForTimeout(200);
    const before = await cardIds(page, 'Review');
    await board.add('Arrived meanwhile', 'Review', 3, 'a0');
    await page.waitForTimeout(1500);
    // Sync waits for the drop: the column the card is held over does not change under it.
    expect(await cardIds(page, 'Review')).toEqual(before);
    await page.mouse.up();
    await expect
      .poll(() => cardIds(page, 'Review'))
      .toEqual([
        board.ids['Review this'],
        board.ids['Arrived meanwhile'],
        board.ids['Later position'],
        board.ids['Second review'],
      ]);
  });
});

/** Where a target comes to rest, once the drawer or pager carrying it has stopped moving. */
async function settled(target: Locator) {
  let last = '';
  for (;;) {
    const box = await target.boundingBox();
    const now = JSON.stringify(box);
    if (box && now === last) return target;
    last = now;
    await target.page().waitForTimeout(100);
  }
}

/** A finger on the screen, through Chromium's touch input, so long presses are real touches. */
async function finger(page: Page) {
  const session = await page.context().newCDPSession(page);
  let at: Point = { x: 0, y: 0 };
  const send = (type: string, point?: Point) =>
    session.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [point] : [] });
  return {
    async press(target: Locator | Point, ms = 500) {
      at = await centre('boundingBox' in target ? await settled(target) : target);
      await send('touchStart', at);
      await page.waitForTimeout(ms);
    },
    async move(target: Locator | Point, ms = 400) {
      const to = await centre('boundingBox' in target ? await settled(target) : target);
      const from = at;
      const frames = Math.max(2, Math.round(ms / 16));
      for (let frame = 1; frame <= frames; frame++) {
        const t = frame / frames;
        await send('touchMove', {
          x: from.x + (to.x - from.x) * t,
          y: from.y + (to.y - from.y) * t,
        });
        await page.waitForTimeout(16);
      }
      at = to;
    },
    async hold(ms: number) {
      await page.waitForTimeout(ms);
    },
    async lift() {
      await send('touchEnd');
    },
    async tap(target: Locator | Point) {
      at = await centre('boundingBox' in target ? await settled(target) : target);
      await send('touchStart', at);
      await page.waitForTimeout(60);
      await send('touchEnd');
    },
  };
}

test.describe('phone', () => {
  test.skip(({ isMobile, browserName }) => !isMobile || browserName !== 'chromium', 'Touch input');

  const tile = (page: Page, statusId: string) => page.locator(`[data-drop-status="${statusId}"]`);
  const statusOf = async (page: Page, headers: Record<string, string>, id: string) =>
    (await taskRow(page, headers, id))?.status_id;

  test('a long press selects, taps add to it, and the move drawer sends the selection together', async ({
    page,
  }) => {
    const board = await fixture(page);
    const touch = await finger(page);
    await touch.press(card(page, 'Earlier position'));
    await touch.lift();
    await expect(page.getByText('1 selected')).toBeVisible();
    await touch.tap(card(page, 'Later position'));
    await expect(page.getByText('2 selected')).toBeVisible();
    await touch.tap(tile(page, board.status('Review')));
    await expect
      .poll(async () =>
        Promise.all(
          ['Earlier position', 'Later position'].map(async (title) => {
            const row = await taskRow(page, board.headers, board.ids[title]!);
            return [row?.status_id, row?.priority];
          }),
        ),
      )
      .toEqual([
        [board.status('Review'), '3'],
        [board.status('Review'), '3'],
      ]);
    await expect(page.getByText('2 selected')).toHaveCount(0);
  });

  test('a held card waits at the edge for the next column and lands in it', async ({ page }) => {
    const board = await fixture(page);
    const touch = await finger(page);
    const width = page.viewportSize()!.width;
    const start = await centre(await settled(card(page, 'Low priority')));
    await touch.press(start);
    await touch.move({ x: start.x + 20, y: start.y + 20 }, 150);
    await touch.move({ x: width - 12, y: start.y + 40 });
    await expect(
      page.getByRole('navigation', { name: 'Columns' }).getByRole('button', { name: 'Review' }),
    ).toHaveAttribute('aria-current', 'page');
    await touch.move({ x: width / 2, y: 320 });
    await touch.hold(300);
    await touch.lift();
    await expect
      .poll(() => statusOf(page, board.headers, board.ids['Low priority']!))
      .toBe(board.status('Review'));
  });

  test('the done pocket past the last column finishes a card and bumps the count', async ({
    page,
  }) => {
    const board = await fixture(page);
    const touch = await finger(page);
    const width = page.viewportSize()!.width;
    await page
      .getByRole('navigation', { name: 'Columns' })
      .getByRole('button', { name: 'Review' })
      .click();
    const count = page.getByRole('button', { name: /done this week/ });
    const before = Number((await count.getAttribute('aria-label'))?.match(/^\d+/)?.[0]);
    const start = await centre(await settled(card(page, 'Review this')));
    await touch.press(start);
    await touch.move({ x: start.x + 20, y: start.y + 20 }, 150);
    await touch.move({ x: width - 14, y: start.y + 60 });
    await expect(tile(page, board.status('Done'))).toBeVisible();
    await touch.hold(300);
    await touch.lift();
    await expect(count).toHaveAttribute('aria-label', new RegExp(`^${before + 1} done this week`));
    await expect
      .poll(() => statusOf(page, board.headers, board.ids['Review this']!))
      .toBe(board.status('Done'));
  });

  test('a card dragged onto the dock opens the move drawer and goes to the status it is dropped on', async ({
    page,
  }) => {
    const board = await fixture(page);
    const touch = await finger(page);
    const { width, height } = page.viewportSize()!;
    const start = await centre(await settled(card(page, 'Later position')));
    await touch.press(start);
    await touch.move({ x: start.x, y: start.y + 30 }, 150);
    await touch.move({ x: width / 2, y: height - 40 });
    const ideas = tile(page, board.status('Ideas')).last();
    await expect(ideas).toBeVisible();
    await touch.move(ideas);
    await touch.hold(300);
    await touch.lift();
    await expect
      .poll(() => statusOf(page, board.headers, board.ids['Later position']!))
      .toBe(board.status('Ideas'));
  });

  test('the half-open backlog supplies a card to the board', async ({ page }) => {
    const board = await fixture(page);
    const touch = await finger(page);
    const width = page.viewportSize()!.width;
    await page.getByRole('button', { name: /^Backlog \d+$/ }).click();
    await expect(card(page, 'Planned first')).toBeVisible();
    const start = await centre(await settled(card(page, 'Planned first')));
    await touch.press(start);
    await touch.move({ x: start.x, y: start.y - 30 }, 150);
    await touch.move({ x: width / 2, y: 260 });
    await touch.hold(400);
    await touch.lift();
    await expect
      .poll(() => statusOf(page, board.headers, board.ids['Planned first']!))
      .toBe(board.status('Build'));
  });
});
