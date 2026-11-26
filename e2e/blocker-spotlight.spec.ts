import { randomUUID } from 'node:crypto';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { APP_LOAD_TIMEOUT, shapeRows, signUp } from './helpers';

type Headers = Record<string, string>;

async function makeProject(
  request: APIRequestContext,
  headers: Headers,
  workspaceId: string,
  key: string,
  name: string,
  statuses: {
    name: string;
    category: 'backlog' | 'active' | 'done' | 'cancelled';
    isDefault: boolean;
  }[],
) {
  const project = {
    id: randomUUID(),
    workspaceId,
    name,
    key,
    color: key === 'APP' ? 'teal' : 'orange',
    icon: null,
    position: key === 'APP' ? 'a0' : 'a1',
    statuses: statuses.map((status, index) => ({
      id: randomUUID(),
      ...status,
      position: `a${index}`,
    })),
  };
  expect((await request.post('/api/projects', { headers, data: project })).status()).toBe(201);
  const statusId = (nameToFind: string) =>
    project.statuses.find((row) => row.name === nameToFind)!.id;
  return { ...project, statusId };
}

async function makeTask(
  request: APIRequestContext,
  headers: Headers,
  projectId: string,
  title: string,
  statusId: string,
  position: string,
  parentId: string | null = null,
) {
  const id = randomUUID();
  const response = await request.post('/api/tasks', {
    headers,
    data: {
      id,
      projectId,
      title,
      statusId,
      priority: 3,
      position,
      parentId,
      description: null,
      descriptionVersion: null,
    },
  });
  expect(response.status()).toBe(201);
  return id;
}

async function addBlocksRelation(
  request: APIRequestContext,
  headers: Headers,
  blockerId: string,
  blockedId: string,
) {
  const response = await request.post('/api/task-relations', {
    headers,
    data: {
      id: randomUUID(),
      sourceTaskId: blockerId,
      targetTaskId: blockedId,
      kind: 'blocks',
    },
  });
  expect(response.status()).toBe(201);
}

test('lingering on a blocked card badge spotlights blockers, highlights collapsed strips, and clears immediately', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Blocker spotlight is a desktop hover interaction');

  const { headers } = await signUp(page);
  const [ws] = await shapeRows(page.request, 'workspaces', headers);
  const workspaceId = String(ws?.id);

  const app = await makeProject(page.request, headers, workspaceId, 'APP', 'App', [
    { name: 'Backlog', category: 'backlog', isDefault: true },
    { name: 'Working', category: 'active', isDefault: true },
    { name: 'Review', category: 'active', isDefault: false },
    { name: 'Done', category: 'done', isDefault: true },
    { name: 'Cancelled', category: 'cancelled', isDefault: true },
  ]);
  const ops = await makeProject(page.request, headers, workspaceId, 'OPS', 'Operations', [
    { name: 'Backlog', category: 'backlog', isDefault: true },
    { name: 'Working', category: 'active', isDefault: true },
    { name: 'Done', category: 'done', isDefault: true },
    { name: 'Cancelled', category: 'cancelled', isDefault: true },
  ]);

  const blocked = await makeTask(
    page.request,
    headers,
    app.id,
    'Ship the release',
    app.statusId('Working'),
    'a0',
  );
  const visibleBlocker = await makeTask(
    page.request,
    headers,
    app.id,
    'Finish the API',
    app.statusId('Working'),
    'a1',
  );
  const collapsedBlocker = await makeTask(
    page.request,
    headers,
    app.id,
    'Sign off QA',
    app.statusId('Review'),
    'a2',
  );
  const backlogBlocker = await makeTask(
    page.request,
    headers,
    app.id,
    'Prepare rollout checklist',
    app.statusId('Backlog'),
    'a3',
  );
  await makeTask(page.request, headers, app.id, 'Write changelog', app.statusId('Working'), 'a4');
  const opsBlocker = await makeTask(
    page.request,
    headers,
    ops.id,
    'Rotate keys',
    ops.statusId('Working'),
    'a0',
  );

  await addBlocksRelation(page.request, headers, visibleBlocker, blocked);
  await addBlocksRelation(page.request, headers, collapsedBlocker, blocked);
  await addBlocksRelation(page.request, headers, backlogBlocker, blocked);
  await addBlocksRelation(page.request, headers, opsBlocker, blocked);

  await page.goto(`/w/${workspaceId}/p/${app.id}?view=board`);
  const blockedCard = page.getByRole('article', { name: 'APP-1 Ship the release', exact: true });
  const blockerCard = page.getByRole('article', { name: 'APP-2 Finish the API', exact: true });
  const unrelatedCard = page.getByRole('article', { name: 'APP-5 Write changelog', exact: true });
  await expect(blockedCard).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await expect(blockerCard).toBeVisible();
  await expect(unrelatedCard).toBeVisible();

  // Fold the Review column and collapse Backlog so their blockers sit inside collapsed strips.
  await page.getByRole('button', { name: 'Collapse Review column', exact: true }).click();
  const closeBacklog = page.getByRole('button', { name: 'Close backlog', exact: true });
  if (await closeBacklog.isVisible()) await closeBacklog.click();
  const reviewStrip = page.getByRole('button', { name: 'Expand Review column', exact: true });
  const backlogStrip = page.getByRole('button', { name: /Open backlog/ });
  await expect(reviewStrip).toBeVisible();
  await expect(backlogStrip).toBeVisible();

  const badge = blockedCard.locator('[data-blocked]');
  await expect(badge).toBeVisible();

  // Brief hover shows no spotlight flash across the board.
  await badge.hover();
  await page.waitForTimeout(150);
  await expect(blockedCard).not.toHaveAttribute('data-spotlight');
  await expect(unrelatedCard).not.toHaveAttribute('data-spotlight');
  await page.mouse.move(10, 10);
  await page.waitForTimeout(600);
  await expect(blockedCard).not.toHaveAttribute('data-spotlight');

  // Lingering on the badge activates the spotlight smoothly.
  await badge.hover();
  await expect(blockedCard).toHaveAttribute('data-spotlight', 'blocked', { timeout: 3000 });
  await expect(blockerCard).toHaveAttribute('data-spotlight', 'blocker');
  await expect(unrelatedCard).toHaveAttribute('data-spotlight', 'dimmed');
  await expect(reviewStrip).toHaveAttribute('data-spotlight', 'blocker');
  await expect(backlogStrip).toHaveAttribute('data-spotlight', 'blocker');
  await expect(page.getByRole('tooltip')).toContainText('1 in Operations');

  // Unrelated card visually dims while blocker stays at full opacity.
  await expect
    .poll(() => unrelatedCard.evaluate((el) => Number.parseFloat(getComputedStyle(el).opacity)))
    .toBeLessThan(0.5);
  await expect
    .poll(() => blockerCard.evaluate((el) => Number.parseFloat(getComputedStyle(el).opacity)))
    .toBe(1);

  // Moving the pointer off clears the spotlight immediately.
  await page.mouse.move(10, 10);
  await expect(blockedCard).not.toHaveAttribute('data-spotlight');
  await expect(blockerCard).not.toHaveAttribute('data-spotlight');
  await expect(unrelatedCard).not.toHaveAttribute('data-spotlight');
  await expect(reviewStrip).not.toHaveAttribute('data-spotlight');
  await expect(backlogStrip).not.toHaveAttribute('data-spotlight');

  // Escape dismisses an active spotlight cleanly.
  await badge.hover();
  await expect(blockedCard).toHaveAttribute('data-spotlight', 'blocked', { timeout: 3000 });
  await page.keyboard.press('Escape');
  await expect(blockedCard).not.toHaveAttribute('data-spotlight');
  await expect(unrelatedCard).not.toHaveAttribute('data-spotlight');

  // Clicking the card cancels spotlight and opens the task pane.
  await page.mouse.move(10, 10);
  await badge.hover();
  await expect(blockedCard).toHaveAttribute('data-spotlight', 'blocked', { timeout: 3000 });
  await blockedCard.click();
  await expect(blockedCard).not.toHaveAttribute('data-spotlight');
  await expect(page.getByLabel('Task', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  // Cross-project board spotlights blockers from another project and collapsed category columns too.
  await page.goto(`/w/${workspaceId}/board`);
  const wsBlockedCard = page.getByRole('article', { name: 'APP-1 Ship the release', exact: true });
  const wsOpsBlocker = page.getByRole('article', { name: 'OPS-1 Rotate keys', exact: true });
  const wsUnrelated = page.getByRole('article', { name: 'APP-5 Write changelog', exact: true });
  await expect(wsBlockedCard).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await expect(wsOpsBlocker).toBeVisible();

  await page.getByRole('button', { name: 'Collapse Backlog column', exact: true }).click();
  const wsBacklogStrip = page.getByRole('button', { name: 'Expand Backlog column', exact: true });
  await expect(wsBacklogStrip).toBeVisible();

  await wsBlockedCard.locator('[data-blocked]').hover();
  await expect(wsBlockedCard).toHaveAttribute('data-spotlight', 'blocked', { timeout: 3000 });
  await expect(wsOpsBlocker).toHaveAttribute('data-spotlight', 'blocker');
  await expect(wsUnrelated).toHaveAttribute('data-spotlight', 'dimmed');
  await expect(wsBacklogStrip).toHaveAttribute('data-spotlight', 'blocker');
  await page.mouse.move(10, 10);
  await expect(wsBlockedCard).not.toHaveAttribute('data-spotlight');
  await expect(wsBacklogStrip).not.toHaveAttribute('data-spotlight');
});

test('a task blocked by its own subtask highlights the subtask underlay and pip without bordering the parent', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Blocker spotlight is a desktop hover interaction');

  const { headers } = await signUp(page);
  const [ws] = await shapeRows(page.request, 'workspaces', headers);
  const workspaceId = String(ws?.id);

  const app = await makeProject(page.request, headers, workspaceId, 'APP', 'App', [
    { name: 'Backlog', category: 'backlog', isDefault: true },
    { name: 'Working', category: 'active', isDefault: true },
    { name: 'Done', category: 'done', isDefault: true },
    { name: 'Cancelled', category: 'cancelled', isDefault: true },
  ]);

  const parentId = await makeTask(
    page.request,
    headers,
    app.id,
    'Launch rollout',
    app.statusId('Working'),
    'a0',
  );
  const blockerSubtaskId = await makeTask(
    page.request,
    headers,
    app.id,
    'Verify migration',
    app.statusId('Working'),
    'a0',
    parentId,
  );
  const otherSubtaskId = await makeTask(
    page.request,
    headers,
    app.id,
    'Update changelog',
    app.statusId('Backlog'),
    'a1',
    parentId,
  );
  await makeTask(page.request, headers, app.id, 'Unrelated work', app.statusId('Working'), 'a1');
  await addBlocksRelation(page.request, headers, blockerSubtaskId, parentId);

  await page.goto(`/w/${workspaceId}/p/${app.id}?view=board`);
  const parentCard = page.getByRole('article', { name: 'APP-1 Launch rollout', exact: true });
  const unrelatedCard = page.getByRole('article', { name: 'APP-4 Unrelated work', exact: true });
  await expect(parentCard).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await expect(unrelatedCard).toBeVisible();

  const underlay = page.locator('[data-subtask-underlay]');
  const blockerPip = page.locator(`[data-subtask-pip="${blockerSubtaskId}"]`);
  const otherPip = page.locator(`[data-subtask-pip="${otherSubtaskId}"]`);
  await expect(underlay).toBeVisible();

  await parentCard.locator('[data-blocked]').hover();
  await expect(parentCard).toHaveAttribute('data-spotlight', 'parent', { timeout: 3000 });
  await expect(underlay).toHaveAttribute('data-spotlight', 'blocker');
  await expect(blockerPip).toHaveAttribute('data-spotlight', 'blocker');
  await expect(otherPip).not.toHaveAttribute('data-spotlight');
  await expect(unrelatedCard).toHaveAttribute('data-spotlight', 'dimmed');

  // Clear immediately on mouse leave.
  await page.mouse.move(10, 10);
  await expect(parentCard).not.toHaveAttribute('data-spotlight');
  await expect(underlay).not.toHaveAttribute('data-spotlight');
  await expect(blockerPip).not.toHaveAttribute('data-spotlight');
  await expect(unrelatedCard).not.toHaveAttribute('data-spotlight');
});
