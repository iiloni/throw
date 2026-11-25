import { expect, type Page, test } from '@playwright/test';
import { finger, settled } from './board-helpers';
import { APP_LOAD_TIMEOUT, createAccount, shapeRows, signUp } from './helpers';

type Account = Awaited<ReturnType<typeof createAccount>>;

/**
 * Gives the page's account a workspace name of its own, to tell whose data is showing, and
 * waits for the server to have it, so another tab loading the account sees it too.
 */
async function nameWorkspace(page: Page, name: string) {
  // A reload's snapshot can briefly empty the collection behind what the page shows.
  await expect
    .poll(
      () =>
        page.evaluate(async (name) => {
          const { workspacesCollection } = await import(
            /* @vite-ignore */ '/src/lib/collections.ts'
          );
          const { renameWorkspace } = await import(/* @vite-ignore */ '/src/lib/workspaces.ts');
          const [workspace] = [...workspacesCollection.values()] as { id: string }[];
          if (!workspace) return false;
          renameWorkspace(workspace.id, name);
          return true;
        }, name),
      { timeout: APP_LOAD_TIMEOUT },
    )
    .toBe(true);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(
          async () =>
            (await import(/* @vite-ignore */ '/src/lib/syncStatus.ts')).getSyncStatus().pending,
        ),
      { timeout: APP_LOAD_TIMEOUT },
    )
    .toBe(0);
}

const phone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

/**
 * The list of the device's accounts (ADR 0016): beside the desktop rail's avatar, or in the
 * phone's project switcher.
 */
async function openAccounts(page: Page) {
  if (phone(page)) {
    await page.getByRole('button', { name: 'Switch project or workspace', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Projects' })
      .getByRole('button', { name: /^Account: / })
      .click();
  } else {
    await page.getByRole('button', { name: /^Account: / }).click();
  }
  // The popover or the drawer's page, not Settings' own list of them.
  const list = page.getByRole('dialog').getByRole('list', { name: 'Accounts' });
  await expect(list).toBeVisible();
  return list;
}

/** Signs another account in from the list's "Add account", beside the one in use. */
async function addAccount(page: Page) {
  const account = await createAccount(page.request);
  await openAccounts(page);
  await page.getByRole('link', { name: 'Add account' }).click();
  await expect(page.getByRole('button', { name: 'Back to your tasks' })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Personal', exact: true })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
  return account;
}

async function switchAccount(page: Page, account: Account) {
  const list = await openAccounts(page);
  await list.getByRole('button', { name: account.email, exact: true }).click();
}

async function signOutAccount(page: Page, account: Account) {
  const list = await openAccounts(page);
  await list.getByRole('button', { name: `Sign out ${account.email}`, exact: true }).click();
  const confirm = page.getByRole('dialog', { name: `Sign out ${account.email}?` });
  await confirm.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(confirm).toBeHidden({ timeout: APP_LOAD_TIMEOUT });
}

/**
 * A swipe across the account's avatar: sideways with a mouse on desktop, and on a phone upwards
 * with a real finger, inside the drawer that has a pull of its own.
 */
async function swipeAvatar(page: Page) {
  if (!phone(page)) {
    const avatar = await settled(
      page.getByRole('button', { name: /^Account: / }).locator('[data-account-avatar]'),
    );
    const box = await avatar.boundingBox();
    if (!box) throw new Error('No avatar to swipe');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 12, y, { steps: 3 });
    await page.mouse.move(x - 28, y, { steps: 3 });
    await page.mouse.up();
    return;
  }
  await page.getByRole('button', { name: 'Switch project or workspace', exact: true }).click();
  const avatar = await settled(
    page
      .getByRole('dialog', { name: 'Projects' })
      .getByRole('button', { name: /^Account: / })
      .locator('[data-account-avatar]'),
  );
  const box = await avatar.boundingBox();
  if (!box) throw new Error('No avatar to swipe');
  const touch = await finger(page);
  await touch.press(avatar, 30);
  await touch.move({ x: box.x + box.width / 2, y: box.y + box.height / 2 - 30 }, 160);
  await touch.lift();
}

/** What the device keeps for an account: its SQLite files and its outbox. */
function storedFor(page: Page, account: Account) {
  return page.evaluate(async (userId) => {
    const root = await navigator.storage.getDirectory();
    let database = false;
    for await (const name of root.keys()) if (name.startsWith(`throw-${userId}`)) database = true;
    const outbox = (await indexedDB.databases()).some(
      ({ name }) => name === `throw-outbox-${userId}`,
    );
    return { database, outbox };
  }, account.user.id);
}

const summary = (page: Page) => page.getByRole('region', { name: 'Signed in as' });

test('accounts signed in together keep their own data, at their own addresses', async ({
  page,
}) => {
  const first = await signUp(page);
  await nameWorkspace(page, 'First space');
  // One account has nobody to be told apart from.
  await expect(page).toHaveURL(/^[^?#]*\/\/[^/]+\/w\//);

  const second = await addAccount(page);
  // With several signed in, the address says whose page it is, through the router's
  // redirects too.
  await expect(page).toHaveURL(/\/u\/2\/w\//);
  await expect(page.getByRole('heading', { name: 'First space' })).toBeHidden();
  await nameWorkspace(page, 'Second space');

  // A swipe across the avatar goes to the other account.
  await swipeAvatar(page);
  await expect(page.getByText(`Switched to ${first.email}`)).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
  await expect(page).toHaveURL(/\/u\/1\/w\//);
  await expect(page.getByRole('heading', { name: 'First space' })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
  await expect(page.getByRole('heading', { name: 'Second space' })).toBeHidden();
  // The list marks the account in use, and a tap on another switches to it.
  const list = await openAccounts(page);
  await expect(list.getByRole('button', { name: first.email, exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await list.getByRole('button', { name: second.email, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Second space' })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
  await expect(page).toHaveURL(/\/u\/2\/w\//);
  await switchAccount(page, first);
  await expect(page.getByRole('heading', { name: 'First space' })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });

  // The browser's cookie is the second account's; the bearer token says whose write it is.
  await nameWorkspace(page, 'First renamed');
  await expect
    .poll(async () => (await shapeRows(page.request, 'workspaces', first.headers))[0]?.name)
    .toBe('First renamed');
  expect((await shapeRows(page.request, 'workspaces', second.headers))[0]?.name).toBe(
    'Second space',
  );
});

test('tabs show different accounts side by side, and signing one out leaves the rest', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Tabs and signing out do not depend on the layout.');
  const first = await signUp(page);
  await nameWorkspace(page, 'First space');
  const second = await addAccount(page);
  await nameWorkspace(page, 'Second space');

  // A new tab starts as the account last used.
  const tab = await page.context().newPage();
  await tab.goto('/');
  await expect(tab).toHaveURL(/\/u\/2\/w\//, { timeout: APP_LOAD_TIMEOUT });
  await expect(tab.getByRole('heading', { name: 'Second space' })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });

  await switchAccount(page, first);
  await expect(page.getByRole('heading', { name: 'First space' })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });

  // The other tab keeps the second account through a reload, and each writes as its own.
  await tab.reload();
  await expect(tab).toHaveURL(/\/u\/2\/w\//);
  await expect(tab.getByRole('heading', { name: 'Second space' })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
  await nameWorkspace(tab, 'Second renamed');
  await nameWorkspace(page, 'First renamed');
  await expect(tab.getByRole('heading', { name: 'Second renamed' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'First renamed' })).toBeVisible();

  expect(await storedFor(page, second)).toEqual({ database: true, outbox: true });
  await signOutAccount(page, second);
  // This page stays as it is.
  await expect(page.getByRole('heading', { name: 'First renamed' })).toBeVisible();
  // The tab that showed the signed-out account moves to the one left, which needs no number,
  // and deletes the database it held open.
  await expect(tab.getByRole('heading', { name: 'First renamed' })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
  await expect(tab).toHaveURL(/^[^?#]*\/\/[^/]+\/w\//);
  await expect.poll(() => storedFor(page, second)).toEqual({ database: false, outbox: false });
  expect(await storedFor(page, first)).toEqual({ database: true, outbox: true });
  await tab.close();

  // Signing out the account in use goes on as another, and to sign-in only when none is left.
  await addAccount(page);
  await page.goto('/settings/account');
  await expect(page).toHaveURL(/\/u\/3\/settings\/account$/);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'First renamed' })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
  await page.goto('/settings/account');
  await expect(summary(page)).toContainText(first.email);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/, { timeout: APP_LOAD_TIMEOUT });
  await expect(page.getByRole('button', { name: 'Back to your tasks' })).toBeHidden();
});

test('an address names its account, as a bookmark of it does', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Addresses do not depend on the layout.');
  const first = await signUp(page);
  await nameWorkspace(page, 'First space');
  const second = await addAccount(page);
  await nameWorkspace(page, 'Second space');

  // The tab shows the second account; the address asks for the first.
  await page.goto('/u/1/');
  await expect(page.getByRole('heading', { name: 'First space' })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
  await expect(page).toHaveURL(/\/u\/1\/w\//);
  // Links within the app keep the account's number.
  await page.goto('/u/1/settings/account');
  await expect(summary(page)).toContainText(first.email, { timeout: APP_LOAD_TIMEOUT });
  await page.reload();
  await expect(summary(page)).toContainText(first.email, { timeout: APP_LOAD_TIMEOUT });

  // Another tab opens the other account's address beside it.
  const tab = await page.context().newPage();
  await tab.goto('/u/2/settings/account');
  await expect(summary(tab)).toContainText(second.email, { timeout: APP_LOAD_TIMEOUT });
  await tab.close();

  // An address of an account that signed out asks for it, then carries on to its page.
  await signOutAccount(page, second);
  await page.goto('/u/2/settings/account');
  await expect(page).toHaveURL(/\/login\?redirect=%2Fsettings%2Faccount$/, {
    timeout: APP_LOAD_TIMEOUT,
  });
  await page.getByLabel('Email').fill(second.email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // It signs in again with the number its bookmarks name.
  await expect(page).toHaveURL(/\/u\/2\/settings\/account$/, { timeout: APP_LOAD_TIMEOUT });
  await expect(summary(page)).toContainText(second.email, { timeout: APP_LOAD_TIMEOUT });
  // A number nobody has on this device asks to sign in, too.
  await page.goto('/u/9/');
  await expect(page).toHaveURL(/\/login$/, { timeout: APP_LOAD_TIMEOUT });
  await expect(page.getByRole('button', { name: 'Back to your tasks' })).toBeVisible();
});

test('putting the accounts in order renumbers their addresses, in every open tab', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Addresses do not depend on the layout.');
  await signUp(page);
  await nameWorkspace(page, 'First space');
  const second = await addAccount(page);
  await nameWorkspace(page, 'Second space');
  await expect(page).toHaveURL(/\/u\/2\/w\//);
  const tab = await page.context().newPage();
  await tab.goto('/u/1/');
  await expect(tab.getByRole('heading', { name: 'First space' })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });

  const list = await openAccounts(page);
  await page.getByRole('button', { name: `Move ${second.email}` }).press('ArrowUp');
  await expect(list.getByRole('listitem').first()).toContainText(second.email);

  // Both tabs keep their accounts and take their new numbers, without loading again.
  await expect(page).toHaveURL(/\/u\/1\/w\//);
  await expect(tab).toHaveURL(/\/u\/2\/w\//);
  await expect(tab.getByRole('heading', { name: 'First space' })).toBeVisible();
  await expect(tab.getByRole('link', { name: 'Settings' })).toHaveAttribute(
    'href',
    '/u/2/settings',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveAttribute(
    'href',
    '/u/1/settings',
  );
  // The new numbers hold across loads.
  await page.goto('/u/1/');
  await expect(page.getByRole('heading', { name: 'Second space' })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
  await tab.reload();
  await expect(tab).toHaveURL(/\/u\/2\/w\//, { timeout: APP_LOAD_TIMEOUT });
  await expect(tab.getByRole('heading', { name: 'First space' })).toBeVisible();
  await tab.close();
});
