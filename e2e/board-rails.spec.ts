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
    // A gallery has no edge: the focus moves to the toggle that takes it back.
    await expect(handle).toHaveCount(0);
    await expect(backlog.getByRole('button', { name: 'Back to a column' })).toBeFocused();
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

  test('holding a rail’s strip opens it straight into the gallery, and a click into a column', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await fixture(page, true);
    const backlog = rail(page, 'Backlog');
    const closed = rail(page, 'Closed');
    const strip = (name: 'backlog' | 'closed') =>
      page.getByRole('button', { name: new RegExp(`^Open ${name},`) });
    // A wide window opens the backlog as a column; both rails start from their strips here.
    await backlog.getByRole('button', { name: 'Close backlog' }).click();

    async function press(name: 'backlog' | 'closed', hold: number, drift = 0) {
      const box = (await strip(name).boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 3;
      await page.mouse.move(x, y);
      await page.mouse.down();
      if (drift) await page.mouse.move(x + drift, y, { steps: 4 });
      await page.waitForTimeout(hold);
      await page.mouse.up();
    }

    for (const [name, zone, other] of [
      ['backlog', backlog, closed],
      ['closed', closed, backlog],
    ] as const) {
      const otherName = name === 'backlog' ? 'closed' : 'backlog';
      // The other rail stands open as a column, to see the gallery send it back to its strip.
      await strip(otherName).click();
      await expect(other.getByRole('button', { name: 'Open as a gallery' })).toBeVisible();

      // Let go early: a click, which opens a column.
      await press(name, 120);
      await expect(zone.getByRole('button', { name: 'Open as a gallery' })).toBeVisible();
      await zone.getByRole('button', { name: `Close ${name}` }).click();

      // Moved off the strip while held: nothing opens, however long it is held.
      await press(name, 700, name === 'backlog' ? 80 : -80);
      await page.waitForTimeout(300);
      await expect(strip(name)).toBeVisible();
      await expect(zone.getByRole('button', { name: 'Back to a column' })).toHaveCount(0);

      // Held: the gallery, which letting go does not take back to a column.
      await press(name, 700);
      await expect(zone.getByRole('button', { name: 'Back to a column' })).toBeVisible();
      await expect(strip(otherName)).toBeVisible();
      await page.waitForTimeout(300);
      await expect(zone.getByRole('button', { name: 'Back to a column' })).toBeVisible();
      await zone.getByRole('button', { name: `Close ${name}` }).click();
      await expect(strip(name)).toBeVisible();
    }

    // The keyboard still opens a column.
    await strip('backlog').focus();
    await page.keyboard.press('Enter');
    await expect(backlog.getByRole('button', { name: 'Open as a gallery' })).toBeVisible();
  });

  test('an edge dragged out snaps to the gallery, which has no edge of its own', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await fixture(page, true);
    for (const [name, opener, outward] of [
      ['Backlog', /^Open backlog,/, 1],
      ['Closed', /^Open closed,/, -1],
    ] as const) {
      const open = page.getByRole('button', { name: opener });
      if (await open.count()) await open.click();
      const zone = rail(page, name);
      const handle = zone.getByRole('separator', { name: `Resize ${name.toLowerCase()}` });
      // Settled open, so the grip is where the pointer goes down.
      await expect.poll(() => widthOf(zone)).toBe(304);
      const grip = (await handle.boundingBox())!;
      const y = grip.y + grip.height / 2;
      const x = grip.x + grip.width / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      // Out to the window's far side, past the gallery's snap but still inside the window.
      await page.mouse.move(outward > 0 ? 1430 : 10, y, { steps: 10 });
      // Still a panel following the pointer, and still holding its edge, until let go.
      await expect(handle).toBeVisible();
      await page.mouse.up();
      await expect(zone.getByRole('button', { name: 'Back to a column' })).toBeVisible();
      await expect(handle).toHaveCount(0);
      const full = await widthOf(zone);
      // Let go, the gallery no longer follows the pointer.
      await page.mouse.move(x, y, { steps: 4 });
      await expect.poll(() => widthOf(zone)).toBe(full);
      // The header takes it back to a column, whose edge returns.
      await zone.getByRole('button', { name: 'Back to a column' }).click();
      await expect(handle).toBeVisible();
      await zone.getByRole('button', { name: `Close ${name.toLowerCase()}` }).click();
      await expect(handle).toHaveCount(0);
    }
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
        new Promise<{ width: number; room: number; card: number }[]>((resolve) => {
          const aside = document.querySelector<HTMLElement>('aside[data-origin="backlog"]')!;
          const row = aside.parentElement!;
          const last = [...aside.querySelectorAll<HTMLElement>('[data-slot]')].at(-1)!;
          const seen: { width: number; room: number; card: number }[] = [];
          const started = performance.now();
          // Read once each frame has been laid out and drawn, not part way through one.
          const sample = (now: number) =>
            setTimeout(() => {
              seen.push({
                width: aside.getBoundingClientRect().width,
                room: row.getBoundingClientRect().width - 64 - 40,
                card: last.getBoundingClientRect().left,
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
    // The cards are laid out once for the narrower gallery, as Catch's are beside a note, so
    // each springs one way to its new place instead of being re-aimed on every frame.
    const moves = seen.map((frame) => frame.card);
    const direction = Math.sign(moves.at(-1)! - moves[0]!);
    // A spring's own bounce turns back by a pixel or two; a re-aimed layout turned back by a
    // column.
    let back = 0;
    for (let index = 1; index < moves.length; index++)
      back += Math.max(0, (moves[index - 1]! - moves[index]!) * direction);
    expect(back).toBeLessThan(8);
    // The cards follow: still side by side in the narrower gallery once the pane is open.
    const [one, two] = await Promise.all(
      ['Pane one', 'Pane two'].map(
        async (title) => (await (await settled(card(page, title))).boundingBox())!,
      ),
    );
    expect(Math.round(one!.y)).toBe(Math.round(two!.y));
  });

  test('toggling the docked search sidebar over a gallery reflows the masonry once instead of on every frame', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const board = await fixture(page, true);
    for (const [title, position] of [
      ['Sidebar one', 'a1'],
      ['Sidebar two', 'a2'],
      ['Sidebar three', 'a3'],
      ['Sidebar four', 'a4'],
      ['Sidebar five', 'a5'],
      ['Sidebar six', 'a6'],
    ] as const)
      await board.add(title, 'Ideas', 3, position);
    await openBacklog(page);
    const backlog = rail(page, 'Backlog');
    await backlog.getByRole('button', { name: 'Open as a gallery' }).click();
    await settled(card(page, 'Sidebar five'));
    const wide = await widthOf(backlog);
    const [firstBefore, fifthBefore] = await Promise.all(
      ['Sidebar one', 'Sidebar five'].map(
        async (title) => (await card(page, title).boundingBox())!,
      ),
    );
    expect(Math.round(firstBefore!.y)).toBe(Math.round(fifthBefore!.y));

    const sampleMotion = () =>
      page.evaluate(
        () =>
          new Promise<
            { width: number; room: number; masonry: string; cardX: number; headerRight: number }[]
          >((resolve) => {
            const aside = document.querySelector<HTMLElement>('aside[data-origin="backlog"]')!;
            const row = aside.parentElement!;
            const grid = aside.querySelector<HTMLElement>('[data-masonry]')!;
            // Fifth card moves between row 1 (5 columns) and row 2 (4 columns) on sidebar toggle.
            const fifth = aside.querySelectorAll<HTMLElement>('[data-slot]')[4]!;
            const closeBtn = aside.querySelector<HTMLElement>(
              'button[aria-label="Close backlog"]',
            )!;
            const seen: {
              width: number;
              room: number;
              masonry: string;
              cardX: number;
              headerRight: number;
            }[] = [];
            const started = performance.now();
            const sample = (now: number) =>
              setTimeout(() => {
                seen.push({
                  width: aside.getBoundingClientRect().width,
                  room: row.getBoundingClientRect().width - 64 - 40,
                  masonry: grid.getAttribute('data-masonry') ?? '',
                  cardX: fifth.getBoundingClientRect().left - grid.getBoundingClientRect().left,
                  headerRight: closeBtn.getBoundingClientRect().right,
                });
                if (now - started < 1100) requestAnimationFrame(sample);
                else resolve(seen);
              });
            requestAnimationFrame(sample);
          }),
      );

    // Open the docked search sidebar while the backlog gallery is expanded.
    const expandFrames = sampleMotion();
    await page.keyboard.press('ControlOrMeta+k');
    const expanded = await expandFrames;
    await expect(
      page.getByRole('search', { name: 'Search the board', exact: true }),
    ).toHaveAttribute('data-docked', '');

    const narrow = expanded.at(-1)!.width;
    expect(narrow).toBeLessThan(wide - 300);
    // The rail follows the row frame-by-frame while the sidebar slides in.
    for (const frame of expanded) expect(Math.abs(frame.width - frame.room)).toBeLessThan(1);
    // Masonry computes once for the resting width instead of recomputing on every animation frame.
    const expandLayouts = new Set(expanded.map((frame) => frame.masonry));
    expect(expandLayouts.size).toBeLessThanOrEqual(2);
    // The backlog header actions stay anchored at the rail's stationary right edge.
    const expandHeaderRights = expanded.map((frame) => frame.headerRight);
    expect(Math.max(...expandHeaderRights) - Math.min(...expandHeaderRights)).toBeLessThan(4);
    // The reflowing card springs cleanly to its new slot without oscillating across intermediate layouts.
    const expandMoves = expanded.map((frame) => frame.cardX);
    const expandDir = Math.sign(expandMoves.at(-1)! - expandMoves[0]!);
    let expandBack = 0;
    for (let i = 1; i < expandMoves.length; i++)
      expandBack += Math.max(0, (expandMoves[i - 1]! - expandMoves[i]!) * expandDir);
    expect(expandBack).toBeLessThan(16);
    const [firstNarrow, fifthNarrow] = await Promise.all(
      ['Sidebar one', 'Sidebar five'].map(
        async (title) => (await (await settled(card(page, title))).boundingBox())!,
      ),
    );
    expect(fifthNarrow!.y).toBeGreaterThan(firstNarrow!.y + 40);

    // Collapse the docked search sidebar and verify the reverse transition.
    const collapseFrames = sampleMotion();
    await page.keyboard.press('Escape');
    const collapsed = await collapseFrames;
    await expect(page.getByRole('search', { name: 'Search the board', exact: true })).toHaveCount(
      0,
    );

    expect(collapsed.at(-1)!.width).toBeCloseTo(wide, 0);
    for (const frame of collapsed) expect(Math.abs(frame.width - frame.room)).toBeLessThan(1);
    const collapseLayouts = new Set(collapsed.map((frame) => frame.masonry));
    expect(collapseLayouts.size).toBeLessThanOrEqual(2);
    const collapseHeaderRights = collapsed.map((frame) => frame.headerRight);
    expect(Math.max(...collapseHeaderRights) - Math.min(...collapseHeaderRights)).toBeLessThan(4);
    const collapseMoves = collapsed.map((frame) => frame.cardX);
    const collapseDir = Math.sign(collapseMoves.at(-1)! - collapseMoves[0]!);
    let collapseBack = 0;
    for (let i = 1; i < collapseMoves.length; i++)
      collapseBack += Math.max(0, (collapseMoves[i - 1]! - collapseMoves[i]!) * collapseDir);
    expect(collapseBack).toBeLessThan(16);

    // The fifth card returns to the top row once the sidebar finishes closing.
    const settledBoxes = await Promise.all(
      ['Sidebar one', 'Sidebar five'].map(
        async (title) => (await (await settled(card(page, title))).boundingBox())!,
      ),
    );
    expect(Math.round(settledBoxes[0]!.y)).toBe(Math.round(settledBoxes[1]!.y));
  });
});
