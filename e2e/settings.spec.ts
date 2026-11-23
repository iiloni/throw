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
    // Empty workspace has no project section or Back to board link.
    await expect(picker.getByRole('link', { name: 'Back to board' })).toHaveCount(0);
    await expect(picker.getByRole('link', { name: 'Account', exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('settings-pages.png') });
    await picker.getByRole('link', { name: 'Account', exact: true }).click();
    await expect(picker).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Settings page: Account' })).toBeVisible();
  } else {
    const nav = page.getByRole('navigation', { name: 'Settings pages' });
    await expect(nav.getByRole('link', { name: 'Back to board' })).toHaveCount(0);
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

test('a dev build switches its app icon and restores the choice before the app loads', async ({
  page,
}) => {
  await signUp(page);
  await page.goto('/settings/general');
  const section = page.getByRole('region', { name: 'App icon' });
  const preview = section.getByRole('img', { name: /app icon$/ });
  const favicon = page.locator('link[rel="icon"][type="image/svg+xml"]');
  await expect(section.getByRole('button', { name: 'Dev', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(preview).toHaveAttribute('src', '/dev/pwa-512x512.png');
  await expect(favicon).toHaveAttribute('href', '/dev/favicon-mark.svg');

  for (const [icon, base] of [
    ['Preview', '/preview'],
    ['Dev', '/dev'],
    ['Stable', ''],
  ] as const) {
    await section.getByRole('button', { name: icon, exact: true }).click();
    await expect(section.getByRole('button', { name: icon, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(preview).toHaveAttribute('src', `${base}/pwa-512x512.png`);
    await expect(preview).toHaveAccessibleName(`${icon} app icon`);
    await expect(favicon).toHaveAttribute('href', `${base}/favicon-mark.svg`);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      `${base}/apple-touch-icon.png`,
    );
    await expect
      .poll(() =>
        preview.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth),
      )
      .toBe(512);
    // Screenshots wait for the selection indicator to settle under the chosen button.
    const chosen = section.getByRole('button', { name: icon, exact: true });
    await expect
      .poll(() =>
        chosen.evaluate((button) => {
          const indicator = button.querySelector('span[aria-hidden]');
          const a = indicator?.getBoundingClientRect();
          const b = button.getBoundingClientRect();
          return a ? Math.abs(a.left - b.left) + Math.abs(a.width - b.width) : Infinity;
        }),
      )
      .toBeLessThan(0.5);
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      // Let the labels' color transitions finish in the new theme.
      await section.evaluate(async (element) => {
        getComputedStyle(element).color;
        await Promise.allSettled(
          element.getAnimations({ subtree: true }).map((animation) => animation.finished),
        );
      });
      await section.screenshot({
        path: test.info().outputPath(`app-icon-${icon.toLowerCase()}-${theme}.png`),
      });
    }
    await page.emulateMedia({ colorScheme: null });
  }

  // index.html restores the choice on its own, before (or without) the app's code.
  await page.route('**/src/main.tsx', (route) => route.abort());
  await page.reload();
  await expect(favicon).toHaveAttribute('href', '/favicon-mark.svg');
  await page.unroute('**/src/main.tsx');
  await page.reload();
  await expect(section.getByRole('button', { name: 'Stable', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: APP_LOAD_TIMEOUT },
  );
});

test('unified settings hub lists the active project alongside User settings and returns to its board', async ({
  page,
  isMobile,
}) => {
  await signUp(page);
  const addProject = async (name: string) => {
    if (isMobile) {
      await page.getByRole('button', { name: 'Switch project or workspace', exact: true }).click();
      await page.getByRole('menuitem', { name: 'New project', exact: true }).click();
    } else await page.getByRole('button', { name: 'New project', exact: true }).click();
    await page.getByLabel('Project name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name, {
      timeout: APP_LOAD_TIMEOUT,
    });
  };
  await addProject('Kitchen');
  await addProject('Garden');

  if (isMobile) {
    await page.getByRole('button', { name: 'Switch project or workspace', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  } else await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/general$/);

  const openList = async (currentLabel: string) => {
    if (isMobile) {
      await page.getByRole('button', { name: `Settings page: ${currentLabel}` }).click();
      return page.getByRole('dialog', { name: 'Settings', exact: true });
    }
    return page.getByRole('navigation', { name: 'Settings pages' });
  };

  const list = await openList('General');
  const gardenGroup = list.getByRole('region', { name: 'Garden' });
  for (const label of ['General', 'Statuses', 'Priorities', 'Tags', 'Trash']) {
    await expect(gardenGroup.getByRole('link', { name: label, exact: true })).toBeVisible();
  }
  await expect(list.getByRole('region', { name: 'User' })).toBeVisible();
  await gardenGroup.getByRole('link', { name: 'Statuses', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Statuses', exact: true })).toBeVisible();

  const listOnStatuses = await openList('Statuses');
  await listOnStatuses.getByRole('link', { name: 'Account', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/account$/);

  const listOnAccount = await openList('Account');
  await listOnAccount.getByRole('link', { name: 'Back to board', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Garden');

  if (!isMobile) {
    await page.setViewportSize({ width: 1366, height: 768 });
    const rail = page.getByRole('complementary', { name: 'Navigation rail' });
    await rail.getByRole('button', { name: 'Project menu for Kitchen', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Project settings', exact: true }).click();
    const nav = page.getByRole('navigation', { name: 'Settings pages' });
    await expect(nav.getByRole('region', { name: 'Kitchen' })).toBeVisible();
    await expect(nav.getByRole('region', { name: 'User' })).toBeVisible();
    await expect(rail.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  }
});
