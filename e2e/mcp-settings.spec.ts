import { expect, test } from '@playwright/test';
import { APP_LOAD_TIMEOUT, signUp } from './helpers';

test('create a workspace MCP token, reveal it once and revoke it in Settings', async ({
  page,
  isMobile,
}) => {
  await signUp(page);
  await page.goto('/settings/general');

  if (isMobile) {
    await page.getByRole('button', { name: 'Settings page: General' }).click();
  }
  await page.getByRole('link', { name: 'MCP tokens' }).click({ timeout: APP_LOAD_TIMEOUT });
  await expect(page).toHaveURL(/\/settings\/mcp$/);
  await expect(page.getByText('No MCP tokens')).toBeVisible();
  await expect(page.getByText(/\/api\/mcp$/)).toBeVisible();
  await page.getByRole('button', { name: 'Create token', exact: true }).click();

  const form = page.getByRole('dialog', { name: 'Create MCP token' });
  await expect(form.getByLabel('Token name')).toBeFocused();
  await form.getByLabel('Token name').fill('Review agent');
  await expect(form.getByRole('option', { name: 'Personal' })).toBeAttached();
  await form.getByRole('button', { name: 'Create token' }).click();

  const reveal = page.getByRole('dialog', { name: 'Copy your token' });
  const secret = reveal.getByRole('textbox', { name: 'MCP token' });
  await expect(secret).toHaveValue(/^throw_mcp_[\w-]{43}$/);
  await expect(secret).toBeFocused();
  await reveal.getByRole('button', { name: 'Done' }).click();
  await expect(reveal).toBeHidden();
  await expect(page.getByText('Review agent', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'MCP token' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Revoke Review agent' }).click();
  await page
    .getByRole('dialog', { name: 'Revoke MCP token' })
    .getByRole('button', { name: 'Revoke token' })
    .click();
  await expect(page.getByText('No MCP tokens')).toBeVisible();
  await page.reload();
  await expect(page.getByText('No MCP tokens')).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
});
