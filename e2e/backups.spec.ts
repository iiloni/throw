import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { signUp } from './helpers';

test('admins make, download, upload and delete backups and change the daily schedule', async ({
  page,
}) => {
  // Restores replace all users and are tested in an isolated production Compose project.
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password').fill('adminadmin');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/login/);
  await page.goto('/settings');
  const section = page.getByRole('region', { name: 'Server backups' });
  await expect(section.getByRole('button', { name: 'Back up now' })).toBeVisible();
  const backups = section.getByRole('button', { name: /^Manage the backup from/ });
  const before = await backups.count();
  await section.getByRole('button', { name: 'Back up now' }).click();
  await expect(backups).toHaveCount(before + 1, { timeout: 30_000 });
  await backups.first().click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^throw-backup-[\d_-]+-manual\.zip$/);
  const archive = await readFile(await download.path());
  expect(archive.includes('manifest.json')).toBe(true);
  await page
    .getByLabel('Backup file', { exact: true })
    .setInputFiles({ name: 'copy.zip', mimeType: 'application/zip', buffer: archive });
  await expect(backups).toHaveCount(before + 2);
  for (let i = 0; i < 2; i++) {
    await backups.first().click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(backups).toHaveCount(before + 1 - i);
  }
  const schedule = page.getByRole('region', { name: 'Automatic backups' });
  const enabled = schedule.getByRole('switch', { name: 'Back up every day' });
  await enabled.click();
  await expect(schedule.getByLabel('Backup time', { exact: true })).toBeVisible();
  const keep =
    (await schedule.getByLabel('Backups to keep', { exact: true }).inputValue()) === '9'
      ? '8'
      : '9';
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/admin/backups/schedule') &&
      response.request().method() === 'PUT',
  );
  await schedule.getByLabel('Backups to keep', { exact: true }).fill(keep);
  await schedule.getByRole('heading', { name: 'Automatic backups' }).click();
  expect((await saved).ok()).toBeTruthy();
  await page.reload();
  await expect(schedule.getByLabel('Backups to keep', { exact: true })).toHaveValue(keep);
  await enabled.click();
  await expect(schedule.getByLabel('Backup time', { exact: true })).toHaveCount(0);
});

test('regular accounts cannot see or call server backups', async ({ page }) => {
  const { headers } = await signUp(page);
  await page.goto('/settings');
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Server backups' })).toHaveCount(0);
  for (const path of ['', '/upload', '/missing/restore']) {
    const response = await page.request.fetch(`/api/admin/backups${path}`, {
      method: path ? 'POST' : 'GET',
      headers,
    });
    expect(response.status()).toBe(403);
  }
});
