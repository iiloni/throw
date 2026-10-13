import { expect, test } from '@playwright/test';
import { APP_LOAD_TIMEOUT, signUp } from './helpers';

test('creating an account opens its first workspace', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login\?/, { timeout: APP_LOAD_TIMEOUT });
  await page.getByRole('button', { name: 'Need an account? Sign up' }).click();
  await page.getByLabel('Email').fill(`e2e-${crypto.randomUUID()}@example.com`);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Personal' })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
});

test('signing in again returns to the page that was asked for', async ({ page, isMobile }) => {
  // Where signing in returns to is the router's doing. The test above signs up on both layouts.
  test.skip(isMobile, 'Sign-in redirects do not depend on the layout.');
  const { email } = await signUp(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login\?/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('wrongpassword');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Invalid email or password', { exact: true })).toBeVisible();

  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
});
