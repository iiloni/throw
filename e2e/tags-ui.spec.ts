import { expect, test } from '@playwright/test';
import { APP_LOAD_TIMEOUT, shapeRows, signUp } from './helpers';

test('tag workshop manages a real tree and both task roles with touch and keyboard controls', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(120_000);
  const account = await signUp(page);
  await page.goto('/prototype/tags');
  await page.getByRole('button', { name: 'Create example project' }).click();
  const picker = page.getByRole('region', { name: 'Choose task tags' });
  await expect(
    picker.getByRole('radio', { name: 'Primary: Product / Features / Mobile', exact: true }),
  ).toBeChecked({ timeout: APP_LOAD_TIMEOUT });
  await expect(
    picker.getByRole('checkbox', { name: 'Secondary: Research', exact: true }),
  ).toBeChecked();
  const badge = page
    .getByRole('button', { name: 'Product / Features / Mobile', exact: true })
    .first();
  if (isMobile) {
    await badge.tap();
    await expect(page.getByRole('tooltip')).toHaveText('Product / Features / Mobile');
    // Observe past Radix's 300 ms pointer-leave grace period after a real finger lifts.
    await page.waitForTimeout(500);
    await expect(page.getByRole('tooltip')).toBeVisible();
    await badge.tap();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await picker.getByRole('checkbox', { name: 'Secondary: Product', exact: true }).tap();
  } else {
    await page.keyboard.press('Tab');
    await badge.focus();
    await expect(page.getByRole('tooltip')).toHaveText('Product / Features / Mobile');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await picker.getByRole('checkbox', { name: 'Secondary: Product', exact: true }).check();
  }
  await picker.getByRole('radio', { name: 'Primary: Research', exact: true }).check();
  // A primary may be secondary too; both roles survive independently.
  await expect(
    picker.getByRole('checkbox', { name: 'Secondary: Research', exact: true }),
  ).toBeChecked();
  await picker.getByRole('button', { name: 'Clear primary' }).click();
  await expect(
    picker.getByRole('radio', { name: 'Primary: Research', exact: true }),
  ).not.toBeChecked();
  const manager = page.getByRole('region', { name: 'Manage project tags' });
  await manager.getByRole('button', { name: 'New tag', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New tag', exact: true });
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Quality');
  await dialog.getByRole('button', { name: 'Blue', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save tag' }).click();
  const edit = manager.getByRole('button', { name: 'Edit Quality', exact: true });
  await expect(edit).toBeVisible();
  await edit.click();
  const editing = page.getByRole('dialog', { name: 'Edit tag', exact: true });
  await editing.getByRole('textbox', { name: 'Name', exact: true }).fill('Quality checks');
  await editing
    .getByLabel('Parent tag', { exact: true })
    .selectOption({ label: 'Product / Features' });
  await editing.getByRole('button', { name: 'Save tag' }).click();
  await expect(
    manager.getByRole('button', { name: 'Edit Product / Features / Quality checks', exact: true }),
  ).toBeVisible();
  await picker.getByRole('textbox', { name: 'Find tags' }).fill('Quality');
  await picker
    .getByRole('radio', { name: 'Primary: Product / Features / Quality checks', exact: true })
    .check();
  await expect(
    picker.getByRole('checkbox', {
      name: 'Secondary: Product / Features / Quality checks',
      exact: true,
    }),
  ).not.toBeChecked();
  await picker.getByRole('textbox', { name: 'Find tags' }).fill('');
  await manager.getByRole('button', { name: 'Delete Quality checks', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Delete Quality checks?' })
    .getByRole('button', { name: 'Delete tag', exact: true })
    .click();
  await expect(
    manager.getByRole('button', { name: 'Edit Product / Features / Quality checks', exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(async () =>
      (await shapeRows(page.request, 'tags', account.headers)).some(
        (row) => row.name === 'Quality checks',
      ),
    )
    .toBe(false);
  await page.getByRole('button', { name: 'Switch theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  // Closing a form with Escape restores focus to its opener.
  await manager.getByRole('button', { name: 'New tag', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'New tag', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'New tag', exact: true })).toHaveCount(0);
  await expect(manager.getByRole('button', { name: 'New tag', exact: true })).toBeFocused();
});
