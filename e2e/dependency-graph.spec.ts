import { randomUUID } from 'node:crypto';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { APP_LOAD_TIMEOUT, shapeRows, signUp } from './helpers';

type Headers = Record<string, string>;

async function seed(request: APIRequestContext, headers: Headers) {
  const [ws] = await shapeRows(request, 'workspaces', headers);
  const workspaceId = String(ws?.id);
  const make = async (key: string, name: string, position: string) => {
    const statuses = [
      { id: randomUUID(), name: 'Backlog', category: 'backlog', isDefault: true, position: 'a0' },
      { id: randomUUID(), name: 'Working', category: 'active', isDefault: true, position: 'a1' },
      { id: randomUUID(), name: 'Done', category: 'done', isDefault: true, position: 'a2' },
      { id: randomUUID(), name: 'Dropped', category: 'cancelled', isDefault: true, position: 'a3' },
    ];
    const project = { id: randomUUID(), workspaceId, name, key, color: 'teal', icon: null };
    const response = await request.post('/api/projects', {
      headers,
      data: { ...project, position, statuses },
    });
    expect(response.status()).toBe(201);
    const status = (label: string) => statuses.find((row) => row.name === label)!.id;
    return { ...project, status };
  };
  const app = await make('APP', 'App', 'a0');
  const ops = await make('OPS', 'Operations', 'a1');
  let position = 0;
  const task = async (projectId: string, title: string, statusId: string) => {
    const id = randomUUID();
    const response = await request.post('/api/tasks', {
      headers,
      data: {
        id,
        projectId,
        title,
        statusId,
        priority: 3,
        position: `a${position++}`,
        parentId: null,
        description: null,
        descriptionVersion: null,
      },
    });
    expect(response.status()).toBe(201);
    return id;
  };
  const design = await task(app.id, 'Design the schema', app.status('Working'));
  const api = await task(app.id, 'Build the API', app.status('Backlog'));
  const ship = await task(app.id, 'Ship the release', app.status('Working'));
  const spike = await task(app.id, 'Research spike', app.status('Done'));
  await task(app.id, 'Tidy the docs', app.status('Working'));
  const keys = await task(ops.id, 'Rotate keys', ops.status('Working'));
  const hardware = await task(ops.id, 'Order hardware', ops.status('Working'));
  const blocks = async (sourceTaskId: string, targetTaskId: string) => {
    const response = await request.post('/api/task-relations', {
      headers,
      data: { id: randomUUID(), sourceTaskId, targetTaskId, kind: 'blocks' },
    });
    expect(response.status()).toBe(201);
  };
  await blocks(design, api);
  await blocks(api, ship);
  await blocks(spike, ship);
  await blocks(keys, ship);
  // Off the project board on both ends: drawn upstream of OPS-1, which it blocks.
  await blocks(hardware, keys);
  return { workspaceId, app, ops, design, api, ship, spike, keys };
}

const node = (page: Page, name: RegExp) =>
  page.locator('[data-graph-canvas]').getByRole('button', { name });

test('the dependency graph draws blocking work, opens tasks in place and keeps its view in the URL', async ({
  page,
  isMobile,
}) => {
  const { headers } = await signUp(page);
  const { workspaceId, app, design, ship } = await seed(page.request, headers);
  await page.goto(`/w/${workspaceId}/p/${app.id}?view=graph`);

  const designNode = node(page, /^APP-1 Design the schema/);
  const apiNode = node(page, /^APP-2 Build the API/);
  const shipNode = node(page, /^APP-3 Ship the release/);
  const keysNode = node(page, /^OPS-1 Rotate keys/);
  const hardwareNode = node(page, /^OPS-2 Order hardware/);
  await expect(designNode).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await expect(designNode).toHaveAttribute('data-state', 'ready');
  await expect(apiNode).toHaveAttribute('data-state', 'blocked');
  await expect(shipNode).toHaveAttribute('data-state', 'blocked');
  // Another project's blocker stands at the end of its edge, with what blocks it in turn;
  // closed and unlinked work waits behind its toggles.
  await expect(keysNode).toHaveAttribute('data-state', 'blocked');
  await expect(hardwareNode).toHaveAttribute('data-state', 'ready');
  await expect(node(page, /Research spike/)).toHaveCount(0);
  await expect(node(page, /Tidy the docs/)).toHaveCount(0);
  await expect(page.locator('[data-graph-edge]')).toHaveCount(4);
  // Blockers stand to the left of what they block.
  const x = async (locator: ReturnType<typeof node>) => (await locator.boundingBox())!.x;
  await expect.poll(async () => (await x(apiNode)) > (await x(designNode))).toBe(true);
  await expect.poll(async () => (await x(shipNode)) > (await x(apiNode))).toBe(true);
  await page.screenshot({ path: test.info().outputPath('graph.png') });

  // Closed work comes in with its toggle, its edge drawn as settled.
  if (isMobile) {
    await page.getByRole('button', { name: 'Graph', exact: true }).click();
    await page.getByRole('switch', { name: 'Closed' }).click();
    await page.keyboard.press('Escape');
  } else {
    await page
      .getByRole('toolbar', { name: 'Graph display' })
      .getByRole('button', { name: 'Closed' })
      .click();
  }
  await expect(node(page, /Research spike/)).toHaveAttribute('data-state', 'done');
  await expect(page.locator('[data-graph-edge]')).toHaveCount(5);
  await page.emulateMedia({ colorScheme: 'dark' });
  // Settled: the nodes spring to their new places and the theme fades over.
  await page.waitForTimeout(1200);
  await page.screenshot({ path: test.info().outputPath('graph-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });

  // Hovering a task (or focusing it) lights its chain and fades the rest.
  if (!isMobile) {
    await apiNode.hover();
    await expect(apiNode).toHaveAttribute('data-emphasis', 'focus');
    await expect(designNode).toHaveAttribute('data-emphasis', 'chain');
    await expect(shipNode).toHaveAttribute('data-emphasis', 'chain');
    await expect(keysNode).toHaveAttribute('data-emphasis', 'dimmed');
    await page.mouse.move(5, 5);
  }

  // A node opens its task as a card does, and the URL keeps both the view and the task.
  await shipNode.click();
  const pane = page.getByLabel('Task', { exact: true });
  await expect(pane).toBeVisible();
  await expect(pane.getByRole('textbox', { name: 'Task title' })).toHaveValue('Ship the release');
  await expect(page).toHaveURL(new RegExp(`view=graph.*task=${ship}|task=${ship}.*view=graph`));
  await page.reload();
  await expect(page.getByLabel('Task', { exact: true })).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await expect(
    page.getByLabel('Task', { exact: true }).getByRole('textbox', { name: 'Task title' }),
  ).toHaveValue('Ship the release');
  await page.getByRole('button', { name: 'Back to the board' }).click();
  await expect(page.getByLabel('Task', { exact: true })).toHaveCount(0);
  await expect(designNode).toBeVisible();

  // Back to the board, which keeps the choice in the URL.
  const toggle = page.getByRole('button', { name: 'Dependency graph' });
  if (isMobile) await page.getByRole('button', { name: 'Show the board' }).click();
  else {
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
  }
  await expect(page).toHaveURL(/view=board/);
  await expect(
    page.getByRole('article', { name: 'APP-1 Design the schema', exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-graph-canvas]')).toHaveCount(0);

  if (!isMobile) {
    // The rail's toggle opens the graph again, and the graph goes with the board across projects.
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(page).toHaveURL(/view=graph/);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(designNode).toBeVisible();
    await designNode.focus();
    await page.keyboard.press('ArrowRight');
    await expect(apiNode).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/task=/);
    await expect(
      page.getByLabel('Task', { exact: true }).getByRole('textbox', { name: 'Task title' }),
    ).toHaveValue('Build the API');
    expect(design).toBeTruthy();
  }
});

test('the workspace board has a graph across its projects', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The project graph covers the phone; this checks the cross-project data');
  const { headers } = await signUp(page);
  const { workspaceId } = await seed(page.request, headers);
  await page.goto(`/w/${workspaceId}/board?view=graph`);
  const keysNode = node(page, /^OPS-1 Rotate keys/);
  await expect(keysNode).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  // On the workspace board every project is on the board, so none of its tasks is external.
  await expect(keysNode).not.toHaveClass(/border-dashed/);
  await expect(page.locator('[data-graph-edge]')).toHaveCount(4);
  await page
    .getByRole('toolbar', { name: 'Graph display' })
    .getByRole('button', { name: 'Critical path' })
    .click();
  await expect(node(page, /^APP-1 Design the schema/)).toHaveAttribute('data-critical', '');
  await expect(node(page, /^APP-3 Ship the release/)).toHaveAttribute('data-critical', '');
  await expect(keysNode).not.toHaveAttribute('data-critical');
});

test('an empty graph says how to fill it, and its search narrows the graph', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop search bar; the phone shares the same data path');
  const { headers } = await signUp(page);
  const { workspaceId, app } = await seed(page.request, headers);
  await page.goto(`/w/${workspaceId}/p/${app.id}?view=graph`);
  await expect(node(page, /^APP-1 Design the schema/)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.locator('[data-board-search-input]').fill('Tidy');
  await expect(page.getByRole('heading', { name: 'Nothing here matches' })).toBeVisible();
  await page.getByRole('button', { name: /Show 1 unlinked task/ }).click();
  await expect(node(page, /Tidy the docs/)).toBeVisible();
});

test('switching between the board and its graph cross-fades and settles the new view in', async ({
  page,
  isMobile,
  browserName,
}) => {
  test.skip(isMobile, 'The phone switches through the same shell view; this checks the motion');
  test.skip(
    browserName === 'firefox' &&
      !(await page.evaluate(() => CSS.supports('selector(:active-view-transition-type(a))'))),
    'This Firefox has no view transition types, so it runs no page transitions',
  );
  // For each switch: which view the transition captured as the page it leaves, and how the
  // arriving view's first card or node shows as the cross-fade starts.
  await page.addInitScript(() => {
    type Switch = { types: string[]; leftGraph: boolean; arriving: number };
    const log: Switch[] = [];
    Object.assign(window, { viewSwitches: log });
    const start = document.startViewTransition?.bind(document);
    if (!start) return;
    const opacity = (element: Element | null) => {
      let value = 1;
      for (let at = element; at; at = at.parentElement)
        value *= Number(getComputedStyle(at).opacity);
      return element ? value : -1;
    };
    document.startViewTransition = ((
      update?: ViewTransitionUpdateCallback | StartViewTransitionOptions,
    ) => {
      const types = update && typeof update === 'object' && update.types ? [...update.types] : [];
      const entry: Switch = {
        types,
        leftGraph: Boolean(document.querySelector('[data-graph-canvas]')),
        arriving: -1,
      };
      log.push(entry);
      const transition = start(update);
      transition.ready.then(
        () => {
          entry.arriving = opacity(
            document.querySelector('[data-graph-node]') ?? document.querySelector('[data-card-id]'),
          );
        },
        () => {},
      );
      return transition;
    }) as typeof document.startViewTransition;
  });
  const { headers } = await signUp(page);
  const { workspaceId, app } = await seed(page.request, headers);
  await page.goto(`/w/${workspaceId}/p/${app.id}?view=board`);
  const designCard = page.getByRole('article', { name: 'APP-1 Design the schema', exact: true });
  await expect(designCard).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  type Switch = { types: string[]; leftGraph: boolean; arriving: number };
  const switches = () =>
    page.evaluate(() => (window as unknown as { viewSwitches: Switch[] }).viewSwitches);
  const toggle = page.getByRole('button', { name: 'Dependency graph' });
  async function flip() {
    const count = (await switches()).length;
    await toggle.click();
    await expect.poll(async () => (await switches())[count]?.arriving ?? -1).toBeGreaterThan(-1);
    return (await switches())[count]!;
  }

  // The transition captures the board before the graph replaces it, and the graph settles in.
  const toGraph = await flip();
  expect(toGraph).toMatchObject({ types: ['fade'], leftGraph: false });
  expect(toGraph.arriving).toBeLessThan(0.5);
  const designNode = node(page, /^APP-1 Design the schema/);
  await expect(designNode).toBeVisible();
  await expect(designNode).toHaveCSS('opacity', '1');

  // Back again: the graph is what fades out, and the board's cards settle in as on a switch.
  const toBoard = await flip();
  expect(toBoard).toMatchObject({ types: ['fade'], leftGraph: true });
  expect(toBoard.arriving).toBeLessThan(0.5);
  await expect(designCard).toBeVisible();

  // A graph seen before still settles in rather than snapping into place.
  const again = await flip();
  expect(again.leftGraph).toBe(false);
  expect(again.arriving).toBeLessThan(0.5);
});
