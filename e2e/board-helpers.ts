import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { APP_LOAD_TIMEOUT, shapeRows, signUp } from './helpers';

/**
 * A fresh account with a project whose board has a known set of tasks: two backlog statuses,
 * two active columns, done and cancelled.
 */
export async function fixture(page: Page, empty = false) {
  const account = await signUp(page);
  const [workspace] = await shapeRows(page.request, 'workspaces', account.headers);
  const projectId = randomUUID();
  const workspaceId = String(workspace?.id);
  const statusSeeds = [
    ['Ideas', 'backlog', 'a0', true],
    ['Planned', 'backlog', 'a1', false],
    ['Build', 'active', 'a0', true],
    ['Review', 'active', 'a1', false],
    ['Done', 'done', 'a0', true],
    ['Cancelled', 'cancelled', 'a0', true],
  ] as const;
  const statuses = statusSeeds.map(([name, category, position, isDefault]) => ({
    id: randomUUID(),
    name,
    category,
    position,
    isDefault,
  }));
  const status = (name: string) => statuses.find((item) => item.name === name)!.id;
  const response = await page.request.post('/api/projects', {
    headers: account.headers,
    data: {
      id: projectId,
      workspaceId,
      name: 'Real board',
      key: 'BRD',
      color: 'teal',
      icon: 'target',
      position: 'a0',
      statuses,
    },
  });
  expect(response.status()).toBe(201);
  const ids: Record<string, string> = {};
  async function add(
    title: string,
    name: string,
    priority = 3,
    position = 'a0',
    parentId: string | null = null,
  ) {
    const id = randomUUID();
    const response = await page.request.post('/api/tasks', {
      headers: account.headers,
      data: {
        id,
        projectId,
        title,
        statusId: status(name),
        priority,
        position,
        parentId,
        description: null,
        descriptionVersion: null,
      },
    });
    expect(response.status()).toBe(201);
    ids[title] = id;
    return id;
  }
  if (!empty) {
    const parent = await add('Board parent', 'Build', 1);
    await add('Subtask in progress', 'Build', 3, 'a0', parent);
    await add('Subtask complete', 'Done', 3, 'a1', parent);
    await add('Low priority', 'Build', 5);
    await add('Earlier position', 'Build', 3, 'a0');
    await add('Later position', 'Build', 3, 'a1');
    await add('Review this', 'Review', 2);
    await add('Idea for later', 'Ideas', 4);
    await add('Planned first', 'Planned', 2);
    await add('Finished', 'Done');
    await add('Cancelled work', 'Cancelled');
  }
  await page.goto(`/w/${workspaceId}/p/${projectId}?view=board`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Real board', {
    timeout: APP_LOAD_TIMEOUT,
  });
  await expect(page.getByRole('region', { name: 'Build', exact: true })).toBeVisible();
  if (!empty) await expect(page.getByRole('article', { name: /Board parent$/ })).toBeVisible();
  return { ...account, projectId, workspaceId, ids, status, add };
}

export const cardIds = (page: Page, region: string) =>
  page
    .getByRole('region', { name: region, exact: true })
    .getByRole('article')
    .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-card-id')));
