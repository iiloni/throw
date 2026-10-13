import { expect, test } from '@playwright/test';
import { signUp } from './helpers';

test('brand surfaces preserve artwork, contrast and usable layout on light and dark themes', async ({
  page,
}, info) => {
  test.info().annotations.push({
    type: 'browser',
    description: page.context().browser()?.version() ?? 'unknown',
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => {
    if (!localStorage.getItem('throw-theme')) localStorage.setItem('throw-theme', '"light"');
  });
  await page.goto('/login');
  const brand = page.getByRole('img', { name: 'Throw', exact: true });
  await expect(brand).toHaveAttribute(
    'src',
    '/wordmarks/throw-lockup-horizontal-stable-dark-small.svg',
  );
  await expect(brand).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Throw', exact: true })).toHaveCount(1);
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute(
    'href',
    '/dev/favicon-mark.svg',
  );
  await expect
    .poll(() =>
      brand.evaluate(
        (image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await page.screenshot({ path: info.outputPath('login-light.png') });

  // A stored preference must win over the OS, and a reload must paint the right ink.
  await page.evaluate(() => localStorage.setItem('throw-theme', '"dark"'));
  await page.reload();
  await expect(brand).toHaveAttribute(
    'src',
    '/wordmarks/throw-lockup-horizontal-stable-light-small.svg',
  );
  await page.screenshot({ path: info.outputPath('login-dark.png') });

  await page.goto('/setup');
  await expect(brand).toHaveAttribute(
    'src',
    '/wordmarks/throw-lockup-stacked-stable-light-small.svg',
  );
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('setup-dark.png') });

  await signUp(page);
  await page.evaluate(() => localStorage.setItem('throw-theme', '"dark"'));
  await page.reload();
  await expect(brand).toHaveAttribute(
    'src',
    '/wordmarks/throw-lockup-horizontal-stable-light-micro.svg',
  );
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath('header-dark.png') });

  // Sync feedback competes with branding and sign-out on the narrowest phone widths.
  await page.setViewportSize({ width: 320, height: 800 });
  // Development has no service worker: keep artwork/code reachable and block the API,
  // as the repository's offline tests do. Production precaches every fallback asset.
  await page.route('**/api/**', (route) => route.abort());
  await page.getByRole('textbox', { name: 'New project in Personal' }).fill('Offline brand check');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Offline');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(brand).toHaveAttribute('src', '/favicon-mark.svg');
  await expect
    .poll(() =>
      brand.evaluate(
        (image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await page.screenshot({ path: info.outputPath('header-offline-narrow.png') });
});
