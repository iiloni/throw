import { randomUUID } from 'node:crypto';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { finger } from './board-helpers';
import { APP_LOAD_TIMEOUT, shapeRows, signUp } from './helpers';

type Headers = Record<string, string>;

/**
 * A parent whose subtasks are blocked: Approve schema (outside it) blocks Migrate data, which
 * blocks its sibling Flip flag. Write notes is free, and Clean cache has nothing to do with it.
 */
async function blockedSubtasks(page: Page) {
  const { headers } = await signUp(page);
  const request = page.request;
  const [ws] = await shapeRows(request, 'workspaces', headers);
  const workspaceId = String(ws?.id);
  const statuses = (
    [
      ['Backlog', 'backlog', true],
      ['Working', 'active', true],
      ['Review', 'active', false],
      ['Done', 'done', true],
      ['Cancelled', 'cancelled', true],
    ] as const
  ).map(([name, category, isDefault], index) => ({
    id: randomUUID(),
    name,
    category,
    isDefault,
    position: `a${index}`,
  }));
  const project = {
    id: randomUUID(),
    workspaceId,
    name: 'App',
    key: 'APP',
    color: 'teal',
    icon: null,
    position: 'a0',
    statuses,
  };
  expect((await request.post('/api/projects', { headers, data: project })).status()).toBe(201);
  const status = (name: string) => statuses.find((row) => row.name === name)!.id;
  const task = (title: string, statusName: string, position: string, parentId?: string) =>
    makeTask(request, headers, {
      projectId: project.id,
      title,
      statusId: status(statusName),
      position,
      parentId: parentId ?? null,
    });
  const parent = await task('Launch feature', 'Working', 'a0');
  const migrate = await task('Migrate data', 'Working', 'a0', parent);
  const flip = await task('Flip flag', 'Backlog', 'a1', parent);
  await task('Write notes', 'Backlog', 'a2', parent);
  const external = await task('Approve schema', 'Review', 'a0');
  await task('Clean cache', 'Working', 'a1');
  await blocks(request, headers, external, migrate);
  await blocks(request, headers, migrate, flip);

  await page.goto(`/w/${workspaceId}/p/${project.id}?view=board`);
  const parentCard = page.getByRole('article', { name: 'APP-1 Launch feature', exact: true });
  await expect(parentCard).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  const tab = page.getByRole('button', { name: /subtasks done/ });
  return {
    parentCard,
    externalCard: page.getByRole('article', { name: 'APP-5 Approve schema', exact: true }),
    unrelatedCard: page.getByRole('article', { name: 'APP-6 Clean cache', exact: true }),
    tab,
    mark: tab.locator('[data-subtasks-blocked]'),
    row: (title: string) => page.locator('[data-subtask-list] li').filter({ hasText: title }),
  };
}

async function makeTask(
  request: APIRequestContext,
  headers: Headers,
  task: {
    projectId: string;
    title: string;
    statusId: string;
    position: string;
    parentId: string | null;
  },
) {
  const id = randomUUID();
  const response = await request.post('/api/tasks', {
    headers,
    data: { id, priority: 3, description: null, descriptionVersion: null, ...task },
  });
  expect(response.status()).toBe(201);
  return id;
}

async function blocks(
  request: APIRequestContext,
  headers: Headers,
  blockerId: string,
  blockedId: string,
) {
  const response = await request.post('/api/task-relations', {
    headers,
    data: { id: randomUUID(), sourceTaskId: blockerId, targetTaskId: blockedId, kind: 'blocks' },
  });
  expect(response.status()).toBe(201);
}

test('a parent shows its blocked subtasks on its tab and spotlights their blockers', async ({
  page,
  isMobile,
}) => {
  const { parentCard, externalCard, unrelatedCard, tab, mark, row } = await blockedSubtasks(page);

  // Folded, the tab says how many subtasks are blocked; the parent itself is not.
  await expect(tab).toHaveAccessibleName('0 of 3 subtasks done, 2 subtasks blocked');
  await expect(mark).toHaveAttribute('data-subtasks-blocked', 'outside');
  await expect(mark).toHaveText('2');
  await expect(parentCard.locator('[data-blocked]')).toHaveCount(0);

  if (!isMobile) {
    // Lingering on the mark lights up every subtask's blockers, inside and outside the parent.
    await mark.hover();
    await expect(externalCard).toHaveAttribute('data-spotlight', 'blocker', { timeout: 3000 });
    await expect(parentCard).toHaveAttribute('data-spotlight', 'parent');
    await expect(unrelatedCard).toHaveAttribute('data-spotlight', 'dimmed');
    await expect(page.locator('[data-subtask-underlay]')).toHaveAttribute(
      'data-spotlight',
      'blocker',
    );
    await page.mouse.move(10, 10);
    await expect(externalCard).not.toHaveAttribute('data-spotlight');
  }

  // Unfolded, each blocked row carries its own mark.
  await tab.click();
  // The list springs open; it is at rest once the spring hands its height back.
  await expect
    .poll(() => page.locator('[data-subtask-list]').evaluate((list) => list.style.height))
    .toBe('');
  await expect(row('Migrate data').locator('[data-blocked]')).toHaveAccessibleName(
    'Blocked by APP-5',
  );
  await expect(row('Flip flag').locator('[data-blocked]')).toHaveAccessibleName('Blocked by APP-2');
  await expect(row('Write notes').locator('[data-blocked]')).toHaveCount(0);
  if (isMobile) return;

  // A row's mark lights up that subtask's own blockers: its sibling, not the outside task.
  await row('Flip flag').locator('[data-blocked]').hover();
  await expect(row('Migrate data')).toHaveAttribute('data-spotlight', 'blocker', {
    timeout: 3000,
  });
  await expect(externalCard).toHaveAttribute('data-spotlight', 'dimmed');
  await expect(parentCard).toHaveAttribute('data-spotlight', 'parent');
  await page.mouse.move(10, 10);
  await expect(row('Migrate data')).not.toHaveAttribute('data-spotlight');

  // The parent's pane marks the same subtasks.
  await parentCard.click();
  const pane = page.getByLabel('Task', { exact: true });
  const subtasks = pane.getByRole('region', { name: 'Subtasks' });
  await expect(
    subtasks.getByRole('article', { name: 'APP-3 Flip flag' }).locator('[data-blocked]'),
  ).toHaveAccessibleName('Blocked by APP-2');
  await expect(
    subtasks.getByRole('article', { name: 'APP-4 Write notes' }).locator('[data-blocked]'),
  ).toHaveCount(0);
});

test.describe('on a touch tablet', () => {
  test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true });

  test('holding the tab mark spotlights the blockers without folding the tab', async ({
    page,
    isMobile,
    browserName,
  }) => {
    test.skip(isMobile, 'A phone pages its columns, and leaves the tab to its tap');
    test.skip(browserName !== 'chromium', 'Real touches come through Chromium’s input domain');
    const { externalCard, tab, mark } = await blockedSubtasks(page);
    const touch = await finger(page);

    await touch.press(mark, 700);
    await expect(externalCard).toHaveAttribute('data-spotlight', 'blocker');
    await touch.lift();
    await expect(externalCard).not.toHaveAttribute('data-spotlight');
    await page.waitForTimeout(300);
    await expect(tab).toHaveAttribute('aria-expanded', 'false');

    await touch.tap(mark);
    await expect(tab).toHaveAttribute('aria-expanded', 'true');
  });
});
