import { expect, test } from '@playwright/test';
import { APP_LOAD_TIMEOUT, signUp } from './helpers';

test('settings pages switch from the side list or the phone dock, and the account renames', async ({
  page,
  isMobile,
}) => {
  await signUp(page);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/settings\/general$/);
  await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Appearance' })).toBeVisible();

  if (isMobile) {
    await page.getByRole('button', { name: 'Settings page: General' }).click();
    const picker = page.getByRole('dialog', { name: 'Settings', exact: true });
    await expect(picker.getByRole('link', { name: 'Account', exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('settings-pages.png') });
    await picker.getByRole('link', { name: 'Account', exact: true }).click();
    await expect(picker).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Settings page: Account' })).toBeVisible();
  } else {
    const nav = page.getByRole('navigation', { name: 'Settings pages' });
    await expect(nav.getByRole('link', { name: 'Backups' })).toHaveCount(0);
    await nav.getByRole('link', { name: 'Account', exact: true }).click();
    await expect(nav.getByRole('link', { name: 'Account', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  }
  await expect(page).toHaveURL(/\/settings\/account$/);
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Change name', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Change name' });
  await expect(form.getByLabel('Name', { exact: true })).toBeFocused();
  await form.getByLabel('Name', { exact: true }).fill('Renamed Person');
  await form.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(form).toHaveCount(0);
  const signedIn = page.getByRole('region', { name: 'Signed in as' });
  await expect(signedIn.getByText('Renamed Person').first()).toBeVisible();
  await page.reload();
  await expect(signedIn.getByText('Renamed Person').first()).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
  await page.screenshot({ path: test.info().outputPath('settings-account.png') });
  await page.goto('/settings/general');
  await page.screenshot({ path: test.info().outputPath('settings-general.png'), fullPage: true });
});

test('a changed password keeps this device signed in and replaces the old one', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'The password form is the same on both layouts; the test above opens one.');
  const { email } = await signUp(page);
  await page.goto('/settings/account');
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Change password' });
  await form.getByLabel('Current password').fill('password123');
  await form.getByLabel('New password', { exact: true }).fill('a-new-password');
  await form.getByLabel('Confirm new password').fill('a-new-password');
  await form.getByRole('button', { name: 'Save password', exact: true }).click();
  await expect(form).toHaveCount(0);

  await page.reload();
  await expect(page).toHaveURL(/\/settings\/account$/);
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Invalid email or password', { exact: true })).toBeVisible();
  await page.getByLabel('Password').fill('a-new-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Personal' })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
});
