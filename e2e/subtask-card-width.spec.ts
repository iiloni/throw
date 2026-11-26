import { expect, type Locator, type Page, test } from '@playwright/test';

import { card, carry, fixture, settled } from './board-helpers';

/**
 * A card with subtasks keeps to its column's width (THR-142). A subtask's title is drawn on one
 * line and truncated; laid out unwrapped, it used to widen the card past the column's edge, even
 * while the list under the card was folded away.
 */
const PARENT =
  'A parent card whose own title is long enough to wrap over several lines of its card';
const SUBTASK =
  'A subtask with a very long title that should be truncated with an ellipsis rather than widening its card ' +
  'https://example.com/an/unbreakable/path/that/runs/on/and/on/without/a/single/place/to/break';
const SIBLING = 'A sibling card without subtasks';

async function seed(page: Page, status: string) {
  const board = await fixture(page, true);
  const parent = await board.add(PARENT, status, 3, 'a0');
  await board.add(SUBTASK, status, 3, 'a0', parent);
  await board.add(SIBLING, status, 3, 'a1');
  return board;
}

/** Everything about the parent card's width, measured in `region`'s scroller. */
function measure(region: Locator, parent: string, sibling: string) {
  return region.evaluate(
    (element, [parent, sibling]) => {
      const article = (title: string) =>
        [...element.querySelectorAll<HTMLElement>('article[data-card-id]')].find((card) =>
          card.getAttribute('aria-label')?.endsWith(title),
        )!;
      const own = article(parent);
      const other = article(sibling);
      const viewport = own.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
      const underlay = own
        .closest('.board-card-group')!
        .querySelector<HTMLElement>('[data-subtask-underlay]')!;
      const title = underlay.querySelector<HTMLElement>('[data-subtask-list] li span')!;
      const box = viewport.getBoundingClientRect();
      const ownBox = own.getBoundingClientRect();
      return {
        viewportRight: box.right,
        windowRight: document.documentElement.clientWidth,
        cardRight: ownBox.right,
        cardWidth: ownBox.width,
        siblingWidth: other.getBoundingClientRect().width,
        underlayRight: underlay.getBoundingClientRect().right,
        scrollWidth: viewport.scrollWidth,
        clientWidth: viewport.clientWidth,
        titleTruncated: title.scrollWidth > title.clientWidth,
        expanded: underlay.querySelector('[data-subtask-list]')!.hasAttribute('data-expanded'),
      };
    },
    [parent, sibling] as const,
  );
}

async function expectContained(region: Locator) {
  const width = await measure(region, PARENT, SIBLING);
  const report = JSON.stringify(width);
  expect(width.cardRight, report).toBeLessThanOrEqual(width.viewportRight + 0.5);
  expect(width.cardRight, report).toBeLessThanOrEqual(width.windowRight + 0.5);
  expect(Math.abs(width.cardWidth - width.siblingWidth), report).toBeLessThanOrEqual(1);
  expect(width.underlayRight, report).toBeLessThanOrEqual(width.cardRight + 0.5);
  expect(width.scrollWidth, report).toBeLessThanOrEqual(width.clientWidth + 1);
  return width;
}

/** Checks the card folded, then unfolds its subtasks and checks it again, title cut short. */
async function expectFitsBothWays(page: Page, region: Locator) {
  const parent = region.getByRole('article', { name: new RegExp(`${PARENT}$`) });
  await settled(parent);
  expect((await expectContained(region)).expanded).toBe(false);
  await region.getByRole('button', { name: '0 of 1 subtasks done' }).click();
  await expect(region.locator('[data-subtask-list][data-expanded]')).toBeVisible();
  await expect(region.getByRole('button', { name: SUBTASK })).toBeVisible();
  await settled(region.locator('[data-subtask-underlay]'));
  const open = await expectContained(region);
  expect(open.expanded).toBe(true);
  expect(open.titleTruncated, 'the subtask title is cut short').toBe(true);
}

test.describe('a card with subtasks keeps to its column', () => {
  test('in an active column', async ({ page, isMobile }) => {
    await seed(page, 'Build');
    await settled(card(page, SIBLING));
    await expectFitsBothWays(page, page.getByRole('region', { name: 'Build', exact: true }));
    if (!isMobile) {
      const box = (await card(page, PARENT).boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
  });

  test('in the backlog', async ({ page, isMobile }) => {
    await seed(page, 'Ideas');
    if (isMobile) await page.getByRole('button', { name: /^Backlog \d+$/ }).click();
    else {
      const opener = page.getByRole('button', { name: /^Open backlog,/ });
      if (await opener.count()) await opener.click();
    }
    const backlog = page.getByRole('region', { name: 'Backlog tasks' });
    await settled(card(page, SIBLING));
    await expectFitsBothWays(page, backlog);
  });

  test('the held copy takes the card’s width', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Held with the mouse; the phone lifts the same overlay by long press');
    // Still and flat while held, so the copy is measured at the card's own size.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seed(page, 'Build');
    const parent = await settled(card(page, PARENT));
    const width = (await parent.boundingBox())!.width;
    const column = page.getByRole('region', { name: 'Review', exact: true });
    await carry(page, parent, [column], { drop: false });
    const copy = page.locator('div.fixed.z-\\[60\\] article');
    await expect(copy).toBeVisible();
    await expect.poll(async () => (await copy.boundingBox())!.width).toBeCloseTo(width, 0);
    const underlay = page.locator('div.fixed.z-\\[60\\] [data-subtask-underlay]');
    const copyBox = (await copy.boundingBox())!;
    const underlayBox = (await underlay.boundingBox())!;
    expect(underlayBox.x + underlayBox.width).toBeLessThanOrEqual(copyBox.x + copyBox.width + 0.5);
    await page.mouse.up();
  });
});
