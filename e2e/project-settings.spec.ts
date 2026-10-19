import { expect, type Page, test } from '@playwright/test';
import { APP_LOAD_TIMEOUT, shapeRows, signUp, waitForDeviceSync, waitForShapeRow } from './helpers';

// Outbox writes settle in order and can wait for the stream before the next request.
const synced = expect.configure({ timeout: 60_000 });

async function setup(page: Page, isMobile: boolean) {
  const account = await signUp(page);
  if (isMobile) {
    await page.getByRole('button', { name: 'Switch project or workspace', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New project', exact: true }).click();
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
  } else await page.getByRole('button', { name: 'Project menu for Workshop', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Project settings', exact: true }).click();
  await expect(page).toHaveURL(`${new URL(page.url()).origin}${board}/settings`);
  return {
    ...account,
    ...ids,
    board,
    settings: `${board}/settings`,
    trash: `${board}/trash`,
    workspaceTrash: `/w/${ids.workspaceId}/trash`,
  };
}
async function section(page: Page, name: string) {
  await page
    .getByRole('navigation', { name: 'Project settings sections' })
    .getByRole('button', { name, exact: true })
    .click();
}
async function addStatus(page: Page, name: string, category = 'Active') {
  await page.getByRole('button', { name: `Add status to ${category}`, exact: true }).click();
  await page.getByLabel('Status name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Save status', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
const statusRow = (page: Page, name: string) => page.getByRole('listitem', { name, exact: true });

test('project appearance and status rules, ordering, defaults, rename and deletion', async ({
  page,
  isMobile,
}) => {
  const fixture = await setup(page, isMobile);
  await page.getByRole('button', { name: 'Edit project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Studio');
  await page.getByRole('button', { name: 'Blue', exact: true }).click();
  await page.getByRole('button', { name: 'Home icon', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Studio');
  await expect(page.getByRole('button', { name: 'Edit project', exact: true })).toBeFocused();
  await section(page, 'Statuses');
  await expect(page.getByText('Categories are fixed', { exact: false })).toBeVisible();
  for (const name of ['Backlog', 'In progress', 'Done', 'Cancelled']) {
    await expect(statusRow(page, name)).toContainText('Every category keeps at least one status.');
    await expect(
      statusRow(page, name).getByRole('button', { name: `Delete ${name}`, exact: true }),
    ).toBeDisabled();
  }
  await addStatus(page, 'Review');
  await addStatus(page, 'Testing');
  await page.getByRole('button', { name: 'Move Testing up', exact: true }).click();
  await synced
    .poll(() =>
      page
        .getByRole('region', { name: 'Active statuses' })
        .getByRole('listitem')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('aria-label'))),
    )
    .toEqual(['In progress', 'Testing', 'Review']);
  await page.getByRole('button', { name: 'Move Testing down', exact: true }).click();
  await statusRow(page, 'Review')
    .getByRole('button', { name: 'Make default', exact: true })
    .click();
  await expect(statusRow(page, 'Review')).toContainText('Choose another default');
  await page.getByRole('button', { name: 'Rename Review', exact: true }).click();
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
  await expect(statusRow(page, 'In progress')).toContainText('including those in the trash');
  await expect(
    page.getByRole('button', { name: 'Delete In progress', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Delete Testing', exact: true }).click();
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
  await page.getByRole('link', { name: 'Back to board', exact: true }).click();
  if (isMobile) await page.getByRole('button', { name: /^Backlog \d+$/ }).click();
  await expect(page.getByText('NEW-1', { exact: true }).first()).toBeVisible();
  await page.goto(fixture.settings);
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
  await page.getByRole('link', { name: 'Trash', exact: true }).click();
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
  await page.getByRole('button', { name: 'Rename Review', exact: true }).click();
  await page.getByLabel('Status name').fill('Offline review');
  await page.getByRole('button', { name: 'Save status', exact: true }).click();
  await expect(statusRow(page, 'Offline review')).toBeVisible();
  await expect(page.getByRole('banner').getByRole('status')).toContainText('unsaved', {
    timeout: 40_000,
  });
  await page.reload();
  await section(page, 'Statuses');
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
  await page.getByRole('button', { name: 'Rename Offline review', exact: true }).click();
  await page.getByLabel('Status name').fill('Refused name');
  await page.getByRole('button', { name: 'Save status', exact: true }).click();
  await expect(statusRow(page, 'Offline review')).toBeVisible();
  await expect(statusRow(page, 'Refused name')).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete Offline review', exact: true }).click();
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
  const opener = page.getByRole('button', { name: 'Rename Backlog', exact: true });
  await opener.focus();
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

test('opening a task from settings search returns to its project board', async ({
  page,
  isMobile,
}) => {
  const fixture = await setup(page, isMobile);
  await page.evaluate(async (projectId) => {
    (await import('/src/lib/tasks.ts')).createTask(projectId, { title: 'Open from settings' });
  }, fixture.projectId);
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: /^Search tasks/ }).fill('Open from settings');
  await page.getByRole('option', { name: /^Open from settings/ }).click();
  await expect(page).toHaveURL(`${new URL(page.url()).origin}${fixture.board}?view=board`);
  await expect(page.getByRole('textbox', { name: 'Task title', exact: true })).toHaveValue(
    'Open from settings',
  );
});
