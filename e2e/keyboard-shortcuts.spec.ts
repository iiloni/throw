import { expect, type Page, test } from '@playwright/test';
import { card, fixture } from './board-helpers';

const sheet = (page: Page) => page.getByRole('dialog', { name: 'Keyboard shortcuts' });

// On a phone the sheet is a page of the board's drawer (ADR 0009); on desktop, a dialog.
test('? lists the shortcuts with the keys they have', async ({ page }) => {
  await fixture(page);
  await page.keyboard.press('Shift+?');
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).getByRole('region', { name: 'Boards' })).toContainText(
    'Open or close the backlog',
  );
  await expect(sheet(page).getByRole('region', { name: 'Open task' })).toContainText(
    'Change status',
  );
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeHidden();
});

test('on a phone, the open task’s keys open its pickers in the drawer', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'The desktop pane is covered below');
  await fixture(page);
  await card(page, 'Review this').click();
  const screen = page.getByRole('dialog', { name: 'Task', exact: true });
  await expect(screen).toBeVisible();
  await page.keyboard.press('s');
  await expect(page.getByRole('radio', { name: 'Review' })).toBeVisible();
});

test.describe('on a desktop board', () => {
  test.skip(({ isMobile }) => isMobile, 'Rails, the arrows and the pane are desktop layouts');

  test('plain keys wait while typing, and chords reach past the field', async ({ page }) => {
    await fixture(page);
    // Typed into a field, the keys are text.
    await page.keyboard.press('ControlOrMeta+k');
    const field = page.getByRole('searchbox', { name: 'Search tasks', exact: true });
    await expect(field).toBeFocused();
    await page.keyboard.type('n?[');
    await expect(field).toHaveValue('n?[');
    await expect(sheet(page)).toBeHidden();
    await expect(page.getByRole('dialog', { name: 'New task' })).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Backlog', exact: true })).toBeVisible();
    // A chord still reaches past the field.
    await page.keyboard.press('ControlOrMeta+/');
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press('ControlOrMeta+/');
    await expect(sheet(page)).toBeHidden();
  });

  test('[ and ] open and close the rails, and the arrows walk the cards', async ({ page }) => {
    await fixture(page);
    const backlog = page.getByRole('heading', { name: 'Backlog', exact: true });
    const closed = page.getByRole('heading', { name: 'Closed', exact: true });
    await expect(backlog).toBeVisible();
    await expect(closed).toBeHidden();
    await page.keyboard.press('[');
    await expect(backlog).toBeHidden();
    await expect(page.getByRole('button', { name: /^Open backlog, / })).toBeVisible();
    await page.keyboard.press(']');
    await expect(closed).toBeVisible();
    await page.keyboard.press('[');
    await expect(backlog).toBeVisible();

    await card(page, 'Earlier position').focus();
    await page.keyboard.press('ArrowDown');
    await expect(card(page, 'Later position')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(card(page, 'Earlier position')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(card(page, 'Review this')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(card(page, 'Review this')).not.toBeFocused();
    await expect(page.locator('[data-card-id]:focus')).toHaveCount(1);

    // Closing a rail with focus in it leaves focus on the strip in its place.
    await card(page, 'Idea for later').focus();
    await page.keyboard.press('[');
    await expect(page.getByRole('button', { name: /^Open backlog, / })).toBeFocused();

    await page.keyboard.press('n');
    await expect(page.getByRole('dialog', { name: 'New task' })).toBeVisible();
  });

  test('the open task’s keys open its pickers, tabs and comment', async ({ page }) => {
    await fixture(page);
    await card(page, 'Review this').click();
    const pane = page.getByRole('region', { name: 'Status', exact: true });
    await expect(page.getByRole('button', { name: /^Status: Review\. Change/ })).toBeVisible();
    await page.keyboard.press('s');
    await expect(pane).toBeVisible();
    await expect(pane.getByRole('radio', { name: 'Review' })).toBeFocused();
    await page.keyboard.press('p');
    await expect(page.getByRole('region', { name: 'Priority', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('region', { name: 'Priority', exact: true })).toBeHidden();

    const tabs = page.getByRole('tablist', { name: /^Comments, history/ });
    await page.keyboard.press('2');
    await expect(tabs.getByRole('tab', { name: 'History' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('c');
    await expect(tabs.getByRole('tab', { name: /^Comments/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const editor = page
      .getByRole('region', { name: 'Comment editor' })
      .locator('[contenteditable="true"]');
    await expect(editor).toBeFocused();
    await page.keyboard.type('spt');
    await expect(editor).toContainText('spt');
    await expect(pane).toBeHidden();
  });

  test('keys chosen in Settings run and show in tooltips, and survive a reload', async ({
    page,
  }) => {
    const { workspaceId, projectId } = await fixture(page);
    await page.goto('/settings/shortcuts');
    await page
      .getByRole('button', { name: 'Change Left bracket for Open or close the backlog' })
      .click();
    await page.keyboard.press('b');
    await expect(
      page.getByRole('button', { name: 'Change B for Open or close the backlog' }),
    ).toBeVisible();

    // A key another shortcut has is offered to move.
    await page.getByRole('button', { name: 'Add a shortcut for New task' }).click();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('alert')).toContainText('already does search');
    await page.getByRole('button', { name: 'Keep it there' }).click();
    await expect(page.getByRole('alert')).toBeHidden();

    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Change B for Open or close the backlog' }),
    ).toBeVisible();
    await page.goto(`/w/${workspaceId}/p/${projectId}?view=board`);
    const backlog = page.getByRole('heading', { name: 'Backlog', exact: true });
    await expect(backlog).toBeVisible();
    await page.keyboard.press('[');
    await expect(backlog).toBeVisible();
    await page.keyboard.press('b');
    await expect(backlog).toBeHidden();
    await page.getByRole('button', { name: /^Open backlog, / }).hover();
    await expect(page.getByRole('tooltip')).toContainText('Open backlog');
    await expect(page.getByRole('tooltip')).toContainText('B');
  });
});
