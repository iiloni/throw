import { expect, test } from '@playwright/test';
import { signUp } from './helpers';

const current = '00000000-0000-4000-8000-000000000001';
const newer = '00000000-0000-4000-8000-000000000002';

test('web update prompt only appears for a different deployed build and stays available after Later', async ({
  page,
}) => {
  let deployed: unknown = { id: current };
  // Vite normally disables production update checks. Enable the unchanged production logic
  // against controlled metadata; service-worker activation is covered by webUpdates.test.ts.
  await page.route('**/src/lib/webUpdates.ts*', async (route) => {
    const response = await route.fetch();
    const body = (await response.text())
      .replace(/"THROW_WEB_BUILD": "false"/, '"THROW_WEB_BUILD": "true"')
      .replace(/"THROW_BUILD_ID": "[^"]+"/, `"THROW_BUILD_ID": "${current}"`);
    await route.fulfill({ response, body });
  });
  await page.route('**/build.json?*', (route) => route.fulfill({ json: deployed }));
  await page.route('**/sw.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: '' }),
  );
  await signUp(page);
  async function check() {
    await page.evaluate(async () => {
      // @ts-expect-error Vite serves source modules in E2E.
      const { checkForUpdates } = await import('/src/lib/updates.ts');
      await checkForUpdates();
    });
  }
  await check();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  deployed = { invalid: true };
  await check();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  deployed = { id: newer };
  await check();
  await expect(page.getByRole('dialog', { name: 'App update available' })).toBeVisible();
  await page.getByRole('button', { name: 'Later', exact: true }).click();
  await check();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/settings');
  await expect(page.getByRole('button', { name: 'Reload to update' })).toBeVisible();
});

test('protocol rejection prompts a client update even without build metadata and keeps offline work', async ({
  page,
}) => {
  await signUp(page);
  await page.route('**/api/compatibility', (route) => route.fulfill({ json: { min: 2, max: 2 } }));
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules in E2E.
    const { checkForUpdates } = await import('/src/lib/updates.ts');
    await checkForUpdates();
  });
  const prompt = page.getByRole('dialog', { name: 'Update required to sync' });
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', { name: 'Keep working offline' }).click();
  await expect(prompt).toHaveCount(0);
  await page.goto('/settings');
  await expect(
    page.getByText('Local tasks and queued changes stay on this device until sync resumes.'),
  ).toBeVisible();
});
