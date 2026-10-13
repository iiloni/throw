import { expect, type Page, test } from '@playwright/test';
import { APP_LOAD_TIMEOUT, shapeRows, signUp } from './helpers';

async function addProject(page: Page, name: string) {
  await page.getByLabel('New project in Personal').fill(name);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('listitem').filter({ hasText: name })).toBeVisible();
}

test('a new project reaches the server and survives a reload', async ({ page }) => {
  const { headers } = await signUp(page);
  await addProject(page, 'Kitchen refit');
  await expect
    .poll(async () => (await shapeRows(page.request, 'projects', headers)).map((row) => row.name))
    .toEqual(['Kitchen refit']);

  await page.reload();
  await expect(page.getByRole('listitem').filter({ hasText: 'Kitchen refit' })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });

  await page.getByRole('button', { name: 'Delete Kitchen refit' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(0);
  await expect.poll(() => shapeRows(page.request, 'projects', headers)).toEqual([]);
});

test('a project made without a connection is kept and sent once the server answers', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'The outbox does not depend on the layout.');
  const { headers } = await signUp(page);

  // The dev server has no service worker, so "offline" is the API going unanswered.
  await page.route('**/api/projects', (route) => route.abort('connectionfailed'));
  await addProject(page, 'Written offline');
  await expect(page.getByRole('status')).toContainText('unsaved');
  expect(await shapeRows(page.request, 'projects', headers)).toEqual([]);

  // The write is in the outbox on the device, not only in the page's memory.
  await page.reload();
  await expect(page.getByRole('listitem').filter({ hasText: 'Written offline' })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });

  await page.unroute('**/api/projects');
  await expect
    .poll(async () => (await shapeRows(page.request, 'projects', headers)).map((row) => row.name), {
      timeout: 60_000,
    })
    .toEqual(['Written offline']);
  await expect(page.getByRole('status')).toHaveCount(0);
});
