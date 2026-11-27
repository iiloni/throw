import { expect, type Locator, type Page, test } from '@playwright/test';
import { card, fixture, workspaceFixture } from './board-helpers';

// The fade's width at the board's sides (`--side-fade` in styles.css).
const FADE = 16;

type Side = 'left' | 'right';

const scroller = (page: Page) => page.locator('[data-slot="scroll-area"][data-seam]');
const viewport = (seam: Locator) => seam.locator(':scope > [data-slot="scroll-area-viewport"]');

/** A custom property's current length on the board's viewport. */
function length(seam: Locator, property: string) {
  return viewport(seam).evaluate(
    (element, name) => Number.parseFloat(getComputedStyle(element).getPropertyValue(name)),
    property,
  );
}
/** The fade's current width at one side. */
const fade = (seam: Locator, side: Side) => length(seam, `--edge-${side}`);
/** How much of the scroller's end at one side a sticky rail lies over. */
const inset = (seam: Locator, side: Side) => length(seam, `--inset-${side}`);

/**
 * A card cut where the columns end at one side, and the card that the topmost element at a
 * point in the fade over it belongs to: the same one, as a mask is paint only. Null until a
 * cut card takes a point there (the pane may still be sliding).
 */
function hitInFade(seam: Locator, side: Side) {
  return seam.evaluate(
    (root, [width, at]) => {
      const viewport = root.querySelector<HTMLElement>(
        ':scope > [data-slot="scroll-area-viewport"]',
      )!;
      const covered = Number.parseFloat(
        getComputedStyle(viewport).getPropertyValue(`--inset-${at}`),
      );
      const bounds = root.getBoundingClientRect();
      const edge = at === 'right' ? bounds.right - covered : bounds.left + covered;
      const cards = [...root.querySelectorAll<HTMLElement>('[data-card-id]:not([data-overlay])')];
      for (const depth of [0.5, 0.25, 0.75].map((share) => share * Number(width))) {
        const x = at === 'right' ? edge - depth : edge + depth;
        for (const item of cards) {
          const box = item.getBoundingClientRect();
          if (box.left >= x || box.right <= x) continue;
          if (at === 'right' ? box.right <= edge : box.left >= edge) continue;
          const owner = document
            .elementFromPoint(x, box.top + box.height / 2)
            ?.closest<HTMLElement>('[data-card-id]');
          if (owner) return { cut: item.dataset.cardId, hit: owner.dataset.cardId };
        }
      }
      return null;
    },
    [FADE, side] as const,
  );
}

/** A card in the fade at one side still takes the pointer. */
async function takesPointer(seam: Locator, side: Side) {
  await expect.poll(() => hitInFade(seam, side)).not.toBeNull();
  const hit = await hitInFade(seam, side);
  expect(hit?.hit).toBe(hit?.cut);
}

/** A sticky rail's inner edge and the fade's end at that side, read together as it springs. */
async function insetMatches(page: Page, seam: Locator, rail: 'Backlog' | 'Closed') {
  const side: Side = rail === 'Closed' ? 'right' : 'left';
  const aside = page.getByRole('complementary', { name: rail, exact: true });
  await expect
    .poll(async () => {
      const [box, edge, covered] = await Promise.all([
        aside.boundingBox(),
        seam.boundingBox(),
        inset(seam, side),
      ]);
      const expected =
        side === 'right' ? edge!.x + edge!.width - box!.x : box!.x + box!.width - edge!.x;
      return Math.abs(expected - covered);
    })
    .toBeLessThan(2);
}

async function assertSides(
  page: Page,
  opener: Locator,
  { stickyClosed = false, stickyBacklog = false } = {},
) {
  const seam = scroller(page);
  await expect(seam).toHaveAttribute('data-seam', 'shut');
  await expect.poll(() => fade(seam, 'right')).toBe(0);

  await opener.click();
  const handle = page.getByRole('separator', { name: 'Resize task' });
  await expect(handle).toBeVisible();
  await expect(seam).toHaveAttribute('data-seam', 'open');
  // The board runs on under the open task: the fade stands at its edge.
  await expect(seam).toHaveAttribute('data-more-right', '');
  await expect.poll(() => fade(seam, 'right')).toBe(FADE);
  await expect.poll(() => fade(seam, 'left')).toBe(0);

  // A sticky closed rail lies over the scroller's end: the fade ends at its edge instead.
  if (stickyClosed) await insetMatches(page, seam, 'Closed');
  else expect(await inset(seam, 'right')).toBe(0);

  // A card in the fade still takes the pointer.
  await takesPointer(seam, 'right');

  // Nor does the fade stand in the handle's way. It narrows the task: widened, it would leave
  // the board too little room for its rails, and the board would take its compact layout.
  // Grab it where the pane came to rest, not where it was while sliding open.
  let last = Number.NaN;
  await expect
    .poll(async () => {
      const x = (await handle.boundingBox())?.x ?? Number.NaN;
      const still = x === last;
      last = x;
      return still;
    })
    .toBe(true);
  const grip = (await handle.boundingBox())!;
  const before = Number(await handle.getAttribute('aria-valuenow'));
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 60, grip.y + grip.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await handle.getAttribute('aria-valuenow')))
    .toBeLessThan(before - 40);

  // Scrolled along, the columns that leave on the left fade too, at a sticky backlog rail's
  // edge where one lies over the scroller's start.
  await viewport(seam).evaluate((element) => element.scrollTo({ left: 160 }));
  await expect(seam).toHaveAttribute('data-more-left', '');
  await expect.poll(() => fade(seam, 'left')).toBe(FADE);
  // Beside a sticky backlog rail, the strip the fade covers is its edge's grip.
  if (stickyBacklog) await insetMatches(page, seam, 'Backlog');
  else {
    expect(await inset(seam, 'left')).toBe(0);
    await takesPointer(seam, 'left');
  }
  if (process.env.SEAM_SHOTS) {
    await page.screenshot({
      path: `${process.env.SEAM_SHOTS}-${test.info().title}-${Date.now()}.png`,
    });
  }

  // Scrolled to either end, nothing is cut there and nothing fades there.
  await viewport(seam).evaluate((element) => element.scrollTo({ left: element.scrollWidth }));
  await expect(seam).not.toHaveAttribute('data-more-right');
  await expect.poll(() => fade(seam, 'right')).toBe(0);
  await viewport(seam).evaluate((element) => element.scrollTo({ left: 0 }));
  await expect(seam).not.toHaveAttribute('data-more-left');
  await expect.poll(() => fade(seam, 'left')).toBe(0);
  await expect.poll(() => fade(seam, 'right')).toBe(FADE);

  // It leaves as the pane starts to close, easing out rather than waiting for the pane to go.
  await page.getByRole('button', { name: 'Back to the board', exact: true }).click();
  await expect(seam).toHaveAttribute('data-seam', 'shut');
  await expect.poll(() => fade(seam, 'right')).toBe(0);
  await expect(page.locator('[data-task-pane-frame]')).toHaveCount(0);
}

test.describe('board side fades', () => {
  test.skip(({ isMobile }) => isMobile, 'The split view is desktop only.');

  test('fade the project board at the open task and the backlog, the closed rail bound or not', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await fixture(page);
    // Sticky rails stand at both ends: the columns fade where they meet them.
    await assertSides(page, card(page, 'Low priority'), {
      stickyClosed: true,
      stickyBacklog: true,
    });

    // Bound, the closed rail scrolls with the columns and runs on under the task.
    await page.evaluate(() => {
      localStorage.setItem(
        'throw-board-settings',
        JSON.stringify({ backlogRail: 'sticky', closedRail: 'bound' }),
      );
      // The task opens at its first width again, so the columns run on under it.
      localStorage.removeItem('throw-task-pane-width');
    });
    await page.reload();
    await expect(card(page, 'Low priority')).toBeVisible({ timeout: 30_000 });
    await assertSides(page, card(page, 'Low priority'), { stickyBacklog: true });
  });

  test('fade the workspace board at the open task and its start', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await workspaceFixture(page);
    await assertSides(page, card(page, 'Bake bread'));
  });
});
