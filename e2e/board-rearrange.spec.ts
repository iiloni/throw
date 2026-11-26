import { expect, type Page, test } from '@playwright/test';
import { cardIds, fixture } from './board-helpers';

/**
 * Records, frame by frame, what the board's rearrangement motion does: the places it shifts
 * back and springs home, the cards it keeps clear for a flight, and the copies it draws.
 */
async function watchRearrangement(page: Page) {
  await page.evaluate(() => {
    const record = { shifted: [] as string[], clipped: [] as string[], copies: 0 };
    Object.assign(window, { rearrangement: record });
    const tick = () => {
      for (const element of document.querySelectorAll<HTMLElement>('[data-rearrange]')) {
        const key = element.dataset.rearrange ?? '';
        if (element.style.translate && !record.shifted.includes(key)) record.shifted.push(key);
        if (element.style.clipPath && !record.clipped.includes(key)) record.clipped.push(key);
      }
      record.copies = Math.max(
        record.copies,
        document.querySelectorAll('[data-rearrange-copy]').length,
      );
      requestAnimationFrame(tick);
    };
    tick();
  });
  return () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            rearrangement: { shifted: string[]; clipped: string[]; copies: number };
          }
        ).rearrangement,
    );
}

/** Nothing is left shifted, clipped or copied once the motion is over. */
async function expectSettled(page: Page) {
  await expect(page.locator('[data-rearrange-copy]')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          [...document.querySelectorAll<HTMLElement>('[data-rearrange]')].filter(
            (element) => element.style.translate || element.style.clipPath || element.style.zIndex,
          ).length,
      ),
    )
    .toBe(0);
}

async function act(page: Page, action: 'priority' | 'status', id: string, value: string | number) {
  await page.evaluate(
    async ({ action, id, value }) => {
      const tasks = await import('/src/lib/tasks.ts');
      if (action === 'priority') tasks.updateTask(id, { priority: value as 1 });
      else tasks.sendTask(id, value as string);
    },
    { action, id, value },
  );
}

test('a priority set outside a drag springs the card and its neighbours to their new places', async ({
  page,
}) => {
  const { ids } = await fixture(page);
  const before = await cardIds(page, 'Build');
  const read = await watchRearrangement(page);
  // From the foot of the column to the empty second priority, above the two default ones.
  await act(page, 'priority', ids['Low priority']!, 2);
  await expect.poll(() => cardIds(page, 'Build')).not.toEqual(before);
  expect((await cardIds(page, 'Build'))[1]).toBe(ids['Low priority']);
  await expect
    .poll(async () => (await read()).shifted)
    .toEqual(
      expect.arrayContaining([ids['Low priority'], ids['Earlier position'], ids['Later position']]),
    );
  expect((await read()).shifted).not.toContain(ids['Board parent']);
  expect((await read()).copies).toBe(0);
  await expectSettled(page);
});

test('a status set outside a drag carries the card out of its column while both make way', async ({
  page,
  isMobile,
}) => {
  const { ids, status } = await fixture(page);
  const read = await watchRearrangement(page);
  await act(page, 'status', ids['Earlier position']!, status('Review'));
  await expect
    .poll(() => cardIds(page, 'Review'))
    .toEqual(expect.arrayContaining([ids['Earlier position']]));
  // Build's cards below it close up behind it.
  await expect
    .poll(async () => (await read()).shifted)
    .toEqual(expect.arrayContaining([ids['Later position']]));
  const record = await read();
  expect(record.copies).toBe(1);
  if (isMobile) {
    // A phone shows one column: the card goes from Build, and Review is out of sight.
    expect(record.clipped).toEqual([]);
  } else {
    // Both columns are on screen: the card flies across, its new place clear until it lands,
    // and Review makes room for it.
    expect(record.clipped).toEqual([ids['Earlier position']]);
    expect(record.shifted).toEqual(expect.arrayContaining([`add:status:${status('Review')}`]));
  }
  await expectSettled(page);
  const moved = page
    .getByRole('region', { name: 'Review', exact: true })
    .getByRole('article', { name: /Earlier position$/ });
  // On a phone it waits on Review's page, out of sight.
  await (isMobile ? expect(moved).toBeAttached() : expect(moved).toBeInViewport());
});

test('a status set from the task pane carries the card to its new column', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'A phone task covers the board; the action test above covers the phone.');
  await fixture(page);
  await page.getByRole('article', { name: /Low priority$/ }).click();
  const controls = page.getByRole('toolbar', { name: 'Task controls', exact: true });
  await expect(controls).toBeVisible();
  const read = await watchRearrangement(page);
  await controls.getByRole('button', { name: /^Status: Build\. Change$/ }).click();
  await page.getByRole('radio', { name: 'Review', exact: true }).click();
  await expect.poll(async () => (await read()).copies).toBe(1);
  await expectSettled(page);
  await expect(
    page
      .getByRole('region', { name: 'Review', exact: true })
      .getByRole('article', { name: /Low priority$/ }),
  ).toBeVisible();
});

test('reduced motion moves cards in place at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { ids, status } = await fixture(page);
  const read = await watchRearrangement(page);
  await act(page, 'priority', ids['Low priority']!, 2);
  await act(page, 'status', ids['Earlier position']!, status('Review'));
  await expect
    .poll(() => cardIds(page, 'Review'))
    .toEqual(expect.arrayContaining([ids['Earlier position']]));
  await expect.poll(async () => (await cardIds(page, 'Build'))[1]).toBe(ids['Low priority']);
  expect(await read()).toEqual({ shifted: [], clipped: [], copies: 0 });
});
