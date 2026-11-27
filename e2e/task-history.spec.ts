import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  APP_LOAD_TIMEOUT,
  createAccount,
  shapeRows,
  signUp,
  waitForCachedProject,
} from './helpers';

const body = (text: string) => [{ type: 'paragraph', content: [{ type: 'text', text }] }];
async function fixture(page: Page) {
  const account = await signUp(page);
  const [workspace] = await shapeRows(page.request, 'workspaces', account.headers);
  const workspaceId = String(workspace!.id);
  const projectId = randomUUID();
  const taskId = randomUUID();
  const statuses = ['backlog', 'active', 'done', 'cancelled'].map((category) => ({
    id: randomUUID(),
    name: category === 'active' ? 'Doing' : category,
    category,
    position: 'a0',
    isDefault: true,
  }));
  expect(
    (
      await page.request.post('/api/projects', {
        headers: account.headers,
        data: {
          id: projectId,
          workspaceId,
          name: 'History project',
          key: 'LOG',
          color: 'teal',
          icon: null,
          position: 'a0',
          statuses,
        },
      })
    ).status(),
  ).toBe(201);
  const createTask = async (id: string, title: string) => {
    expect(
      (
        await page.request.post('/api/tasks', {
          headers: account.headers,
          data: {
            id,
            projectId,
            title,
            statusId: statuses[0]!.id,
            priority: 3,
            parentId: null,
            position: 'a0',
            description: null,
            descriptionVersion: null,
          },
        })
      ).status(),
    ).toBe(201);
  };
  await createTask(taskId, 'Prepare the release');
  const path = `/w/${workspaceId}/p/${projectId}?view=board&task=${taskId}`;
  await page.goto(path);
  const pane = page.getByLabel('Task', { exact: true });
  const history = pane.getByRole('region', { name: 'Task history', exact: true });
  await expect(history).toContainText('Created the task “Prepare the release” in “backlog”.', {
    timeout: APP_LOAD_TIMEOUT,
  });
  const update = async (changes: Record<string, unknown>) => {
    const id = randomUUID();
    expect(
      (
        await page.request.patch(`/api/tasks/${taskId}`, {
          headers: account.headers,
          data: { changeId: id, changes },
        })
      ).ok(),
    ).toBe(true);
    return id;
  };
  const comment = async (text: string) => {
    const id = randomUUID();
    expect(
      (
        await page.request.post('/api/comments', {
          headers: account.headers,
          data: { id, taskId, body: body(text) },
        })
      ).status(),
    ).toBe(201);
    return id;
  };
  return {
    ...account,
    workspaceId,
    projectId,
    taskId,
    statuses,
    pane,
    history,
    path,
    update,
    comment,
    createTask,
  };
}
const editor = (page: Page) =>
  page
    .getByRole('region', { name: 'Comment editor', exact: true })
    .locator('.bn-editor[contenteditable="true"]');
async function compose(page: Page, text: string) {
  await page.getByRole('button', { name: 'Write a comment…', exact: true }).click();
  await expect(editor(page)).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await editor(page).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}

test('comment drafts survive closing and reloading, and can be posted from the keyboard', async ({
  page,
}) => {
  const { pane, history, path } = await fixture(page);
  await history.getByRole('button', { name: 'Write a comment…' }).click();
  await editor(page).fill('An unfinished comment');
  await pane.getByRole('button', { name: 'Back to the board' }).click();
  await expect(pane).toHaveCount(0);

  await page.goto(path);
  await history.getByRole('button', { name: 'Resume comment draft' }).click();
  await expect(editor(page)).toHaveText('An unfinished comment');
  await editor(page).press('ControlOrMeta+Enter');
  const comment = history.getByRole('article', { name: 'You commented' });
  await expect(comment).toContainText('An unfinished comment');
  await expect(comment.getByText('Pending sync')).toHaveCount(0);
  await expect(history.getByRole('button', { name: 'Write a comment…' })).toBeVisible();

  // An edit lives in its editor: cancelling it leaves the comment as it was.
  await comment.getByRole('button', { name: 'Edit comment' }).click();
  await editor(page).fill('An unfinished edit');
  await history.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(comment).toContainText('An unfinished comment');
  await expect(comment.getByRole('button', { name: 'Edit comment' })).toBeVisible();
});

test('history words every field in server order, with comments under their own tab', async ({
  page,
}) => {
  const f = await fixture(page);
  await f.update({
    title: { before: 'Prepare the release', after: 'Ship the release' },
    priority: { before: 3, after: 1 },
  });
  await expect(f.history).toContainText(
    'Renamed from “Prepare the release” to “Ship the release”. Changed priority from “Default” to “Critical”.',
  );
  await f.comment('Ready for the final checks.');
  await expect(f.history).toContainText('Ready for the final checks.');
  await f.update({ statusId: { before: f.statuses[0]!.id, after: f.statuses[1]!.id } });
  await expect(f.history).toContainText('Changed status from “backlog” to “Doing”.');
  const version = randomUUID();
  await f.update({
    description: { before: null, after: { version, document: body('Private description text') } },
  });
  await expect(f.history).toContainText('Changed the description.');
  await expect(f.history).not.toContainText('Private description text');
  const parentId = randomUUID();
  await f.createTask(parentId, 'Parent');
  await f.update({ parentId: { before: null, after: parentId } });
  await expect(f.history).toContainText('Moved under LOG-2.');
  await f.update({ parentId: { before: parentId, after: null } });
  await expect(f.history).toContainText('Removed parent LOG-2.');
  const tagId = randomUUID();
  expect(
    (
      await page.request.post('/api/tags', {
        headers: f.headers,
        data: {
          id: tagId,
          projectId: f.projectId,
          name: 'Release',
          parentId: null,
          color: 'amber',
          icon: null,
        },
      })
    ).status(),
  ).toBe(201);
  await f.update({
    primaryTagId: { before: null, after: tagId },
    secondaryTags: [{ tagId, present: true }],
  });
  await expect(f.history).toContainText('Set primary tag to “Release”. Added tag “Release”.');
  await f.update({
    primaryTagId: { before: tagId, after: null },
    secondaryTags: [{ tagId, present: false }],
  });
  await expect(f.history).toContainText('Removed primary tag “Release”. Removed tag “Release”.');
  await f.update({ trashed: { before: false, after: true } });
  await expect(f.history).toContainText('Moved to the trash.');
  await f.update({ trashed: { before: true, after: false } });
  await expect(f.history).toContainText('Restored from the trash.');
  // Comments open first; the history sits under its own tab, in server order.
  const comments = f.history.getByRole('tabpanel', { name: /^Comments/ });
  await expect(comments.getByRole('article', { name: 'You commented' })).toContainText(
    'Ready for the final checks.',
  );
  await f.history.getByRole('tab', { name: 'History' }).click();
  const history = f.history.getByRole('tabpanel', { name: 'History' });
  await expect(history).not.toContainText('Ready for the final checks.');
  const rows = await history.locator('ol > li').allTextContents();
  expect(rows[0]).toContain('Created the task');
  expect(rows[1]).toContain('Renamed from');
  expect(rows[2]).toContain('Changed status');
});

test('comments add, edit and delete; another workspace member has no editing controls', async ({
  page,
}) => {
  const f = await fixture(page);
  await compose(page, 'My first comment');
  const own = f.history.getByRole('article', { name: 'You commented' });
  await expect(own).not.toContainText('Pending sync');
  await own.getByRole('button', { name: 'Edit comment', exact: true }).click();
  await editor(page).fill('My revised comment');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(own).toContainText('My revised comment');
  await expect(own).toContainText('Edited');
  const member = await createAccount(page.request);
  // Sharing has no UI yet. Add a real membership in this worktree's database only.
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  execFileSync('./scripts/dev.sh', [
    'psql',
    '-c',
    `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${literal(f.workspaceId)}, ${literal(member.user.id)}, 'member')`,
  ]);
  expect(
    (
      await page.request.post('/api/comments', {
        headers: member.headers,
        data: { id: randomUUID(), taskId: f.taskId, body: body('A second member’s comment') },
      })
    ).status(),
  ).toBe(201);
  const other = f.history.getByRole('article', { name: 'Another member commented' });
  await expect(other).toContainText('A second member’s comment');
  await expect(other.getByRole('button')).toHaveCount(0);
  await expect(other.locator('[contenteditable="true"]')).toHaveCount(0);
  await own.getByRole('button', { name: 'Delete comment', exact: true }).click();
  await own.getByRole('button', { name: 'Keep comment', exact: true }).click();
  await expect(own).toBeVisible();
  await own.getByRole('button', { name: 'Delete comment', exact: true }).click();
  await own.getByRole('button', { name: 'Delete comment', exact: true }).click();
  await expect(own).toHaveCount(0);
});

test('offline comments survive reload, sync in server order, and refused changes have a quiet exact-entry notice on both devices', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const f = await fixture(page);
  const editId = await f.comment('Edit offline');
  const deleteId = await f.comment('Delete offline');
  await expect(f.history).toContainText('Delete offline');
  await waitForCachedProject(
    page,
    f.projectId,
    f.statuses.map((row) => row.id),
  );
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  try {
    const otherPage = await context.newPage();
    await otherPage.goto(f.path);
    await expect(otherPage.getByRole('region', { name: 'Task history' })).toContainText(
      'Delete offline',
      { timeout: APP_LOAD_TIMEOUT },
    );
    await page.route('**/api/**', (route) => route.abort('connectionfailed'));
    await compose(page, 'Written offline');
    const pending = f.history.getByRole('article').filter({ hasText: 'Written offline' });
    await expect(pending).toContainText('Pending sync');
    await pending.getByRole('button', { name: 'Edit comment', exact: true }).click();
    await editor(page).fill('Written and edited offline');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const old = f.history.getByRole('article').filter({ hasText: 'Edit offline' });
    await old.getByRole('button', { name: 'Edit comment', exact: true }).click();
    await editor(page).fill('Existing comment edited offline');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const deleted = f.history.getByRole('article').filter({ hasText: 'Delete offline' });
    await deleted.getByRole('button', { name: 'Delete comment', exact: true }).click();
    await deleted.getByRole('button', { name: 'Delete comment', exact: true }).click();
    await compose(page, 'Discard before sync');
    const discarded = f.history.getByRole('article').filter({ hasText: 'Discard before sync' });
    await discarded.getByRole('button', { name: 'Delete comment', exact: true }).click();
    await discarded.getByRole('button', { name: 'Delete comment', exact: true }).click();
    const title = f.pane.getByRole('textbox', { name: 'Task title' });
    await title.fill('Offline title');
    await title.press('Enter');
    await f.update({ title: { before: 'Prepare the release', after: 'Server title' } });
    await page.reload();
    await expect(f.history).toContainText('Written and edited offline', {
      timeout: APP_LOAD_TIMEOUT,
    });
    await expect(f.history).toContainText('Pending sync');
    await expect(f.history).not.toContainText('Delete offline');
    await page.unroute('**/api/**');
    await expect(f.history).toContainText(
      'Title not applied: wanted “Offline title”; kept “Server title” because it changed before this update synced.',
      { timeout: 60_000 },
    );
    await expect(f.history).not.toContainText('Pending sync');
    const notice = page.getByRole('complementary', { name: 'Unapplied changes' });
    await notice.getByRole('button', { name: 'Review in history' }).click();
    const focused = f.history.locator('li:focus');
    await expect(focused).toContainText('Title not applied');
    await expect(otherPage.getByRole('complementary', { name: 'Unapplied changes' })).toBeVisible();
    await notice.getByRole('button', { name: 'Dismiss notice' }).click();
    await page.reload();
    await expect(f.history).toContainText('Title not applied', { timeout: APP_LOAD_TIMEOUT });
    await expect(notice).toHaveCount(0);
    await expect(otherPage.getByRole('complementary', { name: 'Unapplied changes' })).toBeVisible();
    await f.update({ title: { before: 'Prepare the release', after: 'Another refused title' } });
    await expect(notice).toHaveCount(1);
    await expect(f.history).toContainText('Another refused title');
    const rows = (await shapeRows(page.request, 'comments', f.headers)).filter(
      (row) => row.task_id === f.taskId,
    );
    expect(rows).toHaveLength(2);
    expect(rows.some((row) => row.id === deleteId)).toBe(false);
    expect(rows.find((row) => row.id === editId)?.body).toContain(
      'Existing comment edited offline',
    );
    expect(rows.every((row) => row.created_at !== null)).toBe(true);
  } finally {
    await context.close();
  }
});

test('refused descriptions recover through the existing controls on a device without a local draft', async ({
  page,
}) => {
  const f = await fixture(page);
  const version = randomUUID();
  await f.update({
    description: { before: null, after: { version, document: body('Current description') } },
  });
  await f.update({
    description: {
      before: null,
      after: { version: randomUUID(), document: body('Recover this description') },
    },
  });
  await expect(f.history).toContainText('Description not applied');
  await expect(f.history).not.toContainText('Recover this description');
  await f.history.getByRole('tab', { name: 'History' }).click();
  await f.history.getByRole('button', { name: 'Recover description' }).click();
  const description = f.pane.getByRole('region', { name: 'Description', exact: true });
  await expect(description).toContainText('Your description was not applied.');
  await expect(description.locator('[contenteditable="true"]')).toContainText(
    'Recover this description',
  );
  await description.getByRole('button', { name: 'Review latest description' }).click();
  await expect(description).toContainText('Current description');
  await description.getByRole('button', { name: 'Use latest description' }).click();
  await expect(description).not.toContainText('Recover this description');
  await f.update({ priority: { before: 3, after: 2 } });
  await expect(f.history).toContainText('Changed priority');
  await expect(description).not.toContainText('Recover this description');
  await description.locator('[contenteditable="true"]').fill('My current draft');
  await f.history.getByRole('button', { name: 'Recover description' }).click();
  await expect(description).toContainText('Your current draft is kept.');
  await expect(description.locator('[contenteditable="true"]')).toContainText('My current draft');
});

test('comment composition stays clear of the phone keyboard and dock in both themes', async ({
  page,
  isMobile,
  browserName,
}, testInfo) => {
  if (browserName === 'firefox') await page.setViewportSize({ width: 412, height: 915 });
  const phone = isMobile || browserName === 'firefox';
  const f = await fixture(page);
  await f.history.getByRole('button', { name: 'Write a comment…' }).click();
  await expect(editor(page)).toBeFocused({ timeout: APP_LOAD_TIMEOUT });
  await page.evaluate(() => document.documentElement.style.setProperty('--keyboard', '300px'));
  await editor(page).fill('Comment line 1');
  for (let line = 2; line <= 24; line++) {
    await editor(page).press('Enter');
    await page.keyboard.insertText(`Comment line ${line}`);
  }
  await editor(page).press('Control+End');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const selection = getSelection();
        if (!selection?.rangeCount) return false;
        const node = selection.focusNode;
        const element = node instanceof Element ? node : node?.parentElement;
        const caret = element?.closest('[data-content-type]')?.getBoundingClientRect();
        const dock = document.querySelector('[data-task-drawer]')?.getBoundingClientRect();
        return !!caret && !!dock && caret.bottom > 0 && caret.bottom <= dock.top;
      }),
    )
    .toBe(true);
  const post = page.getByRole('button', { name: 'Send', exact: true });
  if (phone) {
    await expect
      .poll(async () => {
        const button = (await post.boundingBox())!;
        const dock = (await page.locator('[data-task-drawer]').boundingBox())!;
        return button.y >= 0 && button.y + button.height <= dock.y;
      })
      .toBe(true);
  }
  await post.scrollIntoViewIfNeeded();
  if (phone)
    expect((await post.boundingBox())!.y + (await post.boundingBox())!.height).toBeLessThan(
      page.viewportSize()!.height - 300,
    );
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    const path = testInfo.outputPath(`history-keyboard-${colorScheme}.png`);
    await page.screenshot({ path });
    await testInfo.attach(colorScheme, { path, contentType: 'image/png' });
  }
  await post.click();
  await expect(f.history).toContainText('Comment line 24');
});

type Sample = { height: number; opacity: number; tabs: number; scrollTop: number };
/** Records the timeline's layout every frame until `stop` resolves. */
async function sampleFrames(page: Page, act: () => Promise<void>) {
  await page.evaluate(() => {
    const samples: Sample[] = [];
    (window as unknown as { samples: Sample[] }).samples = samples;
    const tick = () => {
      const box = document.querySelector<HTMLElement>('[data-task-timeline] [data-collapse]');
      const tabs = document.querySelector('[data-task-timeline] [role="tablist"]');
      const scroller = tabs?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
      if (box && tabs)
        samples.push({
          height: box.hidden ? 0 : box.getBoundingClientRect().height,
          opacity: Number(getComputedStyle(box.firstElementChild!).opacity),
          tabs: tabs.getBoundingClientRect().top,
          scrollTop: scroller?.scrollTop ?? 0,
        });
      (window as unknown as { sampling: number }).sampling = requestAnimationFrame(tick);
    };
    tick();
  });
  await act();
  return page.evaluate(() => {
    cancelAnimationFrame((window as unknown as { sampling: number }).sampling);
    return (window as unknown as { samples: Sample[] }).samples;
  });
}

test('comments and history hide together, ease in and out, and stay hidden on this device', async ({
  page,
}) => {
  const f = await fixture(page);
  await f.comment('A comment to keep in view');
  await expect(f.history).toContainText('A comment to keep in view');
  const timeline = f.history.locator('[data-collapse]');
  const commentsTab = f.history.getByRole('tab', { name: /^Comments/ });
  const historyTab = f.history.getByRole('tab', { name: 'History' });
  await expect(commentsTab).toHaveAttribute('aria-expanded', 'true');
  // A comment being written survives hiding both panels.
  await f.history.getByRole('button', { name: 'Write a comment…' }).click();
  await editor(page).fill('Still writing');
  // Opening the composer scrolls it clear of the pane's foot. From the top, folding the panels
  // cannot clamp the pane's scroll, so any movement would be the timeline's own.
  await f.history.evaluate((element) => {
    const area = element.closest('[data-slot="scroll-area-viewport"]');
    if (area) area.scrollTop = 0;
  });

  const closing = await sampleFrames(page, async () => {
    await commentsTab.click();
    await expect(timeline).toHaveAttribute('data-collapse', 'closed');
  });
  await expect(f.history.getByRole('tabpanel')).toHaveCount(0);
  await expect(commentsTab).toHaveAttribute('aria-selected', 'false');
  await expect(historyTab).toHaveAttribute('aria-selected', 'false');
  const full = closing[0]!.height;
  expect(full).toBeGreaterThan(40);
  // The content fades before the height closes, which never grows back on the way.
  const shrinking = closing.find((sample) => sample.height < full * 0.9)!;
  expect(shrinking.opacity).toBeLessThan(0.5);
  expect(closing.some((s) => s.height > 1 && s.height < full - 1)).toBe(true);
  for (let i = 1; i < closing.length; i++)
    expect(closing[i]!.height).toBeLessThanOrEqual(closing[i - 1]!.height + 0.5);
  // The tabs and the pane's scroll position stay where they were.
  for (const sample of closing) {
    expect(Math.abs(sample.tabs - closing[0]!.tabs)).toBeLessThan(1);
    expect(sample.scrollTop).toBe(closing[0]!.scrollTop);
  }

  const opening = await sampleFrames(page, async () => {
    await commentsTab.click();
    await expect(timeline).toHaveAttribute('data-collapse', 'open');
  });
  const opened = opening.at(-1)!;
  expect(opened.height).toBeGreaterThan(40);
  expect(opened.opacity).toBe(1);
  expect(opening.some((s) => s.height > 1 && s.height < opened.height - 1)).toBe(true);
  // Content arriving settles in, behind the room opening for it.
  const firstOpen = opening.find((sample) => sample.height > 1)!;
  expect(firstOpen.opacity).toBeLessThan(0.5);
  for (let i = 1; i < opening.length; i++)
    expect(opening[i]!.height).toBeGreaterThanOrEqual(opening[i - 1]!.height - 0.5);
  await expect(editor(page)).toHaveText('Still writing');

  // The choice is kept on this device.
  await commentsTab.click();
  await expect(timeline).toHaveAttribute('data-collapse', 'closed');
  await page.reload();
  await expect(historyTab).toBeVisible({ timeout: APP_LOAD_TIMEOUT });
  await expect(timeline).toHaveAttribute('data-collapse', 'closed');
  await expect(commentsTab).toHaveAttribute('tabindex', '0');
  await commentsTab.click();
  await expect(f.history.getByRole('button', { name: 'Resume comment draft' })).toBeVisible();

  // Rapid changes take over mid-way and end where the last one asked.
  await commentsTab.click();
  await historyTab.click();
  await historyTab.click();
  await commentsTab.click();
  await expect(timeline).toHaveAttribute('data-collapse', 'open');
  await expect(f.history.getByRole('tabpanel', { name: /^Comments/ })).toBeVisible();
});

test("switching panels springs to the new panel's height", async ({ page }) => {
  const f = await fixture(page);
  for (const line of ['First of several', 'Second of several', 'Third of several'])
    await f.comment(line);
  await expect(f.history).toContainText('Third of several');
  const timeline = f.history.locator('[data-collapse]');
  const commentsTab = f.history.getByRole('tab', { name: /^Comments/ });
  const historyTab = f.history.getByRole('tab', { name: 'History' });
  // From the bottom of the pane, where a sudden change of height would jump the page.
  await f.history.getByRole('button', { name: 'Write a comment…' }).scrollIntoViewIfNeeded();

  for (const [tab, panel] of [
    [historyTab, 'History'],
    [commentsTab, /^Comments/],
  ] as const) {
    const switching = await sampleFrames(page, async () => {
      await tab.click();
      await expect(f.history.getByRole('tabpanel', { name: panel })).toBeVisible();
      await expect(timeline).toHaveAttribute('data-collapse', 'open');
    });
    const from = switching[0]!.height;
    const to = switching.at(-1)!.height;
    expect(Math.abs(to - from)).toBeGreaterThan(20);
    // It passes through the heights between, one way, and the content stays shown.
    expect(
      switching.some((s) => Math.min(from, to) + 2 < s.height && s.height < Math.max(from, to) - 2),
    ).toBe(true);
    for (let i = 1; i < switching.length; i++) {
      const step = switching[i]!.height - switching[i - 1]!.height;
      expect(to > from ? step >= -0.5 : step <= 0.5).toBe(true);
      expect(Math.abs(switching[i]!.scrollTop - switching[i - 1]!.scrollTop)).toBeLessThan(
        Math.abs(to - from) * 0.6,
      );
    }
    expect(switching.every((s) => s.opacity === 1)).toBe(true);
  }
});

test('a sideways swipe turns between comments and history on a phone', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Swiping between panels is a touch gesture.');
  const f = await fixture(page);
  await f.comment('Swipe past me');
  await expect(f.history).toContainText('Swipe past me');
  const commentsTab = f.history.getByRole('tab', { name: /^Comments/ });
  const historyTab = f.history.getByRole('tab', { name: 'History' });
  const comments = f.history.getByRole('tabpanel', { name: /^Comments/ });
  const historyPanel = f.history.getByRole('tabpanel', { name: 'History' });
  const pill = f.history.locator('[data-tab-indicator]');
  await comments.scrollIntoViewIfNeeded();
  const session = await page.context().newCDPSession(page);
  const touch = (type: string, x = 0, y = 0) =>
    session.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y }],
    });
  // Drags from one share of the timeline's width to another, a frame at a time.
  const swipe = async (
    from: number,
    to: number,
    { lift = true, frames = 12, gap = 16, dy = 0, on = comments } = {},
  ) => {
    const area = (await f.history.boundingBox())!;
    const box = (await on.boundingBox())!;
    const y = box.y + Math.min(box.height / 2, 40);
    await touch('touchStart', area.x + area.width * from, y);
    for (let frame = 1; frame <= frames; frame++) {
      await touch(
        'touchMove',
        area.x + area.width * (from + ((to - from) * frame) / frames),
        y + (dy * frame) / frames,
      );
      await page.waitForTimeout(gap);
    }
    if (lift) await touch('touchEnd');
  };
  const shift = (locator: Locator) =>
    locator.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m41);
  const pillAt = await shift(pill);

  // Mid-swipe the panel follows the finger and the indicator heads for History.
  await swipe(0.8, 0.45, {
    lift: false,
    on: f.history.getByRole('button', { name: 'Write a comment…' }),
  });
  const panel = comments.locator('..');
  expect(await shift(panel)).toBeLessThan(-60);
  expect(await shift(pill)).toBeGreaterThan(pillAt + 20);
  // Drifting up at the bottom of the pane does not start pulling the task away.
  const button = (await f.history.getByRole('button', { name: 'Write a comment…' }).boundingBox())!;
  for (let step = 1; step <= 6; step++)
    await touch('touchMove', button.x + button.width * 0.45 - step * 20, button.y - step * 10);
  await touch('touchEnd');
  await expect(f.pane).toBeVisible();
  await expect(historyTab).toHaveAttribute('aria-selected', 'true');
  await expect(historyPanel).toBeVisible();
  await expect.poll(() => shift(historyPanel.locator('..'))).toBe(0);
  // The swipe began on the comment button, which it did not press.
  await expect(f.history.getByRole('button', { name: 'Resume comment draft' })).toHaveCount(0);
  await expect(f.history.locator('button', { hasText: 'Write a comment…' })).toHaveCount(1);

  // A short, slow drag springs back; swiping left again reaches Links, and nothing lies past it.
  await swipe(0.3, 0.45, { frames: 30, on: historyPanel });
  await expect(historyTab).toHaveAttribute('aria-selected', 'true');
  const linksTab = f.history.getByRole('tab', { name: /^Links/ });
  const linksPanel = f.history.getByRole('tabpanel', { name: /^Links/ });
  await swipe(0.8, 0.1, { on: historyPanel });
  await expect(linksTab).toHaveAttribute('aria-selected', 'true');
  await expect(linksPanel).toBeVisible();
  await swipe(0.8, 0.1, { on: linksPanel });
  await expect(linksTab).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => shift(linksPanel.locator('..'))).toBe(0);
  await expect
    .poll(async () => (await pill.boundingBox())!.x - (await linksTab.boundingBox())!.x)
    .toBeCloseTo(0, 0);

  // Quick flicks go back through History to Comments.
  await swipe(0.3, 0.55, { frames: 4, gap: 8, on: linksPanel });
  await expect(historyTab).toHaveAttribute('aria-selected', 'true');
  await expect(historyPanel).toBeVisible();
  await expect.poll(() => shift(historyPanel.locator('..'))).toBe(0);
  await swipe(0.3, 0.55, { frames: 4, gap: 8, on: historyPanel });
  await expect(commentsTab).toHaveAttribute('aria-selected', 'true');
  await expect(comments).toBeVisible();

  // Moving mostly down the pane is a scroll, not a swipe. (From the middle of its scroll: at
  // either end, the pull closes the task.)
  await f.history.evaluate((element) => {
    const scroller = element.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
    scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) / 2;
  });
  await swipe(0.6, 0.5, { dy: 40, on: f.history.getByRole('tablist') });
  await expect(f.pane).toBeVisible();
  await expect(commentsTab).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => shift(comments.locator('..'))).toBe(0);
  await session.detach();
});

test('the keyboard opens and hides panels, and a history entry opens hidden panels', async ({
  page,
}) => {
  const f = await fixture(page);
  const timeline = f.history.locator('[data-collapse]');
  const commentsTab = f.history.getByRole('tab', { name: /^Comments/ });
  const historyTab = f.history.getByRole('tab', { name: 'History' });
  await commentsTab.focus();
  await page.keyboard.press('Enter');
  await expect(timeline).toHaveAttribute('data-collapse', 'closed');
  await expect(commentsTab).toBeFocused();
  // Arrows move between hidden tabs without opening one; Space opens it.
  await page.keyboard.press('ArrowRight');
  await expect(historyTab).toBeFocused();
  await expect(timeline).toHaveAttribute('data-collapse', 'closed');
  await page.keyboard.press('Space');
  await expect(f.history.getByRole('tabpanel', { name: 'History' })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(f.history.getByRole('tabpanel', { name: /^Comments/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(timeline).toHaveAttribute('data-collapse', 'closed');

  // A refused change's notice jumps to its entry even with both panels hidden.
  const entry = await f.history.locator('li[id^="history-"]').first().getAttribute('id');
  await page.evaluate(async (id) => {
    const { focusHistory } = await import('/src/components/TaskDetails/TaskTimeline.tsx');
    focusHistory(id.replace('history-', ''));
  }, entry!);
  await expect(historyTab).toHaveAttribute('aria-selected', 'true');
  await expect(f.history.locator(`[id="${entry}"]`)).toBeFocused();
  await expect(timeline).toHaveAttribute('data-collapse', 'open');
});

test('hiding panels is instant with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const f = await fixture(page);
  const commentsTab = f.history.getByRole('tab', { name: /^Comments/ });
  const timeline = f.history.locator('[data-collapse]');
  const closing = await sampleFrames(page, async () => {
    await commentsTab.click();
    await expect(timeline).toHaveAttribute('data-collapse', 'closed');
  });
  const full = closing[0]!.height;
  expect(closing.every((s) => s.height === 0 || s.height === full)).toBe(true);
  const opening = await sampleFrames(page, async () => {
    await commentsTab.click();
    await expect(timeline).toHaveAttribute('data-collapse', 'open');
  });
  expect(opening.every((s) => s.height === 0 || s.height === full)).toBe(true);
  expect(opening.every((s) => s.opacity === 0 || s.opacity === 1)).toBe(true);
  const switching = await sampleFrames(page, async () => {
    await f.history.getByRole('tab', { name: 'History' }).click();
    await expect(f.history.getByRole('tabpanel', { name: 'History' })).toBeVisible();
  });
  const to = switching.at(-1)!.height;
  expect(switching.every((s) => s.height === full || s.height === to)).toBe(true);
});

/** The task's scroller, and where its tabs and the open panel sit in its view. */
async function revealState(history: Locator) {
  return history.evaluate((element) => {
    const scroller = element.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
    const view = scroller.getBoundingClientRect();
    const style = getComputedStyle(scroller);
    const tabs = element.querySelector('[role="tablist"]')!.getBoundingClientRect();
    const panel = element.querySelector('[role="tabpanel"]:not([hidden])')?.getBoundingClientRect();
    return {
      scrollTop: scroller.scrollTop,
      end: scroller.scrollHeight - scroller.clientHeight,
      tabsTop: tabs.top - view.top,
      tabsBottom: tabs.bottom - view.top,
      panelBottom: panel ? panel.bottom - view.top : null,
      height: scroller.clientHeight,
      above: Math.max(Number.parseFloat(style.scrollPaddingTop) || 0, 16),
      below: Number.parseFloat(style.scrollPaddingBottom) || 0,
    };
  });
}

/** Waits for the pane's scroll to come to rest. */
async function scrollSettled(history: Locator) {
  let last = -1;
  await expect
    .poll(async () => {
      const { scrollTop } = await revealState(history);
      const still = Math.abs(scrollTop - last) < 0.5;
      last = scrollTop;
      return still;
    })
    .toBe(true);
  return revealState(history);
}

async function longDescription(f: Awaited<ReturnType<typeof fixture>>) {
  const document = Array.from({ length: 40 }, (_, index) => ({
    type: 'paragraph',
    content: [{ type: 'text', text: `Background paragraph ${index + 1} for the release.` }],
  }));
  await f.update({ description: { before: null, after: { version: randomUUID(), document } } });
  await expect(f.pane).toContainText('Background paragraph 40', { timeout: APP_LOAD_TIMEOUT });
}

/** Hides the panels and scrolls the pane to its end, so the tabs sit at its foot. */
async function tabsAtFoot(f: Awaited<ReturnType<typeof fixture>>) {
  const timeline = f.history.locator('[data-collapse]');
  // Pressing the selected tab hides the panels.
  await f.history.getByRole('tab', { selected: true }).click();
  await expect(timeline).toHaveAttribute('data-collapse', 'closed');
  await f.history.evaluate((element) => {
    const scroller = element.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
    scroller.scrollTop = scroller.scrollHeight;
  });
  const before = await scrollSettled(f.history);
  expect(before.scrollTop).toBeGreaterThan(100);
  return before;
}

test('opening a short panel scrolls the pane to its end', async ({ page }) => {
  const f = await fixture(page);
  await longDescription(f);
  const before = await tabsAtFoot(f);
  const opening = await sampleFrames(page, async () => {
    await f.history.getByRole('tab', { name: 'History' }).click();
    await expect(f.history.getByRole('tabpanel', { name: 'History' })).toBeVisible();
    await expect(f.history.locator('[data-collapse]')).toHaveAttribute('data-collapse', 'open');
  });
  const after = await scrollSettled(f.history);
  expect(after.scrollTop).toBeGreaterThan(before.scrollTop + 20);
  // The scroll keeps step with the panel opening rather than waiting for it, and never
  // turns back on the way.
  const full = opening.at(-1)!.height;
  const midway = opening.filter((s) => s.height > full * 0.3 && s.height < full * 0.7);
  expect(midway.length).toBeGreaterThan(0);
  for (const sample of midway) {
    const share = (sample.scrollTop - before.scrollTop) / (after.scrollTop - before.scrollTop);
    expect(Math.abs(share - sample.height / full)).toBeLessThan(0.25);
  }
  for (let i = 1; i < opening.length; i++)
    expect(opening[i]!.scrollTop).toBeGreaterThanOrEqual(opening[i - 1]!.scrollTop - 0.5);
  // It lands with the panel: as both slow down at the end, no step catches up with a jump.
  for (let i = 2; i < opening.length; i++) {
    if (opening[i]!.height < full * 0.8) continue;
    const step = opening[i]!.scrollTop - opening[i - 1]!.scrollTop;
    const previous = opening[i - 1]!.scrollTop - opening[i - 2]!.scrollTop;
    expect(step).toBeLessThanOrEqual(Math.max(previous, 0) + 1);
  }
  expect(Math.abs(after.scrollTop - after.end)).toBeLessThan(2);
  // The tabs stay in view, clear of anything floating over the top.
  expect(after.tabsTop).toBeGreaterThanOrEqual(after.above - 1);
  expect(after.panelBottom!).toBeLessThanOrEqual(after.height - after.below + 1);

  // The Links tab, where links are tabbed, reveals its panel the same way.
  const linksTab = f.history.getByRole('tab', { name: /^Links/ });
  if (await linksTab.isVisible()) {
    await tabsAtFoot(f);
    await linksTab.click();
    await expect(f.history.getByRole('tabpanel', { name: /^Links/ })).toBeVisible();
    await expect
      .poll(async () => {
        const state = await revealState(f.history);
        return Math.abs(state.scrollTop - state.end) < 2;
      })
      .toBe(true);
  }
});

test('opening a tall panel scrolls until its tabs reach the top of the pane', async ({ page }) => {
  const f = await fixture(page);
  for (let index = 1; index <= 24; index++) await f.comment(`Comment number ${index}`);
  await expect(f.history).toContainText('Comment number 24');
  await longDescription(f);
  await tabsAtFoot(f);
  await f.history.getByRole('tab', { name: /^Comments/ }).click();
  await expect(f.history.getByRole('tabpanel', { name: /^Comments/ })).toBeVisible();
  await expect
    .poll(async () => {
      const state = await revealState(f.history);
      return Math.abs(state.tabsTop - state.above) < 2;
    })
    .toBe(true);
  const after = await scrollSettled(f.history);
  expect(Math.abs(after.tabsTop - after.above)).toBeLessThan(2);
  expect(after.scrollTop).toBeLessThan(after.end - 50);
  // On a phone the tabs sit below the floating Back and trash toolbars, and can be pressed.
  await f.history.getByRole('tab', { name: 'History' }).click({ trial: true });
});

test('a panel already in view does not scroll the pane', async ({ page }) => {
  const f = await fixture(page);
  await expect(f.history.getByRole('tabpanel', { name: /^Comments/ })).toBeVisible();
  const start = await revealState(f.history);
  test.skip(
    start.panelBottom! + 120 > start.height - start.below,
    'The pane is too short to show both panels whole.',
  );
  await f.history.getByRole('tab', { name: 'History' }).click();
  await expect(f.history.getByRole('tabpanel', { name: 'History' })).toBeVisible();
  await expect(f.history.locator('[data-collapse]')).toHaveAttribute('data-collapse', 'open');
  const after = await scrollSettled(f.history);
  expect(after.scrollTop).toBe(start.scrollTop);
});

test('with reduced motion a panel is revealed without scrolling through', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const f = await fixture(page);
  await longDescription(f);
  await tabsAtFoot(f);
  const jumping = await sampleFrames(page, async () => {
    await f.history.getByRole('tab', { name: /^Comments/ }).click();
    await expect
      .poll(async () => {
        const state = await revealState(f.history);
        return Math.abs(state.scrollTop - state.end) < 2;
      })
      .toBe(true);
  });
  // The pane goes straight to its new place, with no frames between.
  const from = jumping[0]!.scrollTop;
  const to = jumping.at(-1)!.scrollTop;
  expect(to).toBeGreaterThan(from + 20);
  expect(
    jumping.every((s) => Math.abs(s.scrollTop - from) < 1 || Math.abs(s.scrollTop - to) < 1),
  ).toBe(true);
});
