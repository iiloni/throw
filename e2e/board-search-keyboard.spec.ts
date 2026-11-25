import { expect, type Page, test } from '@playwright/test';
import { fixture } from './board-helpers';

const bar = (page: Page) => page.getByRole('search', { name: 'Search the board', exact: true });
const field = (page: Page) => page.getByRole('searchbox', { name: 'Search tasks', exact: true });

/**
 * A soft keyboard that overlays the page, as Android's and Chromium's VirtualKeyboard do: the
 * window keeps its height and `useKeyboardTracking` reports the keyboard as `--keyboard`.
 */
async function keyboard(page: Page, height: number) {
  await page.evaluate((px) => {
    document.documentElement.style.setProperty('--keyboard', `${px}px`);
  }, height);
}

const KEYBOARD = 320;

/** Waits for the bar's entry spring to settle, then reads where its parts were painted. */
async function boxes(page: Page) {
  await page.waitForFunction(() => {
    const search = document.querySelector('search[aria-label="Search the board"]');
    const float = search?.parentElement;
    const opacity = float ? Number(getComputedStyle(float).opacity) : 1;
    return !!search && opacity === 1;
  });
  return page.evaluate(
    () =>
      new Promise<{ field: DOMRect; space: string; viewport: number }>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const input = document.querySelector('[data-board-search-input]');
            const glass = input?.closest('.glass') ?? input;
            resolve({
              field: glass?.getBoundingClientRect().toJSON() as DOMRect,
              space: document.documentElement.style.getPropertyValue('--board-search-space'),
              viewport: window.innerHeight,
            });
          }),
        ),
      ),
  );
}

test.describe('board search over a soft keyboard', () => {
  test.skip(({ isMobile }) => isMobile, 'The phone searches from its drawer');

  test('the floating bar and its filter panel rise above the keyboard on a tablet', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await fixture(page, true);
    await page.keyboard.press('ControlOrMeta+k');
    await expect(field(page)).toBeFocused();
    await expect(bar(page)).not.toHaveAttribute('data-docked');

    const rest = await boxes(page);
    expect(rest.viewport - rest.field.bottom).toBeCloseTo(20, 0);

    await keyboard(page, KEYBOARD);
    const lifted = await boxes(page);
    // Snug above the keyboard, as the drawer's dock is.
    expect(lifted.viewport - KEYBOARD - lifted.field.bottom).toBeCloseTo(12, 0);
    // The lift is a translate, so the columns' end room keeps the bar's height.
    expect(lifted.space).toBe(rest.space);

    await bar(page).getByRole('button', { name: 'Filter and sort', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Filters and sort' });
    await expect(panel).toBeVisible();
    await page
      .getByRole('tablist', { name: 'Filter type' })
      .getByRole('tab', { name: 'Sort' })
      .click();
    // The panel keeps the field's focus, and so the keyboard, and fits below the top edge.
    await expect(field(page)).toBeFocused();
    await expect.poll(async () => (await panel.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(0);

    await keyboard(page, 0);
    const back = await boxes(page);
    expect(back.field.bottom).toBeCloseTo(rest.field.bottom, 0);
  });

  test('the docked sidebar ends its field above the keyboard on a wide tablet', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1700, height: 900 });
    await fixture(page, true);
    await page.keyboard.press('ControlOrMeta+k');
    await expect(field(page)).toBeFocused();
    await expect(bar(page)).toHaveAttribute('data-docked', '');

    const rest = await boxes(page);
    expect(rest.viewport - rest.field.bottom).toBeCloseTo(24, 0);

    await keyboard(page, KEYBOARD);
    const lifted = await boxes(page);
    expect(lifted.viewport - KEYBOARD - lifted.field.bottom).toBeCloseTo(12, 0);
    // The inline filters give up the room and stay above the field.
    const sort = bar(page).getByRole('region', { name: 'Sort', exact: true });
    expect((await sort.boundingBox())?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(
      lifted.field.top,
    );

    await keyboard(page, 0);
    const back = await boxes(page);
    expect(back.field.bottom).toBeCloseTo(rest.field.bottom, 0);
  });
});
