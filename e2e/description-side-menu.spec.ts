import { randomUUID } from 'node:crypto';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { APP_LOAD_TIMEOUT, shapeRows, signUp } from './helpers';

// THR-111: BlockNote's floating chrome in a task's description, which the pane's clipped,
// card-wide scroll area used to cut off.

async function openTask(page: Page) {
  const account = await signUp(page);
  const [workspace] = await shapeRows(page.request, 'workspaces', account.headers);
  const workspaceId = String(workspace?.id);
  const projectId = randomUUID();
  const statuses = (['backlog', 'active', 'done', 'cancelled'] as const).map((category) => ({
    id: randomUUID(),
    name: category,
    category,
    position: 'a0',
    isDefault: true,
  }));
  expect(
    (
      await page.request.post('/api/projects', {
        headers: account.headers,
        data: {
          id: projectId,
          workspaceId,
          name: 'Notes',
          key: 'NOTE',
          color: 'teal',
          icon: null,
          position: 'a0',
          statuses,
        },
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await page.request.post('/api/tasks', {
        headers: account.headers,
        data: {
          id: randomUUID(),
          projectId,
          title: 'Write the plan',
          statusId: statuses[1]!.id,
          priority: 3,
          position: 'a0',
          parentId: null,
          description: null,
          descriptionVersion: null,
        },
      })
    ).status(),
  ).toBe(201);
  await page.goto(`/w/${workspaceId}/p/${projectId}?view=board`);
  const card = page.getByRole('article', { name: 'NOTE-1 Write the plan', exact: true });
  await expect(card).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await card.click();
  const pane = page.getByLabel('Task', { exact: true });
  const editor = pane.locator('.bn-editor[contenteditable="true"]');
  await expect(editor).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  return { pane, editor };
}

async function writeBlocks(page: Page, editor: Locator) {
  await editor.click();
  await page.keyboard.type('A paragraph long enough to wrap onto a second line inside the pane');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- A bullet');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[] A check');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('### A heading');
}

const box = async (target: Locator) => {
  const bounds = await target.boundingBox();
  if (!bounds) throw new Error('Not rendered');
  return bounds;
};

test('the block handle sits whole in the card gutter beside each block', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'A finger formats from the dock; the phone test covers it');
  const { editor } = await openTask(page);
  await writeBlocks(page, editor);
  const menu = page.locator('.bn-side-menu');
  for (const type of ['paragraph', 'bulletListItem', 'checkListItem', 'heading']) {
    const block = editor.locator(`[data-content-type="${type}"]`).first();
    await expect(async () => {
      await block.hover();
      await expect(menu).toBeVisible({ timeout: 2_000 });
    }).toPass();
    // One handle: Add block moved into its menu, as in Catch.
    await expect(menu.getByRole('button')).toHaveCount(1);
    const handle = await box(menu.getByRole('button'));
    // The card's clipped scroll area, which used to cut off BlockNote's `+`.
    const edge = await editor.evaluate((node) => {
      const area = node.closest('[data-slot="scroll-area-viewport"]');
      if (!area) throw new Error('No scroll area');
      return { x: area.getBoundingClientRect().left };
    });
    const content = await box(block);
    const line = await box(block.locator('.bn-inline-content'));
    expect(handle.x, type).toBeGreaterThanOrEqual(edge.x + 2);
    expect(handle.x + handle.width, type).toBeLessThanOrEqual(content.x - 2);
    const lineHeight = await block
      .locator('.bn-inline-content')
      .evaluate((node) => Number.parseFloat(getComputedStyle(node).lineHeight));
    // Beside the first line, not the middle of a wrapped block.
    expect(Math.abs(handle.y + handle.height / 2 - (line.y + lineHeight / 2)), type).toBeLessThan(
      3,
    );
  }
});

test('the handle menu adds a block and its handle moves blocks', async ({ page, isMobile }) => {
  test.skip(isMobile, 'BlockNote moves blocks by HTML drag and drop, which suits a mouse');
  const { editor } = await openTask(page);
  await writeBlocks(page, editor);
  const menu = page.locator('.bn-side-menu');
  const dropdown = page.locator('.bn-drag-handle-menu');
  // Any scroll of the pane hides BlockNote's side menu until the pointer moves again.
  await expect(async () => {
    await editor.locator('[data-content-type="heading"]').hover();
    await menu.getByRole('button').click({ timeout: 2_000 });
    await expect(dropdown.getByRole('menuitem', { name: 'Add block' })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass();
  // The menu used to wrap to the handle's width.
  expect((await box(dropdown)).width).toBeGreaterThanOrEqual(120);
  await dropdown.getByRole('menuitem', { name: 'Add block' }).click();
  const slash = page.locator('.bn-suggestion-menu');
  await expect(slash).toBeVisible();
  const viewport = page.viewportSize()!;
  const bounds = await box(slash);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  await page.keyboard.press('Escape');
  await expect(slash).toHaveCount(0);

  const text = () =>
    editor
      .locator('.bn-block-content')
      .evaluateAll((blocks) => blocks.map((block) => block.textContent?.trim()).filter(Boolean));
  const order = [
    'A heading',
    'A paragraph long enough to wrap onto a second line inside the pane',
    'A bullet',
    'A check',
  ];
  await expect(async () => {
    await editor.locator('[data-content-type="heading"]').hover();
    await menu
      .getByRole('button')
      .dragTo(editor.locator('[data-content-type="paragraph"]').first(), {
        targetPosition: { x: 20, y: 2 },
        timeout: 2_000,
      });
    await expect.poll(text, { timeout: 2_000 }).toEqual(order);
  }).toPass();
});

test('the selection toolbar fits the window beside a narrow pane', async ({ page, isMobile }) => {
  test.skip(isMobile, 'A finger formats from the dock');
  const { editor } = await openTask(page);
  await writeBlocks(page, editor);
  await editor.locator('[data-content-type="heading"] .bn-inline-content').selectText();
  const toolbar = page.locator('.bn-formatting-toolbar');
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole('button').last()).toBeInViewport({ ratio: 1 });
  const bounds = await box(toolbar);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test('a phone formats from the dock, with no block handle and a slash menu clear of it', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'The desktop tests cover the handle and the menus');
  const { editor } = await openTask(page);
  await writeBlocks(page, editor);
  await editor.locator('[data-content-type="bulletListItem"]').tap();
  await expect(page.locator('.bn-side-menu')).toHaveCount(0);
  await editor.locator('[data-content-type="heading"]').tap();
  const formatting = page.getByRole('toolbar', { name: 'Formatting', exact: true });
  await formatting.getByRole('button', { name: 'Slash menu' }).tap();
  const slash = page.locator('.bn-suggestion-menu');
  await expect(slash).toBeVisible();
  const bounds = await box(slash);
  const viewport = page.viewportSize()!;
  expect(bounds.x).toBeGreaterThanOrEqual(8);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 8);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual((await box(formatting)).y);
});
