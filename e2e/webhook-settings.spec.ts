import { expect, test } from '@playwright/test';
import { APP_LOAD_TIMEOUT, signUp } from './helpers';
import { expectSigned, startReceiver } from './webhook-helpers';

test('create, test, turn off and delete a webhook in Settings', async ({ page, isMobile }) => {
  await signUp(page);
  const receiver = await startReceiver();
  try {
    await page.goto('/settings/general');
    if (isMobile) await page.getByRole('button', { name: 'Settings page: General' }).click();
    await page.getByRole('link', { name: 'Webhooks' }).click({ timeout: APP_LOAD_TIMEOUT });
    await expect(page).toHaveURL(/\/settings\/webhooks$/);
    await expect(page.getByText('No webhooks')).toBeVisible();
    await page.getByRole('button', { name: 'Create webhook', exact: true }).click();

    const form = page.getByRole('dialog', { name: 'Create webhook' });
    await expect(form.getByLabel('Name')).toBeFocused();
    await form.getByLabel('Name').fill('Agent wake-up');
    await form.getByLabel('Receiver URL').fill('https://10.0.0.1/hook');
    await expect(form.getByRole('option', { name: 'All projects' })).toBeAttached();
    await expect(form.getByRole('switch', { name: 'Ignore agent writes' })).toBeChecked();
    await form.getByRole('button', { name: 'Create webhook' }).click();
    await expect(form.getByRole('alert')).toHaveText(
      'This server does not send webhooks to private addresses',
    );
    await form.getByLabel('Receiver URL').fill(receiver.url());
    await form.getByRole('button', { name: 'Create webhook' }).click();

    const reveal = page.getByRole('dialog', { name: 'Copy your signing secret' });
    const field = reveal.getByRole('textbox', { name: 'Signing secret' });
    await expect(field).toHaveValue(/^throw_whsec_[\w-]{43}$/);
    await expect(field).toBeFocused();
    const secret = await field.inputValue();
    await reveal.getByRole('button', { name: 'Done' }).click();
    await expect(reveal).toBeHidden();
    await expect(page.getByText('Agent wake-up', { exact: true })).toBeVisible();
    await expect(page.getByText('Personal · All projects · No deliveries yet')).toBeVisible();

    await page.getByRole('button', { name: 'Edit Agent wake-up' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit webhook' });
    await edit.getByRole('button', { name: 'Send test' }).click();
    await expect(edit.getByRole('status')).toHaveText('Test delivered (HTTP 204)');
    expectSigned(await receiver.next(({ payload }) => payload.event === 'webhook.test'), secret);
    await edit.getByRole('button', { name: 'Done' }).click();
    await expect(edit).toBeHidden();
    await expect(page.getByText(/Personal · All projects · Delivered/)).toBeVisible();

    await page.getByRole('button', { name: 'Edit Agent wake-up' }).click();
    const quiet = page.getByRole('dialog', { name: 'Edit webhook' });
    await expect(quiet.getByLabel('Quiet window')).toHaveValue('0');
    await quiet.getByLabel('Quiet window').selectOption({ label: 'Wait 1 minute' });
    await expect(
      quiet.getByText(/Waits until nothing this webhook follows has changed for this long/),
    ).toBeVisible();
    await quiet.getByRole('button', { name: 'Save' }).click();
    await expect(quiet).toBeHidden();
    await expect(
      page.getByText(/Personal · All projects · 1 minute quiet window · Delivered/),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText(/Personal · All projects · 1 minute quiet window · Delivered/),
    ).toBeVisible({ timeout: APP_LOAD_TIMEOUT });

    const toggle = page.getByRole('switch', { name: 'Deliver to Agent wake-up' });
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(page.getByText('Personal · All projects · Off')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('switch', { name: 'Deliver to Agent wake-up' })).not.toBeChecked({
      timeout: APP_LOAD_TIMEOUT,
    });

    await page.getByRole('button', { name: 'Edit Agent wake-up' }).click();
    await page
      .getByRole('dialog', { name: 'Edit webhook' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await page
      .getByRole('dialog', { name: 'Delete webhook' })
      .getByRole('button', { name: 'Delete webhook' })
      .click();
    await expect(page.getByText('No webhooks')).toBeVisible();
    await page.reload();
    await expect(page.getByText('No webhooks')).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  } finally {
    await receiver.close();
  }
});
