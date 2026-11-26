import { expect, type Page, test } from '@playwright/test';
import { card, carry, fixture, settled, taskRow, workspaceFixture } from './board-helpers';

/** An unfolded foldable's inner screen, held in landscape: a desktop, but a narrow one. */
const FOLDABLE = { width: 884, height: 800 };

const compactBoard = (page: Page) => page.locator('[data-compact-board]');
const views = (page: Page) => page.getByRole('tablist', { name: 'Board view' });
const rail = (page: Page, name: 'Backlog' | 'Closed') =>
  page.getByRole('complementary', { name, exact: true });
const flow = (page: Page) => page.getByRole('navigation', { name: 'Columns' });
const dock = (page: Page) => page.locator('[data-compact-dock]');

test.describe('the board beside a task on a narrow desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'A phone has no split view');

  test('takes a phone’s layout beside the task and hands its place back as the task closes', async ({
    page,
  }) => {
    await page.setViewportSize(FOLDABLE);
    await fixture(page);
    // With no task open there is room for the rails and columns.
    await expect(rail(page, 'Backlog')).toBeVisible();
    await expect(compactBoard(page)).toHaveCount(0);

    await card(page, 'Earlier position').click();
    await expect(page.getByRole('separator', { name: 'Resize task' })).toBeVisible();
    await expect(compactBoard(page)).toBeVisible();
    await expect(rail(page, 'Backlog')).toHaveCount(0);
    await expect(rail(page, 'Closed')).toHaveCount(0);
    await expect(views(page).getByRole('tab', { name: /Board/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // The switch is a dock along the half's foot.
    const frame = (await compactBoard(page).boundingBox())!;
    const bar = (await dock(page).boundingBox())!;
    expect(bar.y + bar.height).toBeGreaterThan(frame.y + frame.height - 48);
    // One column across the whole half, the next a page away.
    const build = compactBoard(page).getByRole('region', { name: 'Build', exact: true });
    await expect(build).toBeInViewport();
    const half = (await compactBoard(page).boundingBox())!;
    const column = (await settled(build)).boundingBox();
    expect((await column)!.width).toBeGreaterThan(half.width - 40);
    await expect(
      compactBoard(page).getByRole('region', { name: 'Review', exact: true }),
    ).not.toBeInViewport();

    await flow(page).getByRole('button', { name: 'Review', exact: true }).click();
    await expect(card(page, 'Review this')).toBeInViewport();
    // The turn has landed.
    await expect(flow(page).getByRole('button', { name: 'Review', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // The backlog and closed tasks are views of the same half.
    await views(page)
      .getByRole('tab', { name: /Backlog/ })
      .click();
    await expect(card(page, 'Idea for later')).toBeVisible();
    await expect(card(page, 'Review this')).toBeHidden();
    const idea = (await (await settled(card(page, 'Idea for later'))).boundingBox())!;
    await views(page)
      .getByRole('tab', { name: /Closed/ })
      .click();
    await expect(card(page, 'Finished')).toBeVisible();
    await views(page).getByRole('tab', { name: /Board/ }).click();
    await expect(card(page, 'Review this')).toBeInViewport();
    // Shown again, the backlog's cards are where they were, not laid out afresh.
    await views(page)
      .getByRole('tab', { name: /Backlog/ })
      .click();
    expect(await card(page, 'Idea for later').boundingBox()).toEqual(idea);
    await page.waitForTimeout(300);
    expect(await card(page, 'Idea for later').boundingBox()).toEqual(idea);
    await views(page).getByRole('tab', { name: /Board/ }).click();
    await expect(card(page, 'Review this')).toBeInViewport();

    // The task closes, and the full board comes back on the column the compact one was on.
    await page.getByRole('button', { name: 'Back to the board', exact: true }).click();
    await expect(compactBoard(page)).toHaveCount(0);
    await expect(rail(page, 'Backlog')).toBeVisible();
    await expect(card(page, 'Review this')).toBeInViewport();
  });

  test('keeps the full layout while there is room, and changes once the split handle takes it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await fixture(page);
    await card(page, 'Earlier position').click();
    const handle = page.getByRole('separator', { name: 'Resize task' });
    await expect(handle).toBeVisible();
    await expect(rail(page, 'Backlog')).toBeVisible();
    await expect(compactBoard(page)).toHaveCount(0);

    // Widening the task leaves the board too narrow for its rails.
    await handle.focus();
    for (let step = 0; step < 4; step++) await page.keyboard.press('ArrowLeft');
    await expect(compactBoard(page)).toBeVisible();
    await expect(card(page, 'Earlier position')).toBeInViewport();
    // The task stays open throughout.
    await expect(page.getByRole('region', { name: 'Task', exact: true })).toBeVisible();

    // Narrowing it back gives the board its rails again.
    // Past where it began: once compact, the board waits for clear room to change back.
    for (let step = 0; step < 6; step++) await page.keyboard.press('ArrowRight');
    await expect(compactBoard(page)).toHaveCount(0);
    await expect(rail(page, 'Backlog')).toBeVisible();
  });

  test('sends a held card to another view’s status, or opens the columns to place it', async ({
    page,
  }) => {
    await page.setViewportSize(FOLDABLE);
    const board = await fixture(page);
    await card(page, 'Earlier position').click();
    await expect(compactBoard(page)).toBeVisible();

    // A column's card dropped on a closed status finishes it.
    const targets = compactBoard(page).locator('[data-drop-status]');
    await carry(page, card(page, 'Low priority'), [
      { x: 300, y: 300 },
      compactBoard(page).locator('[data-drop-status]').filter({ hasText: /^Done/ }),
    ]);
    await expect(targets).toHaveCount(0);
    await expect
      .poll(async () => (await taskRow(page, board.headers, board.ids['Low priority']!))?.status_id)
      .toBe(board.status('Done'));

    // A backlog card held on the board's target opens the columns, and is placed in one.
    await views(page)
      .getByRole('tab', { name: /Backlog/ })
      .click();
    await carry(
      page,
      card(page, 'Idea for later'),
      [{ x: 300, y: 400 }, compactBoard(page).locator('[data-drop-expand]')],
      { drop: false, pause: 700 },
    );
    // The dock holds the targets while the card is held; the columns are behind it.
    await expect(compactBoard(page).locator('[data-view="board"]')).toBeVisible();
    await expect(compactBoard(page).locator('[data-view="backlog"]')).toBeHidden();
    const later = await settled(card(page, 'Later position'));
    const box = (await later.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 10, { steps: 12 });
    await page.waitForTimeout(200);
    await page.mouse.up();
    await expect
      .poll(
        async () => (await taskRow(page, board.headers, board.ids['Idea for later']!))?.status_id,
      )
      .toBe(board.status('Build'));
    // The task stays open.
    await expect(page.getByRole('region', { name: 'Task', exact: true })).toBeVisible();
  });

  test('its dock slides away as a list scrolls down, and back as it scrolls up', async ({
    page,
  }) => {
    await page.setViewportSize({ ...FOLDABLE, height: 560 });
    const board = await fixture(page);
    for (let index = 0; index < 8; index++)
      await board.add(`More work ${index + 1}`, 'Build', 3, `b${index}`);
    await card(page, 'Earlier position').click();
    await expect(compactBoard(page)).toBeVisible();
    await expect(card(page, 'More work 8')).toBeAttached();
    await expect(dock(page)).toBeInViewport();

    const build = compactBoard(page).getByRole('region', { name: 'Build', exact: true });
    const box = (await build.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 400);
    await expect(dock(page)).toHaveAttribute('data-away', '');
    await expect(dock(page)).not.toBeInViewport();
    await page.mouse.wheel(0, 4000);
    await page.mouse.wheel(0, -60);
    await expect(dock(page)).not.toHaveAttribute('data-away');
    await expect(dock(page)).toBeInViewport();
    // Near the list's end, its last card stays clear of the dock.
    const last = (await (await settled(card(page, 'More work 8'))).boundingBox())!;
    const shown = (await (await settled(dock(page))).boundingBox())!;
    expect(last.y + last.height).toBeLessThan(shown.y);

    // Turning to another column brings the dock back too.
    await page.mouse.wheel(0, 400);
    await expect(dock(page)).toHaveAttribute('data-away', '');
    await flow(page).getByRole('button', { name: 'Review', exact: true }).click();
    await expect(dock(page)).not.toHaveAttribute('data-away');
  });

  test('opens a task made from its create button beside it, without starting over', async ({
    page,
  }) => {
    await page.setViewportSize(FOLDABLE);
    await fixture(page);
    await card(page, 'Review this').click();
    await expect(compactBoard(page)).toBeVisible();
    await page.waitForTimeout(600);
    // The create button floats beside the dock, not in it, and makes a task in the column on
    // screen: the opened task's own.
    const create = page.getByRole('button', { name: 'New task in Review', exact: true });
    await expect(create).toBeVisible();
    await expect(dock(page).locator('.glass-thick').getByRole('button')).toHaveCount(0);
    await compactBoard(page).evaluate((frame) => {
      (frame as HTMLElement & { kept?: boolean }).kept = true;
    });
    await create.click();
    await expect(page.getByRole('region', { name: 'Task', exact: true })).toContainText(
      /BRD-\d+|Pending/,
    );
    await expect(card(page, 'New task')).toBeVisible();
    // The same board, still at full strength: it never took the full layout in between.
    expect(
      await compactBoard(page).evaluate((frame) => ({
        kept: (frame as HTMLElement & { kept?: boolean }).kept,
        opacity: getComputedStyle(frame).opacity,
      })),
    ).toEqual({ kept: true, opacity: '1' });
  });

  test('carries the cards into the half at its resting width, on the tapped card’s view and column', async ({
    page,
  }) => {
    await page.setViewportSize(FOLDABLE);
    await fixture(page);
    type Frame = {
      width: number | null;
      layout: number | null;
      morphing: boolean;
      card: { x: number; y: number } | null;
      ghost: number;
      surface: number | null;
    };
    const sampleFrames = () =>
      page.evaluate(() => {
        const frames: Frame[] = [];
        (window as unknown as { frames_: Frame[] }).frames_ = frames;
        // Where the tapped card is drawn: its copy while one carries it, or the card itself.
        const drawn = () => {
          const layer = document.querySelector('[data-layout-morph]');
          const copies = [...(layer?.children ?? [])]
            .filter((holder) => holder.textContent?.includes('Review this'))
            .map((holder) => holder.getBoundingClientRect())
            .sort((a, b) => a.width * a.height - b.width * b.height);
          const card = [...document.querySelectorAll<HTMLElement>('[data-card-id]')].find(
            (element) =>
              element.textContent?.includes('Review this') &&
              !element.closest('[data-layout-morph]'),
          );
          const box =
            copies[0] ??
            (card && card.closest<HTMLElement>('[data-rearrange-card]')?.style.opacity !== '0'
              ? card.getBoundingClientRect()
              : null);
          return box ? { x: box.x, y: box.y } : null;
        };
        // How much of the card itself shows while its copy carries it: none, or the two draw
        // over each other.
        const ghost = () => {
          const layer = document.querySelector('[data-layout-morph]');
          if (
            ![...(layer?.children ?? [])].some((holder) =>
              holder.textContent?.includes('Review this'),
            )
          )
            return 0;
          const card = [...document.querySelectorAll<HTMLElement>('[data-card-id]')].find(
            (element) =>
              element.textContent?.includes('Review this') &&
              !element.closest('[data-layout-morph]'),
          );
          let opacity = 1;
          for (let node: HTMLElement | null = card ?? null; node; node = node.parentElement)
            opacity *= Number(getComputedStyle(node).opacity);
          return card ? opacity : 0;
        };
        // The tallest column surface left behind in the layer: the columns stand there as they
        // fade, rather than collapsing.
        const surface = () => {
          const sections = document.querySelectorAll('[data-layout-morph] section');
          return sections.length
            ? Math.max(...[...sections].map((section) => section.getBoundingClientRect().height))
            : null;
        };
        const sample = () => {
          const board = document.querySelector('[data-compact-board]');
          const layout = board ? null : document.querySelector('[data-board-layout]');
          frames.push({
            width: board ? board.getBoundingClientRect().width : null,
            layout: layout ? layout.getBoundingClientRect().width : null,
            morphing: document.querySelector('[data-layout-morph]') !== null,
            card: drawn(),
            ghost: ghost(),
            surface: surface(),
          });
          if (frames.length < 90) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
    // The card is carried the whole way: drawn in every frame, never jumping most of the way.
    const travels = (frames: Frame[]) => {
      const path = frames.map((frame) => frame.card);
      expect(path.every((point) => point !== null)).toBe(true);
      const steps = path
        .slice(1)
        .map((point, index) => Math.hypot(point!.x - path[index]!.x, point!.y - path[index]!.y));
      const start = path[0]!;
      const end = path[path.length - 1]!;
      const distance = Math.hypot(end.x - start.x, end.y - start.y);
      expect(distance).toBeGreaterThan(100);
      // A frame held up by laying the new board out still leaves most of the way to travel.
      expect(Math.max(...steps)).toBeLessThan(distance * 0.4);
      expect(steps.filter((step) => step > 2).length).toBeGreaterThanOrEqual(4);
      // Only its copy is drawn while it flies.
      expect(Math.max(...frames.map((frame) => frame.ghost))).toBeLessThan(0.01);
    };
    const collected = async () => {
      await page.waitForFunction(
        () => (window as unknown as { frames_: unknown[] }).frames_.length >= 90,
      );
      return page.evaluate(() => (window as unknown as { frames_: Frame[] }).frames_);
    };

    await sampleFrames();
    await card(page, 'Review this').click();
    await expect(compactBoard(page)).toBeVisible();
    const frames = await collected();
    const compact = frames.filter((frame) => frame.width !== null);
    expect(compact.length).toBeGreaterThan(0);
    // The cards are carried across from the first frame the new layout is drawn in.
    expect(compact[0]!.morphing).toBe(true);
    // The columns left behind keep their height as they fade.
    expect(compact[0]!.surface).toBeGreaterThan(200);
    await expect(page.locator('[data-layout-morph]')).toHaveCount(0);
    travels(frames);
    // Laid out once, at the width it rests at, while the pane slides in beside it.
    const widths = compact.map((frame) => frame.width!);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
    // Its resting width is the half's.
    const half = await compactBoard(page).evaluate((frame) => ({
      frame: frame.getBoundingClientRect().width,
      row: frame.parentElement!.getBoundingClientRect().width,
    }));
    expect(Math.abs(half.frame - half.row)).toBeLessThan(1);
    // It opens on the tapped card's column.
    await expect(card(page, 'Review this')).toBeInViewport();

    // Closing carries it back into its column, laid out once at the width it rests at as the
    // pane slides shut.
    await sampleFrames();
    await page.getByRole('button', { name: 'Back to the board', exact: true }).click();
    await expect(compactBoard(page)).toHaveCount(0);
    const back = await collected();
    const full = back.filter((frame) => frame.layout !== null);
    expect(full[0]!.morphing).toBe(true);
    travels(back);
    const layouts = full.map((frame) => frame.layout!);
    expect(Math.max(...layouts) - Math.min(...layouts)).toBeLessThan(1);
    await expect(page.locator('[data-layout-morph]')).toHaveCount(0);

    // A backlog card opens it on the backlog.
    await page.getByRole('button', { name: /^Open backlog,/ }).click();
    await card(page, 'Idea for later').click();
    await expect(views(page).getByRole('tab', { name: /Backlog/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(card(page, 'Idea for later')).toBeInViewport();
  });

  test('the cross-project board pages through its categories beside a task', async ({ page }) => {
    await page.setViewportSize(FOLDABLE);
    await workspaceFixture(page);
    await card(page, 'Prune roses').click();
    await expect(compactBoard(page)).toBeVisible();
    // It opens on the work in progress.
    await expect(card(page, 'Water tomatoes')).toBeInViewport();
    await expect(card(page, 'Pick apples')).not.toBeInViewport();
    await flow(page).getByRole('button', { name: 'Done', exact: true }).click();
    await expect(card(page, 'Pick apples')).toBeInViewport();
    await page.getByRole('button', { name: 'Back to the board', exact: true }).click();
    await expect(compactBoard(page)).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Active', exact: true })).toBeVisible();
  });
});
