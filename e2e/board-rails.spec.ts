import { expect, type Locator, type Page, test } from '@playwright/test';

import { card, carry, fixture, settled, taskRow } from './board-helpers';

/** The desktop backlog and closed rails: Catch's masonry, its springs, and the rails' edges. */
test.describe('desktop rails', () => {
  test.skip(({ isMobile }) => isMobile, 'The rails are the desktop board’s');

  const rail = (page: Page, name: 'Backlog' | 'Closed') =>
    page.getByRole('complementary', { name, exact: true });

  async function openBacklog(page: Page) {
    const opener = page.getByRole('button', { name: /^Open backlog,/ });
    if (await opener.count()) await opener.click();
    await expect(
      rail(page, 'Backlog').getByRole('region', { name: 'Backlog tasks' }),
    ).toBeVisible();
  }

  const widthOf = (target: Locator) => target.evaluate((element) => element.clientWidth);

  test('the closed gallery reads newest first across the top row', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const board = await fixture(page, true);
    for (const title of ['Closed one', 'Closed two', 'Closed three', 'Closed four'])
      await board.add(title, 'Done');
    const closed = rail(page, 'Closed');
    await page.getByRole('button', { name: /^Open closed,/ }).click();
    await closed.getByRole('button', { name: 'Open as a gallery' }).click();
    const newest = await settled(card(page, 'Closed four'));
    await settled(card(page, 'Closed one'));
    const boxes = await Promise.all(
      ['Closed four', 'Closed three', 'Closed two'].map(
        async (title) => (await card(page, title).boundingBox())!,
      ),
    );
    // Masonry fills the top row first, left to right, instead of running down a column.
    expect(new Set(boxes.map((box) => Math.round(box.y))).size).toBe(1);
    expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
    expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x);
    expect((await newest.boundingBox())!.y).toBeLessThan(
      (await card(page, 'Closed one').boundingBox())!.y + 1,
    );
  });

  test('opening the gallery fans the same cards out, and closing gathers them back', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const board = await fixture(page, true);
    for (const [title, position] of [
      ['Fan one', 'a1'],
      ['Fan two', 'a2'],
      ['Fan three', 'a3'],
    ] as const)
      await board.add(title, 'Ideas', 3, position);
    await openBacklog(page);
    const backlog = rail(page, 'Backlog');
    const two = await settled(card(page, 'Fan two'));
    const before = (await two.boundingBox())!;
    const node = await two.elementHandle();
    await backlog.getByRole('button', { name: 'Open as a gallery' }).click();
    // The card springs from its place in the column to the second column: some frame lies
    // between the two, and it is the same element all the way.
    const samples: number[] = [];
    for (let frame = 0; frame < 12; frame++) {
      samples.push((await two.boundingBox())!.x);
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    const after = (await (await settled(two)).boundingBox())!;
    expect(after.x).toBeGreaterThan(before.x + 100);
    expect(Math.round(after.y)).toBe(Math.round((await card(page, 'Fan one').boundingBox())!.y));
    expect(samples.some((x) => x > before.x + 4 && x < after.x - 4)).toBe(true);
    expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
    await backlog.getByRole('button', { name: 'Back to a column' }).click();
    await expect.poll(async () => (await two.boundingBox())!.x).toBeCloseTo(before.x, 0);
    expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
  });

  test('the backlog’s single column parts for a held card and places it where it is dropped', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const board = await fixture(page, true);
    for (const [title, position] of [
      ['Column one', 'a1'],
      ['Column two', 'a2'],
      ['Column three', 'a3'],
    ] as const)
      await board.add(title, 'Ideas', 3, position);
    await openBacklog(page);
    const list = rail(page, 'Backlog').getByRole('region', { name: 'Backlog tasks' });
    const one = (await (await settled(card(page, 'Column one'))).boundingBox())!;
    await carry(page, card(page, 'Column three'), [{ x: one.x + one.width / 2, y: one.y + 8 }], {
      drop: false,
    });
    // A gap opens at the top and the first card moves down to make room for it.
    await expect(list.locator('[data-gap]')).toHaveCount(1);
    await expect
      .poll(async () => (await card(page, 'Column one').boundingBox())!.y)
      .toBeGreaterThan(one.y + 40);
    await page.mouse.up();
    const order = () =>
      list
        .getByRole('article')
        .evaluateAll((cards) =>
          cards.map((item) => item.getAttribute('aria-label')?.replace(/^\S+ /, '')),
        );
    await expect.poll(order).toEqual(['Column three', 'Column one', 'Column two']);
    await expect
      .poll(async () => {
        const [three, first] = await Promise.all(
          ['Column three', 'Column one'].map((title) =>
            taskRow(page, board.headers, board.ids[title]!),
          ),
        );
        return String(three?.position) < String(first?.position);
      })
      .toBe(true);
  });

  test('a rail’s edge drags it wider, snaps to a strip or the gallery, and is remembered', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const board = await fixture(page, true);
    for (const [title, position] of [
      ['Wide one', 'a1'],
      ['Wide two', 'a2'],
    ] as const)
      await board.add(title, 'Ideas', 3, position);
    await openBacklog(page);
    const backlog = rail(page, 'Backlog');
    const handle = backlog.getByRole('separator', { name: 'Resize backlog' });
    const start = await widthOf(backlog);
    expect(start).toBe(304);
    const grip = (await handle.boundingBox())!;
    const y = grip.y + grip.height / 2;
    const x = grip.x + grip.width / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 150, y, { steps: 6 });
    // The rail follows the pointer exactly while the edge is held.
    await expect.poll(() => widthOf(backlog)).toBe(start + 150);
    await page.mouse.move(x + 300, y, { steps: 6 });
    await expect.poll(() => widthOf(backlog)).toBe(start + 300);
    await page.mouse.up();
    // Wide enough for two columns, so the cards stand side by side.
    await settled(card(page, 'Wide two'));
    const [one, two] = await Promise.all(
      ['Wide one', 'Wide two'].map(async (title) => (await card(page, title).boundingBox())!),
    );
    expect(Math.round(one!.y)).toBe(Math.round(two!.y));
    expect(two!.x).toBeGreaterThan(one!.x + 200);
    // The columns stay beside it.
    await expect(page.getByRole('region', { name: 'Build', exact: true })).toBeVisible();

    // The width is kept on the device.
    await page.reload();
    await expect.poll(() => widthOf(rail(page, 'Backlog'))).toBe(start + 300);

    // The keys walk the width too, and End steps on to the gallery.
    await handle.focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => widthOf(backlog)).toBe(start + 300 - 32);
    await page.keyboard.press('End');
    await expect(backlog.getByRole('button', { name: 'Back to a column' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Build', exact: true })).toHaveCount(0);
    // The toggle still restores the remembered panel.
    await backlog.getByRole('button', { name: 'Back to a column' }).click();
    await expect.poll(() => widthOf(backlog)).toBe(start + 300 - 32);

    // Dragged most of the way shut, it snaps to its strip when let go.
    const shut = (await handle.boundingBox())!;
    await page.mouse.move(shut.x + shut.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(shut.x - 500, y, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByRole('button', { name: /^Open backlog,/ })).toBeVisible();
    await expect.poll(() => widthOf(backlog)).toBe(64);
  });

  test('a task opened over a gallery narrows it without springing back and forth', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const board = await fixture(page, true);
    for (const [title, position] of [
      ['Pane one', 'a1'],
      ['Pane two', 'a2'],
      ['Pane three', 'a3'],
      ['Pane four', 'a4'],
    ] as const)
      await board.add(title, 'Ideas', 3, position);
    await openBacklog(page);
    const backlog = rail(page, 'Backlog');
    await backlog.getByRole('button', { name: 'Open as a gallery' }).click();
    await settled(card(page, 'Pane four'));
    const wide = await widthOf(backlog);
    // Every frame of the pane opening: the gallery's width, and the room its row leaves it
    // beside the closed strip and the gaps either side.
    const frames = page.evaluate(
      () =>
        new Promise<{ width: number; room: number }[]>((resolve) => {
          const aside = document.querySelector<HTMLElement>('aside[data-origin="backlog"]')!;
          const row = aside.parentElement!;
          const seen: { width: number; room: number }[] = [];
          const started = performance.now();
          // Read once each frame has been laid out and drawn, not part way through one.
          const sample = (now: number) =>
            setTimeout(() => {
              seen.push({
                width: aside.getBoundingClientRect().width,
                room: row.getBoundingClientRect().width - 64 - 40,
              });
              if (now - started < 1200) requestAnimationFrame(sample);
              else resolve(seen);
            });
          requestAnimationFrame(sample);
        }),
    );
    await card(page, 'Pane one').click();
    const seen = await frames;
    await expect(page.getByRole('region', { name: 'Task', exact: true })).toBeVisible();
    const narrow = seen.at(-1)!.width;
    expect(narrow).toBeLessThan(wide - 200);
    // It narrows with the pane, frame by frame, rather than chasing it with a spring re-aimed
    // every frame, which lagged behind the pane and then bounced past where it ends up.
    for (const frame of seen) expect(Math.abs(frame.width - frame.room)).toBeLessThan(1);
    for (let index = 1; index < seen.length; index++)
      expect(seen[index]!.width).toBeLessThanOrEqual(seen[index - 1]!.width + 0.5);
    // The cards follow: still side by side in the narrower gallery once the pane is open.
    const [one, two] = await Promise.all(
      ['Pane one', 'Pane two'].map(
        async (title) => (await (await settled(card(page, title))).boundingBox())!,
      ),
    );
    expect(Math.round(one!.y)).toBe(Math.round(two!.y));
  });
});
