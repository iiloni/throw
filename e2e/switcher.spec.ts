import { expect, type Page, test } from '@playwright/test';
import { card, finger, workspaceFixture } from './board-helpers';
import { switcherItem } from './helpers';

const switcher = (page: Page) => page.getByRole('dialog', { name: 'Projects', exact: true });
const title = (page: Page) =>
  page.getByRole('button', { name: 'Switch project or workspace', exact: true });

/** Pulls a finger straight down from `y` on the board's page, without lifting it. */
async function pullDown(page: Page, from: { x: number; y: number }, distance: number) {
  const touch = await finger(page);
  await touch.press(from, 30);
  await touch.move({ x: from.x, y: from.y + distance }, 240);
  return touch;
}

test.beforeEach(({ isMobile }) => {
  test.skip(!isMobile, 'The switcher is the phone’s; a desktop switches from the rail.');
});

test('the title opens a thumb-reach switcher of project tiles, and a tile switches', async ({
  page,
}, info) => {
  await workspaceFixture(page);
  await title(page).click();
  await expect(title(page)).toHaveAttribute('aria-expanded', 'true');
  const sheet = switcher(page);
  await expect(sheet).toBeVisible();
  // One drawer (ADR 0009): the switcher is the board drawer's page, low on the screen.
  await expect(page.locator('section[data-drawer][data-page]')).toHaveCount(1);
  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => (await sheet.boundingBox())!.y)
    .toBeGreaterThan(viewport.height * 0.25);
  await expect(await switcherItem(page, 'All projects')).toHaveAttribute('aria-current', 'page');
  await expect(await switcherItem(page, 'Kitchen')).toHaveAttribute('data-color', 'teal');
  await expect(sheet.getByRole('button', { name: 'Project settings' })).toHaveCount(0);
  await page.waitForTimeout(500);
  await page.screenshot({ path: info.outputPath('switcher.png') });

  await (await switcherItem(page, 'Kitchen')).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kitchen');
  await expect(switcher(page)).toHaveCount(0);
  await expect(card(page, 'Bake bread')).toBeVisible();

  // The open project is marked, and Escape puts the switcher away with focus on the title.
  await title(page).click();
  await expect(await switcherItem(page, 'Kitchen')).toHaveAttribute('aria-current', 'page');
  await expect(switcher(page).getByRole('button', { name: 'Project settings' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(switcher(page)).toHaveCount(0);
  await expect(title(page)).toBeFocused();
});

test('workspaces and occasional actions sit around the tiles', async ({ page }, info) => {
  const { workspaceId } = await workspaceFixture(page);
  await title(page).click();
  const sheet = switcher(page);
  await expect(sheet.getByRole('button', { name: 'Workspace: Personal' })).toBeVisible();
  for (const name of ['New project', 'Workspace trash', 'Settings'])
    await expect(sheet.getByRole('button', { name, exact: true })).toBeVisible();

  // The workspace row opens its own view; Escape steps back before it closes.
  const rename = await switcherItem(page, 'Rename workspace', { workspace: true });
  const workspaces = page.getByRole('dialog', { name: 'Workspaces', exact: true });
  await expect(workspaces.getByRole('button', { name: 'Personal', exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(workspaces.getByRole('button', { name: 'New workspace' })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: info.outputPath('switcher-workspaces.png') });
  await page.keyboard.press('Escape');
  await expect(switcher(page)).toBeVisible();
  await (await switcherItem(page, 'Rename workspace', { workspace: true })).click();
  await expect(rename).toHaveCount(0);
  // The form takes the drawer's page in the switcher's place.
  await expect(page.getByLabel('Workspace name')).toHaveValue('Personal');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await title(page).click();
  await (await switcherItem(page, 'Workspace trash')).click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/trash$`));
});

test('pulling down from the top of the board opens the switcher', async ({ page }, info) => {
  await workspaceFixture(page);
  const column = card(page, 'Bake bread');
  await expect(column).toBeVisible();
  const box = (await column.boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  // A short pull draws the cue and springs back.
  let touch = await pullDown(page, from, 60);
  const pill = page.locator('[data-switcher-pull-pill]');
  await expect(pill).toContainText('Pull to switch projects');
  await touch.lift();
  await page.waitForTimeout(400);
  await expect(switcher(page)).toHaveCount(0);

  // A sideways swipe belongs to the columns.
  touch = await finger(page);
  await touch.press(from, 30);
  await touch.move({ x: from.x - 200, y: from.y + 40 }, 240);
  await touch.lift();
  await page.waitForTimeout(400);
  await expect(switcher(page)).toHaveCount(0);
  await expect(pill).not.toHaveAttribute('data-armed');

  // Past the threshold, letting go opens it, and the card beneath is not opened.
  const header = page.getByRole('heading', { level: 1 });
  const top = (await header.boundingBox())!;
  touch = await pullDown(page, { x: top.x + 40, y: top.y + top.height / 2 }, 180);
  await expect(pill).toContainText('Release to switch projects');
  await expect(pill).toHaveAttribute('data-armed', '');
  await page.screenshot({ path: info.outputPath('switcher-pull.png') });
  await touch.lift();
  await expect(switcher(page)).toBeVisible();
  await expect(page).not.toHaveURL(/task=/);
  await page.keyboard.press('Escape');
  await expect(switcher(page)).toHaveCount(0);

  // Not while a task is open over the board.
  await column.click();
  await expect(page).toHaveURL(/task=/);
  touch = await pullDown(page, { x: 200, y: 200 }, 180);
  await touch.lift();
  await page.waitForTimeout(400);
  await expect(switcher(page)).toHaveCount(0);
});
