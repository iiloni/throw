import { expect, type Page, test } from '@playwright/test';

import { card, fixture, settled } from './board-helpers';

/**
 * A card's subtasks unfolding under it in the backlog's masonry: the cards below move with the
 * underlay's edge, frame by frame, instead of chasing it (THR-127).
 */
test.describe('subtask underlay in the backlog masonry', () => {
  test.skip(({ isMobile }) => isMobile, 'The backlog rail and its gallery are the desktop board’s');

  type Box = { x: number; top: number; bottom: number; left: number; right: number };
  type Frame = {
    underlay: Box;
    list: number;
    /** While the list has room for the top of its first row, that row is what is drawn. */
    rowShown: boolean;
    cards: Record<string, Box>;
  };

  /** Toggles the parent's subtasks and records every frame until the grid is still. */
  function toggle(page: Page, parent: string, cardSelector = '[data-masonry] > [data-slot]') {
    return page.evaluate(
      async ([parent, cardSelector]) => {
        const rect = (element: Element) => {
          const box = element.getBoundingClientRect();
          return { x: box.x, top: box.top, bottom: box.bottom, left: box.left, right: box.right };
        };
        const slots = [...document.querySelectorAll<HTMLElement>(cardSelector)];
        const title = (slot: HTMLElement) =>
          (slot.matches('article') ? slot : slot.querySelector('article'))
            ?.getAttribute('aria-label')
            ?.replace(/^\S+ /, '') ?? '';
        const own = slots.find((slot) => title(slot) === parent)!;
        const underlay = (own.closest('.board-card-group') ?? own).querySelector<HTMLElement>(
          '[data-subtask-underlay]',
        )!;
        const list = underlay.querySelector<HTMLElement>('[data-subtask-list]')!;
        const firstRow = list.querySelector<HTMLElement>('li')!;
        const frames: Frame[] = [];
        underlay.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click();
        let still = 0;
        let last = '';
        const start = performance.now();
        while (still < 8 && performance.now() - start < 3000) {
          // Read once the frame is drawn, after Motion has written its values for it.
          await new Promise(requestAnimationFrame);
          await new Promise((resolve) => setTimeout(resolve));
          const listBox = list.getBoundingClientRect();
          const row = firstRow.getBoundingClientRect();
          const cards: Record<string, Box> = {};
          for (const slot of slots) if (slot !== own) cards[title(slot)] = rect(slot);
          const frame = {
            underlay: rect(underlay),
            list: listBox.height,
            // Drawn from the list's top edge, which clips it from below, and not hidden.
            rowShown:
              Math.abs(row.top - listBox.top) < 1 &&
              getComputedStyle(firstRow).visibility === 'visible' &&
              Number(getComputedStyle(list).opacity) === 1,
            cards,
          };
          const key = JSON.stringify([frame.underlay, cards]);
          still = key === last ? still + 1 : 0;
          last = key;
          frames.push(frame);
        }
        return frames;
      },
      [parent, cardSelector] as const,
    );
  }

  /** The list is caught on its way, and its first row is drawn while it has room for it. */
  function expectUnfolds(frames: Frame[], opening: boolean) {
    const report = JSON.stringify(frames.map((frame) => [frame.list, frame.rowShown]));
    expect(
      frames.some((frame) => frame.list > 20 && frame.list < 150),
      report,
    ).toBe(true);
    expect(
      frames.every((frame) => frame.rowShown),
      report,
    ).toBe(true);
    expect(frames.at(-1)!.list > 0).toBe(opening);
  }

  async function setUp(page: Page, others: string[]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    const board = await fixture(page, true);
    const parent = await board.add('Unfolding parent', 'Ideas', 3, 'a0');
    for (let index = 0; index < 5; index++)
      await board.add(`Unfolding step ${index + 1}`, 'Ideas', 3, `a${index}`, parent);
    for (const [index, title] of others.entries()) await board.add(title, 'Ideas', 3, `b${index}`);
    const opener = page.getByRole('button', { name: /^Open backlog,/ });
    if (await opener.count()) await opener.click();
    await settled(card(page, others.at(-1)!));
    return page.getByRole('complementary', { name: 'Backlog', exact: true });
  }

  /** The grid's 12 px gap from the underlay's edge to the card below, on every frame. */
  function expectGapHolds(frames: Frame[], below: string) {
    const gaps = frames.map((frame) => Math.round(frame.cards[below]!.top - frame.underlay.bottom));
    // The card below neither runs over the unfolding list nor leaves a hole behind the
    // folding one.
    for (const gap of gaps) expect(Math.abs(gap - 12), JSON.stringify(gaps)).toBeLessThanOrEqual(3);
  }

  test('the card below keeps its gap to the unfolding list in the rail', async ({ page }) => {
    await setUp(page, ['Card below']);
    for (const opening of [true, false]) {
      const frames = await toggle(page, 'Unfolding parent');
      expectUnfolds(frames, opening);
      expectGapHolds(frames, 'Card below');
    }
  });

  test('with reduced motion the list opens and closes in place, the card below with it', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setUp(page, ['Card below']);
    for (const opening of [true, false]) {
      const frames = await toggle(page, 'Unfolding parent');
      // No frame on the way: it is open or shut on the first one drawn.
      expect(frames.every((frame) => frame.list === frames.at(-1)!.list)).toBe(true);
      expect(frames.at(-1)!.list > 0).toBe(opening);
      expectGapHolds(frames, 'Card below');
    }
  });

  test('the card below follows the unfolding list in an active column too', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const board = await fixture(page, true);
    const parent = await board.add('Unfolding parent', 'Build', 3, 'a0');
    for (let index = 0; index < 5; index++)
      await board.add(`Unfolding step ${index + 1}`, 'Build', 3, `a${index}`, parent);
    await board.add('Card below', 'Build', 3, 'b0');
    await settled(card(page, 'Card below'));
    for (const opening of [true, false]) {
      const frames = await toggle(page, 'Unfolding parent', 'article[data-card-id]');
      expectUnfolds(frames, opening);
      const gaps = new Set(
        frames.map((frame) => Math.round(frame.cards['Card below']!.top - frame.underlay.bottom)),
      );
      // A column is a flex list: the card below rides on the list's edge.
      expect(gaps.size, [...gaps].join(',')).toBe(1);
    }
  });

  test('cards keep their columns in the gallery, and the one below keeps its gap', async ({
    page,
  }) => {
    const others = Array.from({ length: 10 }, (_, index) => `Gallery card ${index + 1}`);
    const backlog = await setUp(page, others);
    await backlog.getByRole('button', { name: 'Open as a gallery' }).click();
    await settled(card(page, others.at(-1)!));
    const columns = await page
      .getByRole('region', { name: 'Backlog tasks' })
      .locator('[data-masonry]')
      .evaluate((element) => JSON.parse(element.getAttribute('data-masonry')!).columns as number);
    expect(columns).toBeGreaterThan(1);
    // The first card below the parent in its column.
    const parentBox = (await card(page, 'Unfolding parent').boundingBox())!;
    const boxes = await Promise.all(
      others.map(async (title) => ({ title, box: (await card(page, title).boundingBox())! })),
    );
    const below = boxes
      .filter(({ box }) => Math.abs(box.x - parentBox.x) < 1 && box.y > parentBox.y)
      .sort((a, b) => a.box.y - b.box.y)[0]?.title;
    expect(below, 'a card below the parent').toBeDefined();
    for (const opening of [true, false]) {
      const frames = await toggle(page, 'Unfolding parent');
      expectUnfolds(frames, opening);
      expectGapHolds(frames, below!);
      // Nothing crosses to another column as the list grows or shrinks: afresh, masonry would
      // send the card below to the shortest column, across the unfolding list.
      for (const title of others) {
        const xs = new Set(frames.map((frame) => Math.round(frame.cards[title]!.x)));
        expect(xs.size, `${title} changed column`).toBe(1);
      }
      // And none of them is drawn over it.
      for (const frame of frames) {
        for (const [title, box] of Object.entries(frame.cards)) {
          const beside = box.right <= frame.underlay.left || box.left >= frame.underlay.right;
          const clear = box.bottom <= frame.underlay.top || box.top >= frame.underlay.bottom + 9;
          expect(beside || clear, `${title} over the underlay`).toBe(true);
        }
      }
    }
  });
});
