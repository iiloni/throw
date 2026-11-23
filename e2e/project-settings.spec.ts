import { expect, type Locator, type Page, test } from '@playwright/test';
import { centre, finger } from './board-helpers';
import {
  APP_LOAD_TIMEOUT,
  shapeRows,
  signUp,
  switcherItem,
  waitForDeviceSync,
  waitForShapeRow,
} from './helpers';

// Outbox writes settle in order and can wait for the stream before the next request.
const synced = expect.configure({ timeout: 60_000 });

async function setup(page: Page, isMobile: boolean) {
  const account = await signUp(page);
  if (isMobile) {
    await page.getByRole('button', { name: 'Switch project or workspace', exact: true }).click();
    await (await switcherItem(page, 'New project')).click();
  } else await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Workshop');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Workshop', {
    timeout: APP_LOAD_TIMEOUT,
  });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const parts = new URL(page.url()).pathname.split('/');
  const ids = { workspaceId: parts[2]!, projectId: parts[4]! };
  const board = `/w/${ids.workspaceId}/p/${ids.projectId}`;
  await waitForDeviceSync(page);
  await synced
    .poll(() =>
      page.evaluate(
        async (id) => (await import('/src/lib/collections.ts')).projectsCollection.get(id)?.key,
        ids.projectId,
      ),
    )
    .toBe('WOR');
  if (isMobile) {
    await page.getByRole('button', { name: 'Switch project or workspace', exact: true }).click();
    await (await switcherItem(page, 'Project settings')).click();
  } else {
    await page.getByRole('button', { name: 'Project menu for Workshop', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Project settings', exact: true }).click();
  }
  await expect.poll(() => new URL(page.url()).pathname).toBe(`${board}/settings`);
  return {
    ...account,
    ...ids,
    board,
    settings: `${board}/settings`,
    trash: `${board}/trash`,
    workspaceTrash: `/w/${ids.workspaceId}/trash`,
  };
}
const phone = (page: Page) => (page.viewportSize()?.width ?? 1024) < 768;
/** Opens a project settings page: from the list beside it, or the dock's list on a phone. */
async function section(page: Page, name: string) {
  if (phone(page)) {
    await page.getByRole('button', { name: /^Settings page: / }).click();
    await page
      .getByRole('dialog', { name: 'Settings', exact: true })
      .getByRole('link', { name, exact: true })
      .first()
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } else
    await page
      .getByRole('navigation', { name: 'Settings pages' })
      .getByRole('link', { name, exact: true })
      .first()
      .click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}
async function backToBoard(page: Page) {
  if (phone(page)) await page.getByRole('button', { name: /^Settings page: / }).click();
  await page.getByRole('link', { name: 'Back to board', exact: true }).click();
}
async function addStatus(page: Page, name: string, category = 'Active') {
  await page.getByRole('button', { name: `Add status to ${category}`, exact: true }).click();
  await page.getByLabel('Status name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Save status', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
const statusRow = (page: Page, name: string) => page.getByRole('listitem', { name, exact: true });
const activeOrder = (page: Page) =>
  page
    .getByRole('region', { name: 'Active', exact: true })
    .getByRole('listitem')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('aria-label')));
/** Picks one of a status row's actions from its menu. */
async function statusAction(page: Page, name: string, action: string) {
  // A menu still animating closed dismisses one reopened from its trigger, as a click
  // outside it.
  await expect(page.getByRole('menu')).toHaveCount(0);
  await statusRow(page, name)
    .getByRole('button', { name: `Manage ${name}`, exact: true })
    .click();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
}
/** Asks to delete a status that cannot go, and returns the explanation shown instead. */
async function blockedDeletion(page: Page, name: string) {
  await statusAction(page, name, 'Delete');
  const dialog = page.getByRole('dialog', { name: `Can’t delete ${name}`, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Delete status', exact: true })).toHaveCount(0);
  return dialog;
}
async function dismiss(page: Page, dialog: Locator) {
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('project appearance and status rules, ordering, defaults, rename and deletion', async ({
  page,
  isMobile,
}) => {
  const fixture = await setup(page, isMobile);
  await page.getByLabel('Project name', { exact: true }).fill('Studio');
  await page.getByRole('button', { name: 'Blue', exact: true }).click();
  await page.getByRole('button', { name: 'Home icon', exact: true }).click();
  await expect(page.getByText('Studio', { exact: true }).first()).toBeVisible();
  await section(page, 'Statuses');
  for (const name of ['Backlog', 'In progress', 'Done', 'Cancelled']) {
    await expect(statusRow(page, name)).toContainText('Default');
    await expect(statusRow(page, name)).not.toContainText('Every category keeps');
  }
  // The rule is explained when it stops a deletion, not printed on every row.
  const lone = await blockedDeletion(page, 'Cancelled');
  await expect(lone).toContainText('Every category keeps at least one status.');
  await dismiss(page, lone);
  await addStatus(page, 'Review');
  await addStatus(page, 'Testing');
  await statusAction(page, 'Testing', 'Move up');
  await synced.poll(() => activeOrder(page)).toEqual(['In progress', 'Testing', 'Review']);
  // The drag handle also moves its status with the arrow keys. A closing menu returns focus
  // to its button, so it has to be gone first.
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reorder Testing', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await synced.poll(() => activeOrder(page)).toEqual(['In progress', 'Review', 'Testing']);
  await statusAction(page, 'Review', 'Make default');
  await expect(statusRow(page, 'Review')).toContainText('Default');
  await expect(statusRow(page, 'In progress')).not.toContainText('Default');
  const defaultRule = await blockedDeletion(page, 'Review');
  await expect(defaultRule).toContainText('Choose another default');
  await dismiss(page, defaultRule);
  await statusAction(page, 'Review', 'Rename');
  await page.getByLabel('Status name').fill('In review');
  await page.getByRole('button', { name: 'Save status', exact: true }).click();
  await page.evaluate(async ({ projectId }) => {
    const { statusesCollection } = await import('/src/lib/collections.ts');
    const { createTask, trashTask } = await import('/src/lib/tasks.ts');
    const status = [...statusesCollection.values()].find(
      (row) => row.projectId === projectId && row.name === 'In progress',
    )!;
    createTask(projectId, { title: 'Live work', statusId: status.id });
    trashTask(createTask(projectId, { title: 'Trashed work', statusId: status.id }));
  }, fixture);
  await expect(statusRow(page, 'In progress')).toContainText('2 tasks');
  const inUse = await blockedDeletion(page, 'In progress');
  await expect(inUse).toContainText('including those in the trash');
  await dismiss(page, inUse);
  // Dragging a handle puts the status where it is dropped.
  // A phone drags with a finger: the handle must take the touch rather than scroll the page.
  const handle = page.getByRole('button', { name: 'Reorder Testing', exact: true });
  // Until the last dialog's drawer has gone, a touch lands on it rather than the handle.
  await handle.click({ trial: true });
  const from = await centre(handle);
  const top = await statusRow(page, 'In progress').boundingBox();
  if (!top) throw new Error('No status row to drag above');
  const to = { x: from.x, y: top.y + 4 };
  if (isMobile) {
    const touch = await finger(page);
    await touch.press(handle, 80);
    await touch.move(to);
    await touch.lift();
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
  }
  await synced.poll(() => activeOrder(page)).toEqual(['Testing', 'In progress', 'In review']);
  await synced
    .poll(async () =>
      (await shapeRows(page.request, 'statuses', fixture.headers))
        .filter((row) => row.project_id === fixture.projectId && row.category === 'active')
        .sort((a, b) => (String(a.position) < String(b.position) ? -1 : 1))
        .map((row) => row.name),
    )
    .toEqual(['Testing', 'In progress', 'In review']);
  await statusAction(page, 'Testing', 'Delete');
  await page.getByRole('button', { name: 'Delete status', exact: true }).click();
  await expect(statusRow(page, 'Testing')).toHaveCount(0);
  await synced
    .poll(async () =>
      (await shapeRows(page.request, 'statuses', fixture.headers))
        .filter((row) => row.project_id === fixture.projectId)
        .map((row) => row.name),
    )
    .toContain('In review');
});

test('priority names, key rules and board identifiers, and tags have a settings entry point', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(120_000);
  const fixture = await setup(page, isMobile);
  await section(page, 'Priorities');
  for (let rank = 1; rank <= 5; rank++)
    await page.getByLabel(`Rank ${rank} name`, { exact: true }).fill(`Rank ${rank}`);
  await page.getByRole('button', { name: 'Save priority names' }).click();
  await synced
    .poll(async () =>
      JSON.parse(
        String(
          (await shapeRows(page.request, 'projects', fixture.headers)).find(
            (row) => row.id === fixture.projectId,
          )?.priority_names ?? 'null',
        ),
      ),
    )
    .toEqual(['Rank 1', 'Rank 2', 'Rank 3', 'Rank 4', 'Rank 5']);
  await page.getByRole('button', { name: 'Use default names' }).click();
  await page.getByRole('button', { name: 'Save priority names' }).click();
  await expect(page.getByLabel('Rank 1 name', { exact: true })).toHaveValue('');
  await section(page, 'General');
  await page.getByLabel('Project key', { exact: true }).fill('1BAD');
  await expect(page.getByRole('button', { name: 'Change key', exact: true })).toBeDisabled();
  await page.evaluate(async (projectId) => {
    const { projectsCollection } = await import('/src/lib/collections.ts');
    const { createProject, trashProject } = await import('/src/lib/projects.ts');
    const { createTask } = await import('/src/lib/tasks.ts');
    const workspaceId = projectsCollection.get(projectId)!.workspaceId;
    const other = createProject(workspaceId, 'Reserved', undefined, 'TAKEN');
    trashProject(other);
    createTask(projectId, { title: 'Identifier example' });
  }, fixture.projectId);
  await synced
    .poll(
      async () =>
        (await shapeRows(page.request, 'projects', fixture.headers)).find(
          (row) => row.name === 'Reserved',
        )?.key,
      { timeout: 60_000 },
    )
    .toBe('TAKEN');
  await page.getByLabel('Project key', { exact: true }).fill('TAKEN');
  await expect(page.getByRole('alert')).toContainText('in the trash');
  await page.getByLabel('Project key', { exact: true }).fill('NEW');
  await page.getByRole('button', { name: 'Change key', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Old identifiers do not redirect');
  await page.getByRole('dialog').getByRole('button', { name: 'Change key', exact: true }).click();
  await backToBoard(page);
  if (isMobile) await page.getByRole('button', { name: /^Backlog \d+$/ }).click();
  await expect(page.getByText('NEW-1', { exact: true }).first()).toBeVisible();
  await page.goto(fixture.settings);
  // After a page load, Electric reloads these subquery shapes from a full snapshot, and the
  // device's rows can be missing for a moment; a tag needs its project's row to be created.
  await synced
    .poll(() =>
      page.evaluate(
        async (id) => (await import('/src/lib/collections.ts')).projectsCollection.has(id),
        fixture.projectId,
      ),
    )
    .toBe(true);
  await section(page, 'Tags');
  await page.getByRole('button', { name: 'New tag', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Product');
  await page.getByRole('button', { name: 'Save tag', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Product', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add child to Product', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Phone');
  await page.getByRole('button', { name: 'Save tag', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Product / Phone', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Mobile');
  await page.getByRole('button', { name: 'Save tag', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Product', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('all its children');
  await page.getByRole('button', { name: 'Delete tag', exact: true }).click();
  await expect(page.getByText('Create your first tag', { exact: false })).toBeVisible();
});

test('trash restores parents and projects, confirms purges and scopes emptying', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(120_000);
  const fixture = await setup(page, isMobile);
  const ids = await page.evaluate(async ({ projectId, workspaceId }) => {
    const { createTask, trashTask } = await import('/src/lib/tasks.ts');
    const { createProject, trashProject } = await import('/src/lib/projects.ts');
    const parent = createTask(projectId, { title: 'Parent' });
    createTask(projectId, { title: 'Inherited child', parentId: parent });
    trashTask(createTask(projectId, { title: 'Separate child', parentId: parent }));
    trashTask(parent);
    const other = createProject(workspaceId, 'Other project');
    trashTask(createTask(other, { title: 'Other trash' }));
    const trashedProject = createProject(workspaceId, 'Trashed project');
    createTask(trashedProject, { title: 'Project task' });
    trashProject(trashedProject);
    return { parent, other, trashedProject };
  }, fixture);
  await section(page, 'Trash');
  const parent = page.getByRole('listitem', { name: 'Parent', exact: true });
  await expect(parent).toContainText('Inherited child — restores with parent');
  await expect(parent).toContainText('Separate child — stays trashed on restore');
  await parent.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(parent).toHaveCount(0);
  const separate = page.getByRole('listitem', { name: 'Separate child', exact: true });
  await separate.getByRole('button', { name: 'Remove for good', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('cannot be undone');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(separate).toBeVisible();
  await separate.getByRole('button', { name: 'Remove for good', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Remove for good', exact: true })
    .click();
  await expect(separate).toHaveCount(0);
  await page.evaluate(async (projectId) => {
    const { createTask, trashTask } = await import('/src/lib/tasks.ts');
    trashTask(createTask(projectId, { title: 'Empty me' }));
  }, fixture.projectId);
  await page.getByRole('button', { name: 'Empty trash', exact: true }).click();
  await page.getByRole('button', { name: 'Empty trash for good', exact: true }).click();
  await expect(page.getByText('The trash is empty.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Workspace trash', exact: true }).click();
  await expect(page.getByRole('listitem', { name: 'Other trash', exact: true })).toBeVisible();
  const project = page.getByRole('listitem', { name: 'Trashed project', exact: true });
  await project.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(project).toHaveCount(0);
  await synced
    .poll(
      async () =>
        (await shapeRows(page.request, 'projects', fixture.headers)).find(
          (row) => row.id === ids.trashedProject,
        )?.deleted_at,
    )
    .toBeNull();
  await page.evaluate(
    async (id) => (await import('/src/lib/projects.ts')).trashProject(id),
    ids.trashedProject,
  );
  await project.getByRole('button', { name: 'Remove for good', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Remove for good', exact: true })
    .click();
  await expect(project).toHaveCount(0);
  await page.getByRole('button', { name: 'Empty trash', exact: true }).click();
  await page.getByRole('button', { name: 'Empty trash for good', exact: true }).click();
  await expect(page.getByText('The trash is empty.', { exact: true })).toBeVisible();
  await synced
    .poll(async () =>
      (await shapeRows(page.request, 'tasks', fixture.headers)).map((row) => row.title),
    )
    .toEqual(expect.arrayContaining(['Parent', 'Inherited child']));
  await synced
    .poll(
      async () =>
        (await shapeRows(page.request, 'tasks', fixture.headers)).some((row) =>
          ['Separate child', 'Other trash', 'Project task', 'Empty me'].includes(String(row.title)),
        ),
      { timeout: 60_000 },
    )
    .toBe(false);
});

test('offline settings edits persist and replay; refused renames, keys and deletes show collection truth', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(120_000);
  const fixture = await setup(page, isMobile);
  await section(page, 'Statuses');
  const reviewSynced = waitForShapeRow(page, 'statuses', 'Review');
  await addStatus(page, 'Review');
  await reviewSynced;
  await waitForDeviceSync(page);
  await synced
    .poll(async () =>
      (await shapeRows(page.request, 'statuses', fixture.headers)).some(
        (row) => row.name === 'Review',
      ),
    )
    .toBe(true);
  await page.route('**/api/**', (route) => route.abort('connectionfailed'));
  await statusAction(page, 'Review', 'Rename');
  await page.getByLabel('Status name').fill('Offline review');
  await page.getByRole('button', { name: 'Save status', exact: true }).click();
  await expect(statusRow(page, 'Offline review')).toBeVisible();
  await expect(page.getByRole('banner').getByRole('status')).toContainText('unsaved', {
    timeout: 40_000,
  });
  await page.reload();
  // Offline, the page appears once the device's copy has loaded, which can take a while here.
  await expect(page.getByRole('heading', { name: 'Statuses', exact: true })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
  await expect(statusRow(page, 'Offline review')).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await page.unroute('**/api/**');
  await synced
    .poll(
      async () =>
        (await shapeRows(page.request, 'statuses', fixture.headers)).some(
          (row) => row.name === 'Offline review',
        ),
      { timeout: 60_000 },
    )
    .toBe(true);
  await page.route('**/api/statuses/*', async (route) => {
    if (['PATCH', 'DELETE'].includes(route.request().method()))
      await route.fulfill({ status: 409, json: { error: 'Tasks use this status' } });
    else await route.continue();
  });
  await statusAction(page, 'Offline review', 'Rename');
  await page.getByLabel('Status name').fill('Refused name');
  await page.getByRole('button', { name: 'Save status', exact: true }).click();
  await expect(statusRow(page, 'Offline review')).toBeVisible();
  await expect(statusRow(page, 'Refused name')).toHaveCount(0);
  await statusAction(page, 'Offline review', 'Delete');
  await page.getByRole('button', { name: 'Delete status', exact: true }).click();
  await expect(statusRow(page, 'Offline review')).toBeVisible();
  await section(page, 'General');
  await page.route('**/api/projects/*', async (route) => {
    if (route.request().method() === 'PATCH')
      await route.fulfill({ status: 409, json: { error: 'Another project has this key' } });
    else await route.continue();
  });
  await page.getByLabel('Project key', { exact: true }).fill('RACE');
  await page.getByRole('button', { name: 'Change key', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Change key', exact: true }).click();
  await expect(page.getByLabel('Project key', { exact: true })).toHaveValue('WOR');
  await expect(
    page.getByText('Another project already uses this key', { exact: false }),
  ).toBeVisible();
});

test('settings forms preserve focus, scroll and a single modal with reduced motion', async ({
  page,
  isMobile,
  browserName,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  if (browserName === 'firefox') await page.setViewportSize({ width: 412, height: 915 });
  await setup(page, isMobile || browserName === 'firefox');
  await section(page, 'Statuses');
  const opener = page.getByRole('button', { name: 'Manage Backlog', exact: true });
  await opener.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Rename', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Rename status', exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.getByLabel('Status name').focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Save status', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.getByLabel('Status name').focus();
  await page.screenshot({ path: testInfo.outputPath('settings-reduced-motion.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await section(page, 'Tags');
  await page.getByRole('button', { name: 'New tag', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New tag', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New tag', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('opening a task while settings are still loading goes to its project board', async ({
  page,
  isMobile,
}) => {
  const fixture = await setup(page, isMobile);
  const taskId = await page.evaluate(
    async (projectId) =>
      (await import('/src/lib/tasks.ts')).createTask(projectId, { title: 'Open while loading' }),
    fixture.projectId,
  );
  await page.goto(`${fixture.board}?view=board`);
  await expect(page.getByRole('article', { name: /Open while loading/ })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
  // A slow network holds the settings page's code, so the board stays on screen meanwhile.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/settings\.tsx/, async (route) => {
    await held;
    await route.continue();
  });
  if (isMobile) {
    await page.getByRole('button', { name: 'Switch project or workspace', exact: true }).click();
    await (await switcherItem(page, 'Project settings')).click();
  } else {
    await page.getByRole('button', { name: 'Project menu for Workshop', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Project settings', exact: true }).click();
  }
  await expect.poll(() => new URL(page.url()).pathname).toBe(fixture.settings);
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: /^Search tasks/ }).fill('Open while loading');
  await page.getByRole('option', { name: /^Open while loading/ }).click();
  release();
  await expect(page).toHaveURL(
    `${new URL(page.url()).origin}${fixture.board}?view=board&task=${taskId}`,
  );
  await expect(page.getByRole('textbox', { name: 'Task title', exact: true })).toHaveValue(
    'Open while loading',
  );
});

test('opening a task from settings search returns to its project board', async ({
  page,
  isMobile,
}) => {
  const fixture = await setup(page, isMobile);
  const taskId = await page.evaluate(
    async (projectId) =>
      (await import('/src/lib/tasks.ts')).createTask(projectId, { title: 'Open from settings' }),
    fixture.projectId,
  );
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: /^Search tasks/ }).fill('Open from settings');
  await page.getByRole('option', { name: /^Open from settings/ }).click();
  // The open task is in the URL, so a reload keeps it.
  await expect(page).toHaveURL(
    `${new URL(page.url()).origin}${fixture.board}?view=board&task=${taskId}`,
  );
  await expect(page.getByRole('textbox', { name: 'Task title', exact: true })).toHaveValue(
    'Open from settings',
  );
});

test('status colours render on the board and can be cleared', async ({ page, isMobile }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const fixture = await setup(page, isMobile);
  await section(page, 'Statuses');
  await page.getByRole('button', { name: 'Add status to Active', exact: true }).click();
  await page.getByLabel('Status name', { exact: true }).fill('Verify');
  const picker = page.getByRole('group', { name: 'Status color' });
  await expect(picker.getByRole('button', { name: 'No color', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await picker.getByRole('button', { name: 'Mint', exact: true }).click();
  await page.getByRole('button', { name: 'Save status', exact: true }).click();
  const row = statusRow(page, 'Verify');
  await expect(row.locator('[data-column-color="mint"]')).toBeVisible();
  const syncedStatus = async () =>
    (await shapeRows(page.request, 'statuses', fixture.headers)).find(
      ({ name }) => name === 'Verify',
    );
  await synced.poll(syncedStatus).toMatchObject({ color: 'mint' });
  const statusId = String((await syncedStatus())?.id);

  await backToBoard(page);
  const tab = page
    .getByRole('navigation', { name: 'Columns' })
    .getByRole('button', { name: 'Verify', exact: true });
  if (isMobile) {
    await expect(tab).toHaveAttribute('data-column-color', 'mint');
    await tab.click();
  }
  const stripe = isMobile
    ? tab.locator('[data-column-stripe]')
    : page.locator(`[data-column="${statusId}"] [data-column-stripe]`);
  const transparent = 'rgba(0, 0, 0, 0)';
  await expect(stripe).toBeVisible();
  await expect(stripe).not.toHaveCSS('background-color', transparent);
  const lightStripe = await stripe.evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(stripe).not.toHaveCSS('background-color', lightStripe);

  if (isMobile) {
    await expect(page.locator('[data-page][data-origin="active"]').last()).toHaveCSS(
      'background-color',
      transparent,
    );
  } else {
    const column = page.locator(`[data-column="${statusId}"]`);
    const uncolored = page
      .getByRole('button', { name: 'Collapse In progress column', exact: true })
      .locator('xpath=ancestor::section[@data-column]');
    const usesNeutralSurface = async () => {
      const expected = await uncolored.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      const actual = await column.evaluate((element) => getComputedStyle(element).backgroundColor);
      return expected !== transparent && actual === expected;
    };
    await expect.poll(usesNeutralSurface).toBe(true);
    const settingsLink = page.getByRole('link', { name: 'Settings', exact: true });
    const backgrounds = page.getByRole('switch', { name: 'Column backgrounds' });
    await settingsLink.click();
    await expect(backgrounds).toHaveAttribute('aria-checked', 'true');
    await backgrounds.click();
    await backToBoard(page);
    await expect(column).toHaveCSS('background-color', transparent);

    await page.getByRole('button', { name: 'Collapse Verify column' }).click();
    await expect(column).toHaveAttribute('data-collapsed', '');
    await expect(column).toHaveCSS('background-color', transparent);
    await expect(stripe).toBeVisible();
    await page.getByRole('button', { name: 'Expand Verify column' }).click();

    await settingsLink.click();
    await expect(backgrounds).toHaveAttribute('aria-checked', 'false');
    await backgrounds.click();
    await backToBoard(page);
    await expect.poll(usesNeutralSurface).toBe(true);
  }
  const cards = await page.evaluate(
    async ({ projectId, statusId }) => {
      const { createTag } = await import('/src/lib/tags.ts');
      const { createTask } = await import('/src/lib/tasks.ts');
      const primaryTagId = createTag(projectId, { name: 'Urgent', color: 'red' });
      return {
        plain: createTask(projectId, { title: 'No tag', statusId }),
        tagged: createTask(projectId, { title: 'Colour tag', statusId, primaryTagId }),
      };
    },
    { projectId: fixture.projectId, statusId },
  );
  const plain = page.locator(`[data-card-id="${cards.plain}"]`);
  await expect(plain).toBeVisible();
  await expect(plain).not.toHaveAttribute('data-color');
  await expect(page.locator(`[data-card-id="${cards.tagged}"]`)).toHaveAttribute(
    'data-color',
    'red',
  );

  await page.goto(fixture.settings);
  await section(page, 'Statuses');
  await statusAction(page, 'Verify', 'Change color');
  await expect(picker.getByRole('button', { name: 'Mint', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await picker.getByRole('button', { name: 'No color', exact: true }).click();
  await page.getByRole('button', { name: 'Save color', exact: true }).click();
  await expect(row.locator('[data-column-color]')).toHaveCount(0);
  await synced.poll(syncedStatus).toMatchObject({ color: null });
  await backToBoard(page);
  await expect(page.locator('[data-column-color="mint"]')).toHaveCount(0);
});

test('status colours mark backlog statuses on their cards and filters', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'The phone backlog draws the same cards and filters');
  const fixture = await setup(page, isMobile);
  await backToBoard(page);
  const task = await page.evaluate(async (projectId) => {
    const { createStatus } = await import('/src/lib/statuses.ts');
    const { createTask } = await import('/src/lib/tasks.ts');
    const statusId = createStatus(projectId, 'Icebox', 'backlog', 'amber');
    return createTask(projectId, { title: 'Frozen', statusId });
  }, fixture.projectId);
  const card = page.locator(`[data-card-id="${task}"]`);
  await expect(card).toBeVisible();
  await expect(card).not.toHaveAttribute('data-color');
  await expect(card.locator('svg[data-column-color="amber"]')).toBeVisible();
  const filter = page.getByRole('button', { name: 'Icebox', exact: true });
  await expect(filter.locator('svg[data-column-color="amber"]')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Backlog', exact: true }).locator('svg'),
  ).toHaveCount(0);
});
