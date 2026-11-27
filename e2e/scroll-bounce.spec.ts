import { expect, type Locator, type Page, test } from '@playwright/test';
import { fixture } from './board-helpers';
import { APP_LOAD_TIMEOUT, signUp } from './helpers';

/**
 * Flings a viewport from partway down to its top over painted frames, as a
 * fast wheel or a touch's momentum does, and reports what moved in the frames after.
 */
async function flingToTop(viewport: Locator) {
  const start = 240;
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThanOrEqual(start);
  return viewport.evaluate(async (element, start) => {
    const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
    const column = document.querySelector<HTMLElement>('[data-page-column]');
    const scroller = element === document.scrollingElement ? null : element;
    const scrollTarget = scroller ?? document;
    const samples: { top: number; time: number }[] = [];
    const step = (top: number) => {
      const scrolled = new Promise<number>((resolve) => {
        scrollTarget.addEventListener(
          'scroll',
          (event) => {
            samples.push({ top: element.scrollTop, time: event.timeStamp });
            resolve(event.timeStamp);
          },
          { once: true },
        );
      });
      element.scrollTo({ top, behavior: 'instant' });
      return scrolled;
    };
    const after = (time: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, time - performance.now())));
    let deliveredFling = false;
    for (let attempt = 0; attempt < 5 && !deliveredFling; attempt++) {
      samples.length = 0;
      // Leave the positioning jump out of the fling and pace the rest by delivered events.
      await after((await step(start)) + 100);
      for (let y = start - 40; y >= 0; y -= 40) {
        const scrolledAt = await step(y);
        if (y > 0) await after(scrolledAt + 25);
      }
      const [approach, beforeEdge, edge] = samples.slice(-3);
      if (approach && beforeEdge && edge) {
        const runUp = beforeEdge.time - approach.time;
        // Slow frames can leave fewer than two pre-edge samples in the 100 ms history,
        // and an 80 ms gap starts a new scroll. Repeat only if the input missed that window.
        deliveredFling =
          beforeEdge.top > 0 &&
          edge.top === 0 &&
          runUp >= 20 &&
          runUp < 80 &&
          edge.time - beforeEdge.time < 80 &&
          edge.time - approach.time <= 100;
      }
    }
    if (!deliveredFling)
      throw new Error(`No fling reached the edge in time: ${JSON.stringify(samples)}`);
    // A fixed element whose containing block is the viewport has no offset parent; under a
    // transformed or filtered ancestor it would have one, and ride along with the bounce. The
    // drawer's own place moves with the page's scroll (it sinks and rises), so it is not compared.
    const carried = () => {
      const drawer = document.querySelector('[data-drawer]') as HTMLElement | null;
      return drawer !== null && drawer.offsetParent !== null;
    };
    let furthest = 0;
    let dockMoved = false;
    for (let index = 0; index < 40; index++) {
      if (scroller) {
        for (const child of scroller.children) {
          for (const animation of child.getAnimations()) {
            const effect = animation.effect as KeyframeEffect | null;
            if (effect?.composite === 'add') furthest = Math.max(furthest, 1);
          }
        }
      } else {
        furthest = Math.max(furthest, Number.parseFloat(column?.style.top || '0'));
      }
      if (carried()) dockMoved = true;
      await frame();
    }
    return { furthest, dockMoved, samples };
  }, start);
}

/** Whether every bounce has come back to its edge. */
function settled(page: Page) {
  return page.evaluate(
    () =>
      Number.parseFloat(
        (document.querySelector('[data-page-column]') as HTMLElement).style.top || '0',
      ) === 0 &&
      document
        .getAnimations()
        .every((animation) => (animation.effect as KeyframeEffect | null)?.composite !== 'add'),
  );
}

test('a fling into the top of a scrolled page bounces it by top, leaving fixed chrome', async ({
  page,
}) => {
  await signUp(page);
  // Short enough that the general settings page scrolls.
  await page.setViewportSize({ width: page.viewportSize()?.width ?? 400, height: 360 });
  await page.goto('/settings/general');
  await expect(page.locator('[data-page-header]')).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  const { furthest, dockMoved, samples } = await flingToTop(page.locator('html'));
  expect(furthest, `Scroll samples: ${JSON.stringify(samples)}`).toBeGreaterThan(4);
  expect(furthest).toBeLessThanOrEqual(36);
  await expect.poll(() => settled(page)).toBe(true);
  expect(dockMoved).toBe(false);
  // `top`, not a transform: the page's fixed docks keep the viewport as their containing block.
  expect(
    await page.locator('[data-page-column]').evaluate((element) => {
      return getComputedStyle(element).transform;
    }),
  ).toBe('none');
});

test('a fling into the top of a board column bounces its cards', async ({ page }) => {
  const board = await fixture(page);
  for (let index = 0; index < 24; index++)
    await board.add(`Filler ${index}`, 'Build', 3, `b${String(index).padStart(2, '0')}`);
  const build = page.getByRole('region', { name: 'Build', exact: true });
  await expect(build.getByRole('article')).toHaveCount(28);
  const viewport = build.locator('[data-slot="scroll-area-viewport"]');
  const { furthest, samples } = await flingToTop(viewport);
  expect(furthest, `Scroll samples: ${JSON.stringify(samples)}`).toBe(1);
  await expect.poll(() => settled(page)).toBe(true);
  // Android's own overscroll stretch would play on top of the bounce.
  expect(await viewport.evaluate((element) => getComputedStyle(element).overscrollBehaviorY)).toBe(
    'none',
  );
});

test('stays still with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signUp(page);
  await page.setViewportSize({ width: page.viewportSize()?.width ?? 400, height: 360 });
  await page.goto('/settings/general');
  await expect(page.locator('[data-page-header]')).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  const { furthest } = await flingToTop(page.locator('html'));
  expect(furthest).toBe(0);
});
