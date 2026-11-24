import { expect, type Page, test } from '@playwright/test';
import {
  card,
  cardIds,
  carry,
  centre,
  finger,
  fixture,
  settled,
  taskRow,
  workspaceFixture,
} from './board-helpers';
import { newTag, taggedTask } from './tag-helpers';

const bar = (page: Page) => page.getByRole('search', { name: 'Search the board', exact: true });
const field = (page: Page) => page.getByRole('searchbox', { name: 'Search tasks', exact: true });
const filters = (page: Page) => page.getByRole('region', { name: 'Filters and sort' });
/** The filter card shows one section at a time, chosen from the tabs at its foot. */
const section = (page: Page, name: 'Tags' | 'Projects' | 'Size' | 'Sort') =>
  page
    .getByRole('tablist', { name: 'Filter type' })
    .getByRole('tab', { name, exact: true })
    .click();
// The bar's chips on a desktop, the board header's on a phone; not the search page's.
const chips = (page: Page) =>
  page
    .locator('header, [aria-label="Search the board"]')
    .getByRole('group', { name: 'Active filters' });

/**
 * A board whose Build column has sizes and tags Home > Garden and Work: Board parent (High,
 * unsized, untagged), Earlier position (S, Garden), Later position (L, Home and Work) and Low
 * priority (XL, Work). Review holds Review this.
 */
async function sizedBoard(page: Page) {
  const board = await fixture(page, true);
  const home = await newTag(page.request, board, board.projectId, { name: 'Home', color: 'teal' });
  const garden = await newTag(page.request, board, board.projectId, {
    name: 'Garden',
    parentId: home.id,
  });
  const work = await newTag(page.request, board, board.projectId, { name: 'Work', color: 'blue' });
  const ids: Record<string, string> = {};
  const seeds: [string, string, number, string, Record<string, unknown>][] = [
    ['Board parent', 'Build', 1, 'a0', {}],
    ['Earlier position', 'Build', 3, 'a0', { size: 2, primaryTagId: garden.id }],
    [
      'Later position',
      'Build',
      3,
      'a1',
      { size: 4, primaryTagId: home.id, secondaryTagIds: [work.id] },
    ],
    ['Low priority', 'Build', 5, 'a0', { size: 5, primaryTagId: work.id }],
    ['Review this', 'Review', 2, 'a0', {}],
  ];
  for (const [title, status, priority, position, fields] of seeds) {
    const task = await taggedTask(page.request, board, board.projectId, {
      title,
      statusId: board.status(status),
      priority,
      position,
      ...fields,
    });
    ids[title] = task.id;
  }
  await expect(
    page.getByRole('region', { name: 'Build', exact: true }).getByRole('article'),
  ).toHaveCount(4);
  return { ...board, ids };
}

async function openBar(page: Page) {
  await page.keyboard.press('ControlOrMeta+k');
  await expect(field(page)).toBeFocused();
}

async function openFilters(page: Page) {
  await bar(page).getByRole('button', { name: 'Filter and sort', exact: true }).click();
  await expect(filters(page)).toBeVisible();
}

test.describe('desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'The phone filters from its drawer');

  test('the bar narrows the live board as you type, without covering it, and steps back on Escape', async ({
    page,
  }) => {
    const board = await fixture(page);
    await openBar(page);
    // Not a dialog: the board stays usable around the bar.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await field(page).fill('position');
    await expect
      .poll(() => cardIds(page, 'Build'))
      .toEqual([board.ids['Earlier position'], board.ids['Later position']]);
    await expect(page.getByRole('region', { name: 'Review', exact: true })).toContainText(
      'Nothing matches here.',
    );
    await expect(bar(page)).toContainText('2 matching');
    // A card that matches opens beside the bar, which stays as it was.
    await card(page, 'Later position').click();
    await expect(page.getByRole('region', { name: 'Task', exact: true })).toBeVisible();
    await expect(field(page)).toHaveValue('position');
    // The bar sits beside the open task, never over it.
    const pane = (await page.getByRole('region', { name: 'Task', exact: true }).boundingBox())!;
    const box = (await bar(page).boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(pane.x);
    await page.getByRole('button', { name: 'Back to the board', exact: true }).click();
    // Enter opens the best match: an identifier goes straight to its task.
    await field(page).fill('BRD-4');
    await field(page).press('Enter');
    await expect(
      page
        .getByRole('region', { name: 'Task', exact: true })
        .getByRole('textbox', { name: 'Task title' }),
    ).toHaveValue('Low priority');
    await page.getByRole('button', { name: 'Back to the board', exact: true }).click();
    // A subtask that matches keeps its parent's card on the board.
    await field(page).fill('Subtask in progress');
    await expect.poll(() => cardIds(page, 'Build')).toEqual([board.ids['Board parent']]);
    // Escape clears the search first, then closes the bar.
    await field(page).press('Escape');
    await expect(field(page)).toHaveValue('');
    await expect(
      page.getByRole('region', { name: 'Build', exact: true }).getByRole('article'),
    ).toHaveCount(4);
    await field(page).press('Escape');
    await expect(bar(page)).toHaveCount(0);
    // The rail's Search opens it too, and Ctrl/⌘K from inside closes an empty one.
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(field(page)).toBeFocused();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(bar(page)).toHaveCount(0);
  });

  test('tags match all or any, with the tags beneath them, alongside sizes; chips remove them', async ({
    page,
  }) => {
    const board = await sizedBoard(page);
    await openBar(page);
    await openFilters(page);
    await filters(page).getByRole('checkbox', { name: 'Home / Garden', exact: true }).check();
    await filters(page).getByRole('checkbox', { name: 'Work', exact: true }).check();
    // Any: Garden or Work.
    await expect
      .poll(() => cardIds(page, 'Build'))
      .toEqual([
        board.ids['Earlier position'],
        board.ids['Later position'],
        board.ids['Low priority'],
      ]);
    await filters(page).getByRole('button', { name: 'All tags', exact: true }).click();
    // All: only a card carrying both. None in Build has Garden and Work.
    await expect.poll(() => cardIds(page, 'Build')).toEqual([]);
    await filters(page).getByRole('checkbox', { name: 'Home / Garden', exact: true }).uncheck();
    await filters(page).getByRole('checkbox', { name: 'Home', exact: true }).check();
    // Home covers Garden beneath it: all of Home and Work.
    await expect.poll(() => cardIds(page, 'Build')).toEqual([board.ids['Later position']]);
    await expect(chips(page)).toContainText('All of');
    await chips(page)
      .getByRole('button', { name: /^Remove Work/ })
      .click();
    await expect
      .poll(() => cardIds(page, 'Build'))
      .toEqual([board.ids['Earlier position'], board.ids['Later position']]);
    // Sizes: any of those chosen, alongside the tags.
    await section(page, 'Size');
    await filters(page)
      .getByRole('button', { name: /^Size S,/ })
      .click();
    await filters(page)
      .getByRole('button', { name: /^Size XL,/ })
      .click();
    await expect.poll(() => cardIds(page, 'Build')).toEqual([board.ids['Earlier position']]);
    await chips(page)
      .getByRole('button', { name: /^Remove Home/ })
      .click();
    await expect
      .poll(() => cardIds(page, 'Build'))
      .toEqual([board.ids['Earlier position'], board.ids['Low priority']]);
    await filters(page)
      .getByRole('button', { name: /^Unsized,/ })
      .click();
    await expect
      .poll(() => cardIds(page, 'Build'))
      .toEqual([
        board.ids['Board parent'],
        board.ids['Earlier position'],
        board.ids['Low priority'],
      ]);
    // A folded column counts what the filter leaves.
    await section(page, 'Tags');
    await filters(page)
      .getByRole('checkbox', { name: /^Untagged/ })
      .check();
    await expect.poll(() => cardIds(page, 'Build')).toEqual([board.ids['Board parent']]);
    // Working on the board puts the panel away, as in Catch.
    await page.getByRole('button', { name: 'Collapse Build column', exact: true }).click();
    await expect(filters(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Expand Build column', exact: true })).toHaveText(
      /1$/,
    );
    await page.getByRole('button', { name: 'Expand Build column', exact: true }).click();
    // Escape closes the panel before anything else, then Clear all brings everything back.
    await field(page).click();
    await openFilters(page);
    await page.keyboard.press('Escape');
    await expect(filters(page)).toHaveCount(0);
    await expect(field(page)).toHaveValue('');
    await chips(page).getByRole('button', { name: 'Clear all', exact: true }).click();
    await expect(chips(page)).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'Build', exact: true }).getByRole('article'),
    ).toHaveCount(4);
  });

  test('a temporary size sort reorders the columns, shows as a chip, moves cards across columns only, and ends on reload', async ({
    page,
  }) => {
    const board = await sizedBoard(page);
    await openBar(page);
    await openFilters(page);
    await section(page, 'Sort');
    await filters(page).getByRole('button', { name: 'Size', exact: true }).click();
    await filters(page).getByRole('button', { name: 'Largest', exact: true }).click();
    await expect
      .poll(() => cardIds(page, 'Build'))
      .toEqual([
        board.ids['Low priority'],
        board.ids['Later position'],
        board.ids['Earlier position'],
        board.ids['Board parent'],
      ]);
    await filters(page).getByRole('button', { name: 'Smallest', exact: true }).click();
    await expect
      .poll(() => cardIds(page, 'Build'))
      .toEqual([
        board.ids['Earlier position'],
        board.ids['Later position'],
        board.ids['Low priority'],
        board.ids['Board parent'],
      ]);
    await page.keyboard.press('Escape');
    await expect(chips(page)).toContainText('Smallest first');
    // While filtered and sorted, a card dropped in another column is sent there with its
    // priority; it takes its place by size.
    await field(page).fill('position');
    const review = page.getByRole('region', { name: 'Review', exact: true });
    await carry(page, card(page, 'Later position'), [review]);
    await expect
      .poll(async () => {
        const row = await taskRow(page, board.headers, board.ids['Later position']!);
        return [row?.status_id, row?.priority];
      })
      .toEqual([board.status('Review'), '3']);
    await expect(review.getByRole('article')).toHaveCount(1);
    await field(page).fill('');
    await expect
      .poll(() => cardIds(page, 'Review'))
      .toEqual([board.ids['Later position'], board.ids['Review this']]);
    // Within its own column a card has no place to take: dropping it there writes nothing.
    const before = await taskRow(page, board.headers, board.ids['Earlier position']!);
    const build = page.getByRole('region', { name: 'Build', exact: true });
    const below = await centre(card(page, 'Board parent'));
    await carry(page, card(page, 'Earlier position'), [{ x: below.x, y: below.y + 40 }]);
    await page.waitForTimeout(600);
    const after = await taskRow(page, board.headers, board.ids['Earlier position']!);
    expect([after?.status_id, after?.position]).toEqual([before?.status_id, before?.position]);
    await expect(build.getByRole('article').first()).toHaveAccessibleName(/Earlier position$/);
    // The sort is not kept: a reload is back to priority.
    await page.reload();
    await expect(page.getByRole('region', { name: 'Build', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(bar(page)).toHaveCount(0);
    await expect
      .poll(() => cardIds(page, 'Build'))
      .toEqual([
        board.ids['Board parent'],
        board.ids['Earlier position'],
        board.ids['Low priority'],
      ]);
  });

  test('a wide window docks search beside the backlog with full inline sort and filter controls', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const board = await sizedBoard(page);
    await openBar(page);
    const docked = bar(page);
    await expect(docked).toHaveAttribute('data-docked', '');
    // No popup filter trigger or tabbed filter card in the wide docked sidebar.
    await expect(docked.getByRole('button', { name: 'Filter and sort' })).toHaveCount(0);
    await expect(docked.getByRole('tablist', { name: 'Filter type' })).toHaveCount(0);
    // Left of the backlog, not over a column, with inline Sort, Size and Tags above the field.
    const sortSection = docked.getByRole('region', { name: 'Sort', exact: true });
    const sizeSection = docked.getByRole('region', { name: 'Size', exact: true });
    const tagsSection = docked.getByRole('region', { name: 'Tags', exact: true });
    await expect(sortSection).toBeVisible();
    await expect(sizeSection).toBeVisible();
    await expect(tagsSection).toBeVisible();
    // Measured once the sidebar has opened to its width.
    await expect
      .poll(async () => {
        const [search, backlog] = await Promise.all([
          docked.boundingBox(),
          page.getByRole('complementary', { name: 'Backlog' }).boundingBox(),
        ]);
        return search!.x + search!.width <= backlog!.x;
      })
      .toBe(true);
    const [tagsBox, input] = await Promise.all([
      tagsSection.boundingBox(),
      field(page).boundingBox(),
    ]);
    expect(input!.y).toBeGreaterThan(tagsBox!.y + tagsBox!.height);
    // Board parent and Review this have no tag.
    await expect(tagsSection.getByRole('button', { name: /^Untagged,/ })).toContainText('2');
    // Root and nested tags work inline, with Any/All matching once multiple tags are chosen.
    const garden = tagsSection.getByRole('button', { name: /^Home \/ Garden,/ });
    const work = tagsSection.getByRole('button', { name: /^Work,/ });
    await garden.click();
    await expect(garden).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => cardIds(page, 'Build')).toEqual([board.ids['Earlier position']]);
    await work.click();
    await expect
      .poll(() => cardIds(page, 'Build'))
      .toEqual([
        board.ids['Earlier position'],
        board.ids['Later position'],
        board.ids['Low priority'],
      ]);
    await tagsSection.getByRole('button', { name: 'All tags', exact: true }).click();
    await expect.poll(() => cardIds(page, 'Build')).toEqual([]);
    await garden.click();
    const home = tagsSection.getByRole('button', { name: /^Home,/ });
    await home.click();
    await expect.poll(() => cardIds(page, 'Build')).toEqual([board.ids['Later position']]);
    // Size and Sort controls live inline too, without opening any popup.
    await work.click();
    await expect
      .poll(() => cardIds(page, 'Build'))
      .toEqual([board.ids['Earlier position'], board.ids['Later position']]);
    await sortSection.getByRole('button', { name: 'Size', exact: true }).click();
    await sortSection.getByRole('button', { name: 'Largest', exact: true }).click();
    await expect
      .poll(() => cardIds(page, 'Build'))
      .toEqual([board.ids['Later position'], board.ids['Earlier position']]);
    await expect(chips(page)).toContainText('Largest first');
    await sizeSection.getByRole('button', { name: /^Size L,/ }).click();
    await expect.poll(() => cardIds(page, 'Build')).toEqual([board.ids['Later position']]);
    // The nav rail Search button connects visually to the open sidebar and collapses it without clearing filters.
    const railSearch = page.getByRole('button', { name: 'Search', exact: true });
    await expect(railSearch).toHaveAttribute('aria-expanded', 'true');
    await expect(railSearch).toHaveAttribute('data-connected', '');
    const [railBg, sidebarBg] = await Promise.all([
      railSearch.evaluate((el) => getComputedStyle(el).backgroundColor),
      docked.evaluate((el) => getComputedStyle(el).backgroundColor),
    ]);
    expect(railBg).toBe(sidebarBg);
    await railSearch.click();
    await expect(bar(page)).toHaveCount(0);
    await expect(railSearch).toHaveAttribute('aria-expanded', 'false');
    await expect(railSearch).not.toHaveAttribute('data-connected');
    await expect(railSearch).toHaveAccessibleDescription('Search (3 active filters)');
    await expect(railSearch.locator('[data-search-filter-badge]')).toHaveText('3');
    // Filters stay active while collapsed, and the collapsed nav rail shows a quiet dot + tooltip.
    await expect.poll(() => cardIds(page, 'Build')).toEqual([board.ids['Later position']]);
    await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
    await expect(railSearch.locator('[data-search-filter-dot]')).toBeVisible();
    await expect(railSearch).toHaveAccessibleDescription('Search (3 active filters)');
    await railSearch.hover();
    await expect(page.getByRole('tooltip')).toHaveText('Search (3 active filters)');
    await page.getByRole('button', { name: 'Expand navigation', exact: true }).click();
    await expect(railSearch.locator('[data-search-filter-badge]')).toHaveText('3');
    // Reopening from the rail restores the sidebar with active filters and focuses the input.
    await railSearch.click();
    await expect(docked).toBeVisible();
    await expect(field(page)).toBeFocused();
    await expect(chips(page)).toContainText('Largest first');
    await expect.poll(() => cardIds(page, 'Build')).toEqual([board.ids['Later position']]);
    // Ctrl/⌘K from inside the focused search input also collapses without clearing filters.
    await page.keyboard.press('ControlOrMeta+k');
    await expect(bar(page)).toHaveCount(0);
    await expect(railSearch).toHaveAccessibleDescription('Search (3 active filters)');
    await expect.poll(() => cardIds(page, 'Build')).toEqual([board.ids['Later position']]);
    await page.keyboard.press('ControlOrMeta+k');
    await expect(docked).toBeVisible();
    await expect(field(page)).toBeFocused();
    // Closing via the search field's close button clears filters and sort and drops the rail badge.
    await docked.getByRole('button', { name: 'Close search', exact: true }).click();
    await expect(bar(page)).toHaveCount(0);
    await expect(railSearch.locator('[data-search-filter-badge]')).toHaveCount(0);
    await expect(railSearch).not.toHaveAttribute('aria-describedby');
    await expect(
      page.getByRole('region', { name: 'Build', exact: true }).getByRole('article'),
    ).toHaveCount(4);
    // Reopen and verify Escape clears active filters first, then closes the sidebar.
    await openBar(page);
    await docked
      .getByRole('region', { name: 'Size', exact: true })
      .getByRole('button', { name: /^Size L,/ })
      .click();
    await expect.poll(() => cardIds(page, 'Build')).toEqual([board.ids['Later position']]);
    await page.keyboard.press('Escape');
    await expect(chips(page)).toHaveCount(0);
    await expect(field(page)).toBeFocused();
    await expect(
      page.getByRole('region', { name: 'Build', exact: true }).getByRole('article'),
    ).toHaveCount(4);
    await page.keyboard.press('Escape');
    await expect(bar(page)).toHaveCount(0);
  });

  test('sorts by when tasks were added and last updated, newest or oldest first', async ({
    page,
  }) => {
    const board = await sizedBoard(page);
    await openBar(page);
    await openFilters(page);
    // The fixture adds Build's tasks in board order.
    await section(page, 'Sort');
    await filters(page).getByRole('button', { name: 'Added', exact: true }).click();
    const added = [
      board.ids['Low priority'],
      board.ids['Later position'],
      board.ids['Earlier position'],
      board.ids['Board parent'],
    ];
    await expect.poll(() => cardIds(page, 'Build')).toEqual(added);
    await filters(page).getByRole('button', { name: 'Oldest', exact: true }).click();
    await expect.poll(() => cardIds(page, 'Build')).toEqual([...added].reverse());
    // A change in the task's log makes it the most recently updated.
    await filters(page).getByRole('button', { name: 'Updated', exact: true }).click();
    await expect.poll(() => cardIds(page, 'Build')).toEqual(added);
    await page.evaluate(
      async (id) => (await import('/src/lib/tasks.ts')).updateTask(id, { size: 1 }),
      board.ids['Board parent']!,
    );
    await expect
      .poll(() => cardIds(page, 'Build'), { timeout: 15_000 })
      .toEqual([board.ids['Board parent'], ...added.slice(0, 3)]);
    await page.keyboard.press('Escape');
    await expect(chips(page)).toContainText('Recently updated first');
  });

  test('the workspace board scopes to a project and sizes, and captures through the capture window', async ({
    page,
  }) => {
    const board = await workspaceFixture(page);
    await openBar(page);
    await openFilters(page);
    // Tags are per project, so the workspace board offers its projects instead.
    await expect(page.getByRole('tab', { name: 'Tags', exact: true })).toHaveCount(0);
    await section(page, 'Projects');
    await filters(page).getByRole('button', { name: 'Garden', exact: true }).click();
    await expect
      .poll(() => cardIds(page, 'Active'))
      .toEqual([board.ids['Water tomatoes'], board.ids['Prune roses']]);
    await expect(chips(page).getByRole('button', { name: 'Remove Garden filter' })).toBeVisible();
    await section(page, 'Size');
    await filters(page)
      .getByRole('button', { name: /^Unsized,/ })
      .click();
    await expect(
      page.getByRole('region', { name: 'Active', exact: true }).getByRole('article'),
    ).toHaveCount(2);
    await chips(page).getByRole('button', { name: 'Remove Garden filter' }).click();
    await expect(
      page.getByRole('region', { name: 'Active', exact: true }).getByRole('article'),
    ).toHaveCount(5);
    // With no project chosen, Ctrl/⌘Enter hands the words to the capture window.
    await field(page).fill('Capture from the bar');
    await field(page).press('ControlOrMeta+Enter');
    const capture = page.getByRole('dialog', { name: 'New task', exact: true });
    await capture.getByRole('option', { name: 'Kitchen', exact: true }).click();
    await expect(capture.getByRole('textbox', { name: 'Task title' })).toHaveValue(
      'Capture from the bar',
    );
  });

  test('a wide workspace board shows Sort, Size and Projects inline in the docked sidebar', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const board = await workspaceFixture(page);
    await openBar(page);
    const docked = bar(page);
    await expect(docked).toHaveAttribute('data-docked', '');
    await expect(docked.getByRole('button', { name: 'Filter and sort' })).toHaveCount(0);
    await expect(docked.getByRole('region', { name: 'Tags', exact: true })).toHaveCount(0);
    const projectsSection = docked.getByRole('region', { name: 'Projects', exact: true });
    await expect(projectsSection).toBeVisible();
    await projectsSection.getByRole('button', { name: /^Garden\b/ }).click();
    await expect
      .poll(() => cardIds(page, 'Active'))
      .toEqual([board.ids['Water tomatoes'], board.ids['Prune roses']]);
    await expect(chips(page).getByRole('button', { name: 'Remove Garden filter' })).toBeVisible();
  });

  test('the docked search sidebar feathers its overflowing top and bottom edges', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 520 });
    const board = await fixture(page, true);
    for (let i = 1; i <= 14; i++) {
      await newTag(page.request, board, board.projectId, { name: `Tag ${i}` });
    }
    await openBar(page);
    const sidebar = bar(page);
    await expect(sidebar).toHaveAttribute('data-docked', '');
    const area = sidebar.locator('[data-slot="scroll-area"][data-edges]').first();
    const viewport = area.locator('> [data-slot="scroll-area-viewport"]');
    await expect(area).toBeVisible();
    await expect(area).not.toHaveAttribute('data-more-top');
    await expect(area).toHaveAttribute('data-more-bottom');

    await viewport.evaluate((el) => {
      el.scrollTop = 80;
    });
    await expect(area).toHaveAttribute('data-more-top');
    await expect(area).toHaveAttribute('data-more-bottom');

    await viewport.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(area).toHaveAttribute('data-more-top');
    await expect(area).not.toHaveAttribute('data-more-bottom');
  });

  test('the rail toggles the floating search bar without losing filters and resets them on leaving the board', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    const board = await sizedBoard(page);
    const railSearch = page.getByRole('button', { name: 'Search', exact: true });
    await railSearch.click();
    await expect(field(page)).toBeFocused();
    await expect(bar(page)).not.toHaveAttribute('data-docked');
    await expect(railSearch).toHaveAttribute('aria-expanded', 'true');

    await field(page).fill('position');
    await openFilters(page);
    await section(page, 'Size');
    await filters(page)
      .getByRole('button', { name: /^Size L,/ })
      .click();
    await expect.poll(() => cardIds(page, 'Build')).toEqual([board.ids['Later position']]);

    // Clicking Search in the collapsed nav rail collapses the floating bar while keeping filters.
    await railSearch.click();
    await expect(bar(page)).toHaveCount(0);
    await expect(railSearch).toHaveAttribute('aria-expanded', 'false');
    await expect(railSearch.locator('[data-search-filter-dot]')).toBeVisible();
    await expect(railSearch).toHaveAccessibleDescription('Search (2 active filters)');
    await expect.poll(() => cardIds(page, 'Build')).toEqual([board.ids['Later position']]);

    // Expanding the rail shows the active count badge, and clicking Search reopens with filters intact.
    await page.getByRole('button', { name: 'Expand navigation', exact: true }).click();
    await expect(railSearch.locator('[data-search-filter-badge]')).toHaveText('2');
    await railSearch.click();
    await expect(field(page)).toBeFocused();
    await expect(field(page)).toHaveValue('position');
    await expect(chips(page)).toContainText('L');

    // Navigating away from the board and returning clears the board's search and filter state.
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page).toHaveURL(/\/settings/);
    await page.getByRole('link', { name: 'Real board', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'Build', exact: true }).getByRole('article'),
    ).toHaveCount(4);
    await expect(bar(page)).toHaveCount(0);
    await expect(railSearch.locator('[data-search-filter-badge]')).toHaveCount(0);
  });
});

test.describe('phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'The desktop board has its search bar');

  test('the drawer’s search filters and sorts the board, which says so with one-tap clear', async ({
    page,
  }) => {
    const board = await sizedBoard(page);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const field = page.getByRole('combobox', { name: /^Search tasks/ });
    await expect(field).toBeFocused();
    await page.getByRole('button', { name: 'Filter and sort', exact: true }).click();
    // Choosing filters leaves the keyboard as it was: the field keeps focus, even through a
    // tag's label, which would otherwise focus its checkbox.
    const work = page.getByRole('checkbox', { name: 'Work', exact: true });
    await page.locator('label', { has: work }).getByText('Work', { exact: true }).click();
    await expect(work).toBeChecked();
    await expect(field).toBeFocused();
    await work.click();
    await expect(work).not.toBeChecked();
    await expect(field).toBeFocused();
    await section(page, 'Size');
    await page.getByRole('button', { name: /^Size L,/ }).click();
    await page.getByRole('button', { name: /^Size XL,/ }).click();
    await section(page, 'Sort');
    await page.getByRole('button', { name: 'Size', exact: true }).click();
    await page.getByRole('button', { name: 'Largest', exact: true }).click();
    await expect(field).toBeFocused();
    // With nothing typed, the results list what the board behind now shows, in its order.
    await expect(page.getByText('2 tasks on the board', { exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: /Low priority|Later position/ })).toHaveText([
      /Low priority/,
      /Later position/,
    ]);
    // The results narrow with the board.
    await page.getByRole('combobox', { name: /^Search tasks/ }).fill('position');
    await expect(page.getByRole('option', { name: /Later position/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /Earlier position/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    // The board shows what is left, largest first, under its chips.
    await expect
      .poll(() => cardIds(page, 'Build'))
      .toEqual([board.ids['Low priority'], board.ids['Later position']]);
    const bar = chips(page);
    await expect(bar).toContainText('Largest first');
    await expect(bar).toContainText('XL');
    // Moving a card while sorted sends it to the chosen status, keeping its priority.
    await settled(card(page, 'Later position'));
    const touch = await finger(page);
    await touch.press(card(page, 'Later position'));
    await touch.lift();
    await expect(page.getByText('1 selected')).toBeVisible();
    await touch.tap(
      page
        .getByRole('toolbar', { name: 'Selected tasks' })
        .getByRole('button', { name: 'Change status' }),
    );
    await touch.tap(page.locator(`[data-drop-status="${board.status('Review')}"]`));
    await expect
      .poll(async () => {
        const row = await taskRow(page, board.headers, board.ids['Later position']!);
        return [row?.status_id, row?.priority];
      })
      .toEqual([board.status('Review'), '3']);
    // Clear all stays in reach beside the chips, however many there are.
    await page.locator('header').getByRole('button', { name: 'Clear all', exact: true }).click();
    await expect(bar).toHaveCount(0);
    await expect
      .poll(() => cardIds(page, 'Build'))
      .toEqual([
        board.ids['Board parent'],
        board.ids['Earlier position'],
        board.ids['Low priority'],
      ]);
  });

  test('the search drawer feathers overflowing results and still dismisses on pull from the top', async ({
    page,
  }) => {
    const board = await fixture(page, true);
    for (let i = 1; i <= 12; i++) {
      await taggedTask(page.request, board, board.projectId, {
        title: `Feather item ${i}`,
        statusId: board.status('Build'),
        priority: 3,
        position: `a${String(i).padStart(2, '0')}`,
      });
    }
    await expect(
      page.getByRole('region', { name: 'Build', exact: true }).getByRole('article'),
    ).toHaveCount(12);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Search', exact: true });
    await dialog.getByRole('combobox', { name: /^Search tasks/ }).fill('Feather item');
    await expect(dialog.getByRole('option', { name: /Feather item 1\b/ })).toBeVisible();

    const area = dialog.locator('[data-slot="scroll-area"][data-edges]').first();
    const viewport = area.locator('> [data-slot="scroll-area-viewport"]');
    await expect(area).not.toHaveAttribute('data-more-top');
    await expect(area).toHaveAttribute('data-more-bottom');

    await viewport.evaluate((el) => {
      el.scrollTop = 100;
    });
    await expect(area).toHaveAttribute('data-more-top');
    await expect(area).toHaveAttribute('data-more-bottom');

    await viewport.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(area).toHaveAttribute('data-more-top');
    await expect(area).not.toHaveAttribute('data-more-bottom');

    // Returning to the top restores pull-to-dismiss on the drawer.
    await viewport.evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(area).not.toHaveAttribute('data-more-top');
    const box = (await viewport.boundingBox())!;
    const touch = await finger(page);
    await touch.press({ x: box.x + box.width / 2, y: box.y + 40 }, 0);
    await touch.move({ x: box.x + box.width / 2, y: box.y + 260 }, 150);
    await touch.lift();
    await expect(dialog).toHaveCount(0);
  });
});
