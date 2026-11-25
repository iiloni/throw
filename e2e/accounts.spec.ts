import { expect, type Page, test } from '@playwright/test';
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

/** Signs another account in from the sign-in page, beside the one in use (ADR 0016). */
async function addAccount(page: Page) {
  const account = await createAccount(page.request);
  await page.goto('/login');
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
  await page.evaluate(async (userId) => {
    const { switchAccount } = await import(/* @vite-ignore */ '/src/lib/accounts.ts');
    switchAccount(userId);
  }, account.user.id);
}

async function signOutAccount(page: Page, account: Account) {
  await page.evaluate(async (userId) => {
    const { getAccounts } = await import(/* @vite-ignore */ '/src/lib/auth.ts');
    const { signOutAccount } = await import(/* @vite-ignore */ '/src/lib/accounts.ts');
    const listed = getAccounts().find(({ user }) => user.id === userId);
    if (!listed) throw new Error('That account is not signed in here');
    await signOutAccount(listed);
  }, account.user.id);
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

  await switchAccount(page, first);
  await expect(page.getByText(`Switched to ${first.email}`)).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
  await expect(page).toHaveURL(/\/u\/1\/w\//);
  await expect(page.getByRole('heading', { name: 'First space' })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
  await expect(page.getByRole('heading', { name: 'Second space' })).toBeHidden();

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
