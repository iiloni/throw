import { expect, type Locator, type Page, test } from '@playwright/test';
import { APP_LOAD_TIMEOUT, signUp } from './helpers';

async function contrast(locator: Locator, ink: 'color' | 'borderColor', surface: 'self' | 'page') {
  return locator.evaluate(
    (element, { ink, surface }) => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      const luminance = (color: string) => {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b] = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((channel) => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return r! * 0.2126 + g! * 0.7152 + b! * 0.0722;
      };
      const style = getComputedStyle(element);
      const foreground = luminance(style[ink]);
      const background = luminance(
        getComputedStyle(surface === 'self' ? element : document.body).backgroundColor,
      );
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    },
    { ink, surface },
  );
}

/** Whether the element's fill is the jade selected surface rather than a neutral one. */
async function paintedWithAccent(locator: Locator) {
  return locator.evaluate((element) => {
    const probe = document.createElement('span');
    probe.style.backgroundColor = 'var(--accent)';
    document.body.append(probe);
    const accent = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return getComputedStyle(element).backgroundColor === accent;
  });
}

async function openPhoneMenu(page: Page) {
  await page.getByRole('button', { name: 'Switch project or workspace', exact: true }).click();
}

async function addProject(page: Page, name: string, phone: boolean) {
  if (phone) {
    await openPhoneMenu(page);
    await page.getByRole('menuitem', { name: 'New project', exact: true }).click();
  } else await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}

async function checkControlContrast(page: Page) {
  const primary = page.getByRole('button', { name: 'Sign in', exact: true });
  const link = page.getByRole('button', { name: 'Need an account? Sign up' });
  expect(await contrast(primary, 'color', 'self')).toBeGreaterThanOrEqual(4.5);
  expect(await contrast(link, 'color', 'page')).toBeGreaterThanOrEqual(4.5);
  await primary.hover();
  await primary.evaluate(async (element) => {
    // Flush the hover style before waiting for its color transition's painted result.
    getComputedStyle(element).backgroundColor;
    await Promise.allSettled(element.getAnimations().map((animation) => animation.finished));
  });
  expect(await contrast(primary, 'color', 'self')).toBeGreaterThanOrEqual(4.5);
  await page.keyboard.press('Tab');
  const email = page.getByRole('textbox', { name: 'Email', exact: true });
  await expect(email).toBeFocused();
  await expect.poll(() => contrast(email, 'borderColor', 'page')).toBeGreaterThanOrEqual(3);
}

test('brand surfaces preserve artwork, contrast and usable layout on light and dark themes', async ({
  page,
  isMobile,
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
  await checkControlContrast(page);
  await page.screenshot({ path: info.outputPath('login-light.png') });

  // A stored preference must win over the OS, and a reload must paint the right ink.
  await page.evaluate(() => localStorage.setItem('throw-theme', '"dark"'));
  await page.reload();
  await expect(brand).toHaveAttribute(
    'src',
    '/wordmarks/throw-lockup-horizontal-stable-light-small.svg',
  );
  await checkControlContrast(page);
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
  await expect(page.getByRole('heading', { name: 'Personal' })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
  // The rail carries the brand; the phone layout has no rail and names the workspace instead.
  if (isMobile) await expect(brand).toHaveCount(0);
  else {
    const rail = page.getByRole('complementary', { name: 'Navigation rail', exact: true });
    await expect(rail.getByRole('img', { name: 'Throw', exact: true })).toHaveAttribute(
      'src',
      '/wordmarks/throw-lockup-horizontal-stable-light-micro.svg',
    );
    await expect(brand).toHaveCount(1);
    await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
    await expect(brand).toHaveAttribute('src', '/favicon-mark.svg');
    await expect
      .poll(() =>
        brand.evaluate(
          (image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
        ),
      )
      .toBe(true);
    // The mark shares the collapsed rail's icon column.
    await expect
      .poll(async () => {
        const mark = await brand.boundingBox();
        const settings = await page
          .getByRole('link', { name: 'Settings', exact: true })
          .boundingBox();
        return Math.abs(mark!.x + mark!.width / 2 - (settings!.x + settings!.width / 2));
      })
      .toBeLessThan(1);
    await page.screenshot({ path: info.outputPath('shell-collapsed-dark.png') });
    await page.getByRole('button', { name: 'Expand navigation', exact: true }).click();
    await expect(brand).toHaveAttribute(
      'src',
      '/wordmarks/throw-lockup-horizontal-stable-light-micro.svg',
    );
  }

  await addProject(page, 'Brand check', isMobile);
  const selected = isMobile
    ? page
        .getByRole('navigation', { name: 'Project views', exact: true })
        .locator('a[aria-current="page"] > span[aria-hidden]')
    : page
        .getByRole('navigation', { name: 'Projects', exact: true })
        .getByRole('link', { name: 'Brand check', exact: true });
  await expect.poll(() => paintedWithAccent(selected)).toBe(true);
  if (!isMobile) expect(await contrast(selected, 'color', 'self')).toBeGreaterThanOrEqual(4.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath('shell-dark.png') });

  if (isMobile) {
    await openPhoneMenu(page);
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  } else {
    const settings = page.getByRole('link', { name: 'Settings', exact: true });
    await settings.click();
    await expect.poll(() => paintedWithAccent(settings)).toBe(true);
    // Selection moves with the route: the project left behind returns to the neutral rail.
    await expect.poll(() => paintedWithAccent(selected)).toBe(false);
  }
  const theme = page.getByRole('button', { name: 'Dark', exact: true, pressed: true });
  await expect.poll(() => paintedWithAccent(theme)).toBe(true);
  expect(await contrast(theme, 'color', 'self')).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: info.outputPath('settings-dark.png') });

  // Sync feedback shares the phone header's first line with the workspace name.
  await page.setViewportSize({ width: 320, height: 800 });
  // Development has no service worker: keep artwork/code reachable and block the API,
  // as the repository's offline tests do. Production precaches every fallback asset.
  await page.route('**/api/**', (route) => route.abort());
  await addProject(page, 'Offline brand check', true);
  await expect(page.getByRole('status')).toContainText('Offline');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath('header-offline-narrow.png') });
});
