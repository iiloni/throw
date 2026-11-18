import { randomUUID } from 'node:crypto';
import { expect, type Locator, type Page } from '@playwright/test';
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

/**
 * A fresh account whose workspace has two projects with differently named statuses, for the
 * cross-project board: Kitchen (teal) and Garden (orange).
 */
export async function workspaceFixture(page: Page) {
  const account = await signUp(page);
  const [workspace] = await shapeRows(page.request, 'workspaces', account.headers);
  const workspaceId = String(workspace?.id);
  const ids: Record<string, string> = {};
  const statusIds: Record<string, string> = {};
  const projectIds: Record<string, string> = {};
  const seeds = [
    {
      name: 'Kitchen',
      key: 'KIT',
      color: 'teal',
      position: 'a0',
      statuses: [
        ['Kitchen ideas', 'backlog', 'a0', true],
        ['Cooking', 'active', 'a0', true],
        ['Tasting', 'active', 'a1', false],
        ['Served', 'done', 'a0', true],
        ['Binned', 'cancelled', 'a0', true],
      ],
      tasks: [
        ['Sharpen knives', 'Kitchen ideas', 3],
        ['Bake bread', 'Cooking', 1],
        ['Simmer stock', 'Cooking', 3],
        ['Taste the soup', 'Tasting', 3],
        ['Wash up', 'Served', 3],
        ['Flambé', 'Binned', 3],
      ],
    },
    {
      name: 'Garden',
      key: 'GDN',
      color: 'orange',
      position: 'a1',
      statuses: [
        ['Garden ideas', 'backlog', 'a0', true],
        ['Growing', 'active', 'a0', true],
        ['Harvested', 'done', 'a0', true],
        ['Gave up', 'cancelled', 'a0', true],
      ],
      tasks: [
        ['Plan the beds', 'Garden ideas', 2],
        ['Water tomatoes', 'Growing', 1],
        ['Prune roses', 'Growing', 4],
        ['Pick apples', 'Harvested', 3],
      ],
    },
  ] as const;
  for (const seed of seeds) {
    const projectId = randomUUID();
    projectIds[seed.name] = projectId;
    const statuses = seed.statuses.map(([name, category, position, isDefault]) => {
      const id = randomUUID();
      statusIds[name] = id;
      return { id, name, category, position, isDefault };
    });
    const created = await page.request.post('/api/projects', {
      headers: account.headers,
      data: {
        id: projectId,
        workspaceId,
        name: seed.name,
        key: seed.key,
        color: seed.color,
        icon: null,
        position: seed.position,
        statuses,
      },
    });
    expect(created.status()).toBe(201);
    for (const [title, status, priority] of seed.tasks) {
      const id = randomUUID();
      const response = await page.request.post('/api/tasks', {
        headers: account.headers,
        data: {
          id,
          projectId,
          title,
          statusId: statusIds[status],
          priority,
          position: 'a0',
          parentId: null,
          description: null,
          descriptionVersion: null,
        },
      });
      expect(response.status()).toBe(201);
      ids[title] = id;
    }
  }
  await page.goto(`/w/${workspaceId}/board`);
  await expect(page.getByRole('region', { name: 'Active', exact: true })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
  await expect(page.getByRole('article', { name: /Water tomatoes$/ })).toBeVisible();
  return { ...account, workspaceId, ids, statusIds, projectIds };
}

export type Point = { x: number; y: number };

export async function centre(target: Locator | Point): Promise<Point> {
  if (!('boundingBox' in target)) return target;
  const box = (await target.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Carries a card with the mouse through `path`, pausing at each point so the board can
 * respond (a rail's dwell, a column folding), then drops it unless told to keep holding.
 */
export async function carry(
  page: Page,
  card: Locator,
  path: (Locator | Point)[],
  { pause = 120, drop = true }: { pause?: number; drop?: boolean } = {},
) {
  const start = await centre(card);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // Past the slop, so the press becomes a drag.
  await page.mouse.move(start.x + 4, start.y + 8, { steps: 4 });
  for (const point of path) {
    const { x, y } = await centre(point);
    await page.mouse.move(x, y, { steps: 14 });
    await page.waitForTimeout(pause);
  }
  if (drop) await page.mouse.up();
}

export async function taskRow(page: Page, headers: Record<string, string>, id: string) {
  return (await shapeRows(page.request, 'tasks', headers)).find((row) => row.id === id);
}

export const card = (page: Page, title: string) =>
  page.getByRole('article', { name: new RegExp(`${title}$`) });

export async function settled(target: Locator) {
  let last = '';
  for (;;) {
    const box = await target.boundingBox();
    const now = JSON.stringify(box);
    if (box && now === last) return target;
    last = now;
    await target.page().waitForTimeout(100);
  }
}

/** A finger on the screen, through Chromium's touch input, so long presses are real touches. */
export async function finger(page: Page) {
  const session = await page.context().newCDPSession(page);
  let at: Point = { x: 0, y: 0 };
  const send = (type: string, point?: Point) =>
    session.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [point] : [] });
  return {
    async press(target: Locator | Point, ms = 500) {
      at = await centre('boundingBox' in target ? await settled(target) : target);
      await send('touchStart', at);
      await page.waitForTimeout(ms);
    },
    async move(target: Locator | Point, ms = 400) {
      const to = await centre('boundingBox' in target ? await settled(target) : target);
      const from = at;
      const frames = Math.max(2, Math.round(ms / 16));
      for (let frame = 1; frame <= frames; frame++) {
        const t = frame / frames;
        await send('touchMove', {
          x: from.x + (to.x - from.x) * t,
          y: from.y + (to.y - from.y) * t,
        });
        await page.waitForTimeout(16);
      }
      at = to;
    },
    async hold(ms: number) {
      await page.waitForTimeout(ms);
    },
    async lift() {
      await send('touchEnd');
    },
    async tap(target: Locator | Point) {
      at = await centre('boundingBox' in target ? await settled(target) : target);
      await send('touchStart', at);
      await page.waitForTimeout(60);
      await send('touchEnd');
    },
  };
}
