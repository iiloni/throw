import { randomUUID } from 'node:crypto';
import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';
import { APP_LOAD_TIMEOUT, shapeRows, signUp } from './helpers';

// THR-110: `#KEY-N` in descriptions and comments, drawn as links over plain stored text.

type Headers = Record<string, string>;
const CATEGORIES = ['backlog', 'active', 'done', 'cancelled'] as const;

const paragraph = (text: string) => [
  { type: 'paragraph', content: [{ type: 'text', text, styles: {} }] },
];

async function makeProject(
  request: APIRequestContext,
  headers: Headers,
  workspaceId: string,
  key: string,
  name: string,
) {
  const statuses = CATEGORIES.map((category) => ({
    id: randomUUID(),
    name: category === 'active' ? 'Working' : category,
    category,
    position: 'a0',
    isDefault: true,
  }));
  const project = {
    id: randomUUID(),
    workspaceId,
    name,
    key,
    color: 'teal',
    icon: null,
    position: key === 'APP' ? 'a0' : 'a1',
    statuses,
  };
  expect((await request.post('/api/projects', { headers, data: project })).status()).toBe(201);
  return { id: project.id, active: statuses[1]!.id };
}

async function makeTask(
  request: APIRequestContext,
  headers: Headers,
  projectId: string,
  statusId: string,
  title: string,
  description: string | null = null,
) {
  const id = randomUUID();
  const response = await request.post('/api/tasks', {
    headers,
    data: {
      id,
      projectId,
      title,
      statusId,
      priority: title === 'Rotate the keys' ? 2 : 3,
      position: 'a0',
      parentId: null,
      description: description === null ? null : paragraph(description),
      descriptionVersion: description === null ? null : randomUUID(),
    },
  });
  expect(response.status()).toBe(201);
  return id;
}

/** APP-1 (open), APP-2 in one project and OPS-1 in another, with APP-1's description given. */
async function workspace(page: Page, description: string | null = null) {
  const account = await signUp(page);
  const { headers } = account;
  const [row] = await shapeRows(page.request, 'workspaces', headers);
  const workspaceId = String(row?.id);
  const app = await makeProject(page.request, headers, workspaceId, 'APP', 'App');
  const ops = await makeProject(page.request, headers, workspaceId, 'OPS', 'Operations');
  const main = await makeTask(page.request, headers, app.id, app.active, 'Ship it', description);
  const notes = await makeTask(page.request, headers, app.id, app.active, 'Write notes');
  const keys = await makeTask(page.request, headers, ops.id, ops.active, 'Rotate the keys');
  return { headers, workspaceId, app, ops, main, notes, keys };
}

async function openMain(page: Page, workspaceId: string, projectId: string) {
  await page.goto(`/w/${workspaceId}/p/${projectId}?view=board`);
  const card = page.getByRole('article', { name: 'APP-1 Ship it', exact: true });
  await expect(card).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await card.click();
  const pane = page.getByLabel('Task', { exact: true });
  const description = pane.getByRole('region', { name: 'Description' });
  const editor = description.locator('.bn-editor[contenteditable="true"]');
  await expect(editor).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  return { pane, editor };
}

const reference = (scope: Locator, identifier: string) =>
  scope.locator(`[data-task-ref="${identifier}"]`);

const box = async (target: Locator) => {
  const bounds = await target.boundingBox();
  if (!bounds) throw new Error('Not rendered');
  return bounds;
};

test('typing # offers the workspace’s tasks and writes the pick as plain #KEY-N', async ({
  page,
  isMobile,
}) => {
  const { headers, workspaceId, app, main } = await workspace(page);
  const { pane, editor } = await openMain(page, workspaceId, app.id);
  await editor.click();
  await page.keyboard.type('Waits on #');
  const menu = page.getByRole('listbox', { name: 'Tasks', exact: true });
  await expect(menu).toBeVisible();
  // The current project's tasks first, never the task being written.
  await expect(menu.getByRole('option')).toHaveText([/APP-2\s*Write notes/, /OPS-1\s*Rotate/]);
  await page.keyboard.type('keys');
  await expect(menu.getByRole('option')).toHaveCount(1);
  const viewport = page.viewportSize()!;
  const bounds = await box(menu);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  await page.screenshot({ path: test.info().outputPath('task-menu.png') });
  if (isMobile) await menu.getByRole('option').tap();
  else await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await page.keyboard.type('and `#APP-2` or #APP-99.');
  await expect(reference(editor, 'OPS-1')).toHaveText('#OPS-1');
  // Code and unknown identifiers stay text.
  await expect(reference(editor, 'APP-2')).toHaveCount(0);
  await expect(reference(editor, 'APP-99')).toHaveCount(0);

  // What syncs, once leaving the task saves the description, is the text alone.
  await pane.getByRole('button', { name: 'Back to the board' }).click();
  await expect
    .poll(async () => {
      const [task] = (await shapeRows(page.request, 'tasks', headers)).filter(
        (row) => row.id === main,
      );
      return typeof task?.description === 'string' ? JSON.parse(task.description) : null;
    })
    .toEqual([
      expect.objectContaining({
        content: [
          { type: 'text', text: 'Waits on #OPS-1 and ', styles: {} },
          { type: 'text', text: '#APP-2', styles: { code: true } },
          { type: 'text', text: ' or #APP-99.', styles: {} },
        ],
      }),
    ]);
});

test('a space after # is still a heading’s shortcut', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Typing is the same on a phone; the test above drives the phone menu');
  const { workspaceId, app } = await workspace(page);
  const { editor } = await openMain(page, workspaceId, app.id);
  await editor.click();
  await page.keyboard.type('# Plan');
  await expect(page.getByRole('listbox', { name: 'Tasks', exact: true })).toHaveCount(0);
  await expect(editor.locator('[data-content-type="heading"]')).toHaveText('Plan');
});

test('a reference opens its task: over this one on its board, or on another project’s', async ({
  page,
}) => {
  const { workspaceId, app, ops, keys } = await workspace(page, 'Needs #APP-2 and #ops-1.');
  const { pane, editor } = await openMain(page, workspaceId, app.id);
  await reference(editor, 'APP-2').click();
  await expect(pane.getByRole('textbox', { name: 'Task title' })).toHaveValue('Write notes');
  await pane.getByRole('button', { name: 'Back to APP-1' }).click();
  await expect(pane.getByRole('textbox', { name: 'Task title' })).toHaveValue('Ship it');
  // No caret was left in the description to raise a keyboard or take the next keys.
  await expect(editor).not.toBeFocused();

  await reference(editor, 'OPS-1').click();
  await expect(page).toHaveURL(new RegExp(`/p/${ops.id}.*task=${keys}`));
  await expect(
    page.getByLabel('Task', { exact: true }).getByRole('textbox', { name: 'Task title' }),
  ).toHaveValue('Rotate the keys', { timeout: APP_LOAD_TIMEOUT });
});

test('a reference previews its task on hover, and the keyboard reaches one in a comment', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Touch opens the task instead; the test above taps references');
  const setup = await workspace(page, 'See #OPS-1.');
  const { headers, workspaceId, app, main, notes, keys } = setup;
  expect(
    (
      await page.request.post('/api/task-relations', {
        headers,
        data: { id: randomUUID(), sourceTaskId: notes, targetTaskId: keys, kind: 'blocks' },
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await page.request.post('/api/comments', {
        headers,
        data: { id: randomUUID(), taskId: main, body: paragraph('After #APP-2 lands.') },
      })
    ).status(),
  ).toBe(201);
  const { pane, editor } = await openMain(page, workspaceId, app.id);
  const card = page.getByRole('tooltip').filter({ hasText: 'Rotate the keys' });
  await reference(editor, 'OPS-1').hover();
  await expect(card).toBeVisible();
  await expect(card).toContainText('OPS-1');
  await expect(card).toContainText('Working');
  await expect(card).toContainText('Operations');
  await expect(card).toContainText('High');
  await expect(card).toContainText('Blocked by APP-2');
  // In the page's body, so the pane's clipped scroll area cannot cut it off.
  await expect(card).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: test.info().outputPath('reference-card.png') });
  await page.mouse.move(0, 0);
  await expect(card).toHaveCount(0);

  const comment = pane.locator('.comment-body');
  const link = comment.getByRole('link', { name: 'APP-2: Write notes' });
  await expect(link).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await comment.locator('.bn-editor').focus();
  await page.keyboard.press('Tab');
  await expect(link).toBeFocused();
  await expect(page.getByRole('tooltip').filter({ hasText: 'Write notes' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(pane.getByRole('textbox', { name: 'Task title' })).toHaveValue('Write notes');
});
