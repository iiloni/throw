import { type CDPSession, expect, type Page, test } from '@playwright/test';
import { fixture } from './board-helpers';
import { APP_LOAD_TIMEOUT, signUp, switcherItem } from './helpers';

async function pullSettings(
  touch: CDPSession,
  delta: number,
  options: { y?: number; whileHeld?: () => Promise<void> } = {},
) {
  const startY = options.y ?? 240;
  let timestamp = Date.now() / 1000;
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 24, y: startY }],
    timestamp,
  });
  const distances = [4, 10, 20, 40, 60, 90, 120, 150].filter(
    (distance) => distance <= Math.abs(delta),
  );
  for (const distance of distances) {
    // A short pull must be slow: a quick flick also dismisses the surface.
    timestamp += Math.abs(delta) < 110 ? 0.08 : 0.016;
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: 24, y: startY + Math.sign(delta) * distance }],
      timestamp,
    });
  }
  // Rest before release so short pulls are not mistaken for a fling.
  await new Promise((resolve) => setTimeout(resolve, 200));
  timestamp += 0.2;
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: 24, y: startY + delta }],
    timestamp,
  });
  await options.whileHeld?.();
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
    timestamp: timestamp + 0.016,
  });
}

async function layerTop(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => element.getBoundingClientRect().top);
}

/** Wait for any page view transition and drawer scrim fade to clear before starting a touch gesture. */
async function waitForSwipeReady(page: Page, y = 240) {
  await expect
    .poll(() =>
      page.evaluate((pointY) => {
        if (document.documentElement.matches(':active-view-transition')) return false;
        const swipe = document.querySelector('[data-settings-swipe]');
        const hit = document.elementFromPoint(24, pointY);
        return Boolean(swipe && hit && swipe.contains(hit));
      }, y),
    )
    .toBe(true);
}

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
      await (await switcherItem(page, 'New project')).click();
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
    await (await switcherItem(page, 'Settings')).click();
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

test('mobile settings pull-down dismisses app settings, project settings, and trash back to the board', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Settings pull-down dismiss is for the narrow mobile layout.');
  const { workspaceId, projectId } = await fixture(page, true);
  const boardUrl = new RegExp(`/w/${workspaceId}/p/${projectId}`);
  const touch = await page.context().newCDPSession(page);

  const openFromSwitcher = async (item: string) => {
    await page.getByRole('button', { name: 'Switch project or workspace', exact: true }).click();
    await (await switcherItem(page, item)).click();
  };

  // App settings: content follows the pull while the fixed dock stays put, and release returns to the board.
  await openFromSwitcher('Settings');
  await expect(page).toHaveURL(/\/settings\/general$/);
  await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings page: General' })).toBeVisible();
  await waitForSwipeReady(page);
  const restContentTop = await layerTop(page, '[data-settings-content]');
  const restDockTop = await layerTop(page, '[data-drawer]');
  await pullSettings(touch, 150, {
    whileHeld: async () => {
      await expect
        .poll(() => layerTop(page, '[data-settings-content]'))
        .toBeGreaterThan(restContentTop + 40);
      expect(Math.abs((await layerTop(page, '[data-drawer]')) - restDockTop)).toBeLessThan(2);
    },
  });
  await expect(page).toHaveURL(boardUrl);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Real board');

  // Project settings: pulling down returns to the board.
  await openFromSwitcher('Project settings');
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/p/${projectId}/settings`));
  await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible();
  await waitForSwipeReady(page);
  await pullSettings(touch, 150);
  await expect(page).toHaveURL(boardUrl);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Real board');

  // Project trash: open via settings picker, then pulling down returns to the board.
  await openFromSwitcher('Project settings');
  await page.getByRole('button', { name: 'Settings page: General' }).click();
  await page
    .getByRole('dialog', { name: 'Settings', exact: true })
    .getByRole('link', { name: 'Trash', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/p/${projectId}/trash$`));
  await expect(page.getByRole('heading', { name: 'Trash', exact: true })).toBeVisible();
  await waitForSwipeReady(page);
  await pullSettings(touch, 150);
  await expect(page).toHaveURL(boardUrl);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Real board');

  // Pulling up from the bottom of a settings page also dismisses back to the board.
  await openFromSwitcher('Settings');
  await page.getByRole('button', { name: 'Settings page: General' }).click();
  await page
    .getByRole('dialog', { name: 'Settings', exact: true })
    .getByRole('link', { name: 'Account', exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings\/account$/);
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await waitForSwipeReady(page, 400);
  await pullSettings(touch, -150, { y: 400 });
  await expect(page).toHaveURL(boardUrl);
});

test('mobile settings scroll normally, keep short pulls open, and ignore pulls under a drawer dialog', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Settings pull-down dismiss is for the narrow mobile layout.');
  await page.setViewportSize({ width: 393, height: 500 });
  const { workspaceId, projectId } = await fixture(page, true);
  await page.getByRole('button', { name: 'Switch project or workspace', exact: true }).click();
  await (await switcherItem(page, 'Settings')).click();
  await expect(page).toHaveURL(/\/settings\/general$/);
  await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Appearance' })).toBeVisible();
  await waitForSwipeReady(page);
  const settingsUrl = page.url();
  const touch = await page.context().newCDPSession(page);

  // Short slow pull springs back cleanly and stays on settings.
  await pullSettings(touch, 40);
  await expect(page).toHaveURL(settingsUrl);
  await expect(page.locator('[data-settings-content]')).toHaveCSS('transform', 'none');

  // Upward drag at the top scrolls into the page instead of leaving it.
  await pullSettings(touch, -150, { y: 340 });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(50);
  await expect(page).toHaveURL(settingsUrl);

  // Downward drag while scrolled down scrolls back up instead of dismissing.
  const middle = await page.evaluate(() => {
    const scroll = document.documentElement;
    const top = Math.max(120, (scroll.scrollHeight - scroll.clientHeight) / 2);
    window.scrollTo(0, top);
    return window.scrollY;
  });
  expect(middle).toBeGreaterThan(50);
  await pullSettings(touch, 150);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(middle - 40);
  await expect(page).toHaveURL(settingsUrl);

  // When a ManagementSurface dialog is open on top, pulling down does not dismiss settings.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: 'Settings page: General' }).click();
  const picker = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(picker).toBeVisible();
  await pullSettings(touch, 150, { y: 180 });
  await expect(page).toHaveURL(settingsUrl);
  await expect(picker).toBeVisible();

  // Closing the dialog restores pull-down dismiss back to the board.
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await waitForSwipeReady(page);
  await pullSettings(touch, 150);
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/p/${projectId}`));
});
