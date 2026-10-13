import { expect, type Page, test } from '@playwright/test';
import { APP_LOAD_TIMEOUT, shapeRows, signUp, waitForShapeRow } from './helpers';

async function openMenu(page: Page, isMobile: boolean) {
  await page
    .getByRole('button', {
      name: isMobile ? 'Switch project or workspace' : 'Switch workspace',
      exact: true,
    })
    .click();
}
async function addProject(page: Page, name: string, isMobile: boolean) {
  if (isMobile) {
    await openMenu(page, isMobile);
    await page.getByRole('menuitem', { name: 'New project', exact: true }).click();
  } else await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function selectProject(page: Page, name: string, isMobile: boolean) {
  if (isMobile) {
    await openMenu(page, isMobile);
    await page.getByRole('menuitem', { name, exact: true }).click();
  } else
    await page
      .getByRole('navigation', { name: 'Projects', exact: true })
      .getByRole('link', { name, exact: true })
      .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}
async function selectWorkspace(page: Page, name: string, isMobile: boolean) {
  await openMenu(page, isMobile);
  await page.getByRole('menuitem', { name, exact: true }).click();
}

test('create, edit and confirm deletion of a project from the shell', async ({
  page,
  isMobile,
}) => {
  const { headers } = await signUp(page);
  await addProject(page, 'Kitchen refit', isMobile);
  const projectUrl = page.url();
  await expect
    .poll(async () => (await shapeRows(page.request, 'projects', headers)).map((row) => row.name))
    .toEqual(['Kitchen refit']);
  await page.getByRole('button', { name: 'Edit project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('New kitchen');
  await page.getByRole('button', { name: 'Blue', exact: true }).click();
  await page.getByRole('button', { name: 'Home icon', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('New kitchen');
  await expect(page.getByRole('button', { name: 'Edit project', exact: true })).toBeFocused();
  expect(page.url()).toBe(projectUrl);
  await expect
    .poll(async () =>
      (await shapeRows(page.request, 'projects', headers)).map(({ name, color, icon }) => ({
        name,
        color,
        icon,
      })),
    )
    .toEqual([{ name: 'New kitchen', color: 'blue', icon: 'house' }]);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('New kitchen', {
    timeout: APP_LOAD_TIMEOUT,
  });
  await page.getByRole('button', { name: 'Edit project', exact: true }).click();
  await page.getByRole('button', { name: 'Delete project', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Delete New kitchen?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep project' }).click();
  await page.getByRole('button', { name: 'Delete project', exact: true }).click();
  await page.getByRole('button', { name: 'Delete project', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your first project' })).toBeVisible();
  await expect.poll(() => shapeRows(page.request, 'projects', headers)).toEqual([]);
});

test('switch projects and workspaces; restore the last project on reload and first load', async ({
  page,
  isMobile,
}) => {
  const { headers } = await signUp(page);
  await addProject(page, 'Kitchen', isMobile);
  const kitchenUrl = page.url();
  await addProject(page, 'Garden', isMobile);
  await selectProject(page, 'Kitchen', isMobile);
  await openMenu(page, isMobile);
  await page.getByRole('menuitem', { name: 'New workspace', exact: true }).click();
  await page.getByLabel('Workspace name').fill('Work');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Work');
  await addProject(page, 'Launch', isMobile);
  const launchUrl = page.url();
  await openMenu(page, isMobile);
  await page.getByRole('menuitem', { name: 'Rename workspace', exact: true }).click();
  await page.getByLabel('Workspace name').fill('Studio');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect
    .poll(async () =>
      (await shapeRows(page.request, 'workspaces', headers)).map((row) => row.name).sort(),
    )
    .toEqual(['Personal', 'Studio']);
  await selectWorkspace(page, 'Personal', isMobile);
  await expect(page).toHaveURL(kitchenUrl);
  await selectWorkspace(page, 'Studio', isMobile);
  await expect(page).toHaveURL(launchUrl);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Launch', {
    timeout: APP_LOAD_TIMEOUT,
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.entries(localStorage)
          .filter(([key]) => key.startsWith('throw-navigation-'))
          .map(([, value]) => JSON.parse(value).workspaceId),
      ),
    )
    .toEqual([new URL(launchUrl).pathname.split('/')[2]]);
  await page.goto('/');
  await expect(page).toHaveURL(launchUrl);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Launch');
  await selectWorkspace(page, 'Personal', isMobile);
  // A new device has no preference: it opens the first project by position.
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage))
      if (key.startsWith('throw-navigation-')) localStorage.removeItem(key);
  });
  await page.goto('/');
  await expect(page).toHaveURL(kitchenUrl);
  const rows = await shapeRows(page.request, 'projects', headers);
  expect(rows.find((row) => row.name === 'Kitchen')?.position).toBeTruthy();
});

test('phone dock selects tabs, scrubs, and keeps the project and view on reload', async ({
  page,
  isMobile,
  browserName,
}) => {
  test.skip(!isMobile && browserName !== 'firefox', 'The dock belongs to the phone layout.');
  if (!isMobile) await page.setViewportSize({ width: 412, height: 915 });
  await signUp(page);
  await addProject(page, 'Kitchen', true);
  const dock = page.getByRole('navigation', { name: 'Project views' });
  for (const label of ['Backlog', 'Search', 'Board']) {
    await dock.getByRole('link', { name: label, exact: true }).click();
    await expect(dock.getByRole('link', { name: label, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(
      label === 'Board' ? 'Project board' : label,
    );
  }
  const start = await dock.getByRole('link', { name: 'Board', exact: true }).boundingBox();
  const end = await dock.getByRole('link', { name: 'Backlog', exact: true }).boundingBox();
  if (!start || !end) throw new Error('Dock tabs have no bounds');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(dock.getByRole('link', { name: 'Backlog', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const url = page.url();
  await page.reload();
  await expect(dock.getByRole('link', { name: 'Backlog', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
    { timeout: APP_LOAD_TIMEOUT },
  );
  expect(page.url()).toBe(url);
});

test('cross-project board and settings are reachable from the shell', async ({
  page,
  isMobile,
}) => {
  await signUp(page);
  await addProject(page, 'Kitchen', isMobile);
  if (isMobile) {
    await openMenu(page, true);
    await page.getByRole('menuitem', { name: 'All projects', exact: true }).click();
  } else await page.getByRole('link', { name: 'All projects', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'One board, every project' })).toBeVisible();
  await expect(page).toHaveURL(/\/w\/[^/]+\/board(?:\?view=board)?$/);
  if (isMobile) {
    const dock = page.getByRole('navigation', { name: 'Project views' });
    await dock.getByRole('link', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Search');
    await expect(page).toHaveURL(/\/board\?view=search$/);
    await dock.getByRole('link', { name: 'Backlog', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kitchen');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Backlog');
  }
  if (isMobile) {
    await openMenu(page, true);
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  } else await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await selectProject(page, 'Kitchen', isMobile);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kitchen');
});

test('rail defaults to the available width and remembers a keyboard toggle', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop navigation uses a rail.');
  await page.setViewportSize({ width: 1024, height: 800 });
  await signUp(page);
  const rail = page.getByRole('complementary', { name: 'Navigation rail' });
  await expect(rail).toHaveAttribute('data-expanded', 'false');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(rail).toHaveAttribute('data-expanded', 'true');
  await page.getByRole('button', { name: 'Collapse navigation' }).focus();
  await page.keyboard.press('Enter');
  await expect(rail).toHaveAttribute('data-expanded', 'false');
  await page.reload();
  await expect(rail).toHaveAttribute('data-expanded', 'false', { timeout: APP_LOAD_TIMEOUT });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Expand navigation' }).click();
  await expect(rail).toHaveAttribute('data-expanded', 'true');
  await openMenu(page, false);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Switch workspace' })).toBeFocused();
});

test('offline workspace and project edits survive reload and replay in order', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(120_000);
  test.skip(isMobile, 'The outbox does not depend on the layout; other tests cover both layouts.');
  const { headers } = await signUp(page);
  const initialSync = waitForShapeRow(page, 'projects', 'Existing');
  await addProject(page, 'Existing', false);
  await initialSync;
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Existing', {
    timeout: APP_LOAD_TIMEOUT,
  });
  await expect
    .poll(async () => (await shapeRows(page.request, 'projects', headers)).map((row) => row.name))
    .toEqual(['Existing']);
  await page.route('**/api/**', (route) => route.abort('connectionfailed'));
  await openMenu(page, false);
  await page.getByRole('menuitem', { name: 'New workspace', exact: true }).click();
  await page.getByLabel('Workspace name').fill('Offline studio');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Offline studio');
  await addProject(page, 'Written offline', false);
  await page.getByRole('button', { name: 'Edit project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Edited offline');
  await page.getByRole('button', { name: 'Teal', exact: true }).click();
  await page.getByRole('button', { name: 'Launch icon', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toContainText('unsaved', { timeout: 40_000 });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edited offline', {
    timeout: APP_LOAD_TIMEOUT,
  });
  await selectWorkspace(page, 'Personal', false);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Existing');
  await selectWorkspace(page, 'Offline studio', false);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edited offline');
  await page.unroute('**/api/**');
  await expect
    .poll(
      async () =>
        (await shapeRows(page.request, 'projects', headers))
          .map(({ name, color, icon }) => ({ name, color, icon }))
          .sort((a, b) => String(a.name).localeCompare(String(b.name))),
      { timeout: 60_000 },
    )
    .toEqual([
      { name: 'Edited offline', color: 'teal', icon: 'rocket' },
      { name: 'Existing', color: 'red', icon: null },
    ]);
  await expect(page.getByRole('status')).toHaveCount(0);
});
