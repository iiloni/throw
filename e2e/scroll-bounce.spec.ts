import { expect, type Page, test } from '@playwright/test';
import { fixture } from './board-helpers';
import { APP_LOAD_TIMEOUT, signUp } from './helpers';

/**
 * Flings `target` (the page, or a scroller) from `from` to its top over painted frames, as a
 * fast wheel or a touch's momentum does, and reports what moved in the frames after.
 */
async function flingToTop(page: Page, target: 'page' | 'column') {
  return page.evaluate(async (which) => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const column = document.querySelector('[data-page-column]') as HTMLElement | null;
    let scroller: HTMLElement | null = null;
    if (which === 'column') {
      const card = [...document.querySelectorAll('[data-card-id]')].find((element) =>
        element.textContent?.includes('Filler 0'),
      );
      for (let parent = card?.parentElement; parent; parent = parent.parentElement) {
        if (
          /(auto|scroll)/.test(getComputedStyle(parent).overflowY) &&
          parent.scrollHeight > parent.clientHeight + 100
        ) {
          scroller = parent;
          break;
        }
      }
      if (!scroller) throw new Error('No scrolling column');
    }
    const set = (y: number) => {
      if (scroller) scroller.scrollTop = y;
      else window.scrollTo(0, y);
    };
    set(240);
    // A pause, so the fling starts as a scroll of its own.
    await new Promise((resolve) => setTimeout(resolve, 200));
    for (const y of [200, 160, 120, 80, 40, 0]) {
      set(y);
      await frame();
    }
    const dock = document.querySelector('[data-drawer]')?.getBoundingClientRect().top ?? null;
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
      const now = document.querySelector('[data-drawer]')?.getBoundingClientRect().top ?? null;
      if (dock !== null && now !== null && Math.abs(now - dock) > 0.5) dockMoved = true;
      await frame();
    }
    return { furthest, dockMoved };
  }, target);
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
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight > 260),
    )
    .toBe(true);
  const { furthest, dockMoved } = await flingToTop(page, 'page');
  expect(furthest).toBeGreaterThan(4);
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
  await expect(page.getByRole('article', { name: /Filler 23$/ })).toBeAttached();
  const { furthest } = await flingToTop(page, 'column');
  expect(furthest).toBe(1);
  await expect.poll(() => settled(page)).toBe(true);
  // Android's own overscroll stretch would play on top of the bounce.
  const viewport = page
    .getByRole('article', { name: /Filler 0$/ })
    .locator('xpath=ancestor::*[@data-slot="scroll-area-viewport"][1]');
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
  const { furthest } = await flingToTop(page, 'page');
  expect(furthest).toBe(0);
});
