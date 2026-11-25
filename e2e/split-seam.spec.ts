import { expect, type Locator, type Page, test } from '@playwright/test';
import { card, fixture, workspaceFixture } from './board-helpers';

// The fade's width at the split view's seam (`--seam-fade` in styles.css).
const FADE = 24;

const scroller = (page: Page) => page.locator('[data-slot="scroll-area"][data-seam]');
const viewport = (seam: Locator) => seam.locator(':scope > [data-slot="scroll-area-viewport"]');

/** The fade's current width at the board's edge beside the open task. */
function fade(seam: Locator) {
  return viewport(seam).evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).getPropertyValue('--seam-fade')),
  );
}

/** How much of the scroller's end a sticky closed rail lies over (`--seam-inset`). */
function inset(seam: Locator) {
  return viewport(seam).evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).getPropertyValue('--seam-inset')),
  );
}

/**
 * A card cut where the columns end beside the task, and the card that the topmost element in
 * the fade beside its middle belongs to: the same one, as a mask is paint only.
 */
function hitInFade(seam: Locator) {
  return seam.evaluate((root, width) => {
    const viewport = root.querySelector<HTMLElement>(
      ':scope > [data-slot="scroll-area-viewport"]',
    )!;
    const covered = Number.parseFloat(getComputedStyle(viewport).getPropertyValue('--seam-inset'));
    const edge = root.getBoundingClientRect().right - covered;
    for (const item of root.querySelectorAll<HTMLElement>('[data-card-id]:not([data-overlay])')) {
      const box = item.getBoundingClientRect();
      if (box.left >= edge - width || box.right <= edge) continue;
      const hit = document.elementFromPoint(edge - width / 2, box.top + box.height / 2);
      const owner = hit?.closest<HTMLElement>('[data-card-id]');
      if (!owner) continue;
      return { cut: item.dataset.cardId, hit: owner.dataset.cardId };
    }
    return null;
  }, FADE);
}

async function assertSeam(page: Page, opener: Locator, { sticky = false } = {}) {
  const seam = scroller(page);
  await expect(seam).toHaveAttribute('data-seam', 'shut');
  await expect.poll(() => fade(seam)).toBe(0);

  await opener.click();
  const handle = page.getByRole('separator', { name: 'Resize task' });
  await expect(handle).toBeVisible();
  await expect(seam).toHaveAttribute('data-seam', 'open');
  // The board runs on under the open task: the fade stands at its edge.
  await expect(seam).toHaveAttribute('data-more-right', '');
  await expect.poll(() => fade(seam)).toBe(FADE);
  if (process.env.SEAM_SHOTS) {
    await page.screenshot({
      path: `${process.env.SEAM_SHOTS}-${test.info().title}-${Date.now()}.png`,
    });
  }

  // A sticky closed rail lies over the scroller's end: the fade ends at its edge instead.
  if (sticky) {
    const rail = page.getByRole('complementary', { name: 'Closed', exact: true });
    // Both read together: the rail springs as the row narrows beside the opening pane.
    await expect
      .poll(async () => {
        const [box, edge, covered] = await Promise.all([
          rail.boundingBox(),
          seam.boundingBox(),
          inset(seam),
        ]);
        return Math.abs(edge!.x + edge!.width - box!.x - covered);
      })
      .toBeLessThan(2);
  } else expect(await inset(seam)).toBe(0);

  // A card in the fade still takes the pointer.
  const hit = await hitInFade(seam);
  expect(hit).not.toBeNull();
  expect(hit?.hit).toBe(hit?.cut);

  // Nor does the fade stand in the handle's way.
  const grip = (await handle.boundingBox())!;
  const before = Number(await handle.getAttribute('aria-valuenow'));
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 - 60, grip.y + grip.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await handle.getAttribute('aria-valuenow')))
    .toBeGreaterThan(before + 40);

  // Scrolled to its end, nothing is cut at the seam and nothing fades.
  await viewport(seam).evaluate((element) => element.scrollTo({ left: element.scrollWidth }));
  await expect(seam).not.toHaveAttribute('data-more-right');
  await expect.poll(() => fade(seam)).toBe(0);
  await viewport(seam).evaluate((element) => element.scrollTo({ left: 0 }));
  await expect.poll(() => fade(seam)).toBe(FADE);

  // It leaves as the pane starts to close, easing out rather than waiting for the pane to go.
  await page.getByRole('button', { name: 'Back to the board', exact: true }).click();
  await expect(seam).toHaveAttribute('data-seam', 'shut');
  await expect.poll(() => fade(seam)).toBe(0);
  await expect(page.locator('[data-task-pane-frame]')).toHaveCount(0);
}

test.describe('split view seam', () => {
  test.skip(({ isMobile }) => isMobile, 'The split view is desktop only.');

  test('fades the project board out at the open task, its closed rail bound or not', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await fixture(page);
    // The sticky closed rail stands beside the seam: the columns fade where they meet it.
    await assertSeam(page, card(page, 'Low priority'), { sticky: true });

    // Bound, the closed rail scrolls with the columns and runs on under the task.
    await page.evaluate(() =>
      localStorage.setItem(
        'throw-board-settings',
        JSON.stringify({ backlogRail: 'sticky', closedRail: 'bound' }),
      ),
    );
    await page.reload();
    await expect(card(page, 'Low priority')).toBeVisible({ timeout: 30_000 });
    await assertSeam(page, card(page, 'Low priority'));
  });

  test('fades the workspace board out at the open task', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await workspaceFixture(page);
    await assertSeam(page, card(page, 'Bake bread'));
  });
});
