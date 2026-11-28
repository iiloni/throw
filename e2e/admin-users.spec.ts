import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { APP_LOAD_TIMEOUT, bearerToken, createAccount, signUp } from './helpers';

const origin = () => new URL(test.info().project.use.baseURL ?? '').origin;
const freshEmail = () => `e2e-invited-${crypto.randomUUID()}@example.com`;

async function signInAsAdmin(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password').fill('adminadmin');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/login/, { timeout: APP_LOAD_TIMEOUT });
}

async function adminHeaders(request: APIRequestContext) {
  const response = await request.post('/api/auth/sign-in/email', {
    headers: { Origin: origin() },
    data: { email: 'admin@example.com', password: 'adminadmin' },
  });
  expect(response.ok()).toBeTruthy();
  return { Authorization: `Bearer ${bearerToken(response)}` };
}

async function createInvite(request: APIRequestContext, label: string) {
  const response = await request.post('/api/admin/invites', {
    headers: { ...(await adminHeaders(request)), 'X-Throw-Protocol': '1' },
    data: { label },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { token: string; invite: { id: string } };
}

const signUpWith = (request: APIRequestContext, email: string, invite: string) =>
  request.post('/api/auth/sign-up/email', {
    headers: { Origin: origin(), 'X-Throw-Invite': invite },
    data: { email, name: '', password: 'password123' },
  });

test('admins change roles, reset passwords, delete accounts and make invite links', async ({
  page,
  isMobile,
}) => {
  const target = await createAccount(page.request);
  await signInAsAdmin(page);
  await page.goto('/settings/admin');
  await expect(page).toHaveURL(/\/settings\/admin\/users$/);
  if (isMobile) {
    await expect(page.getByRole('button', { name: 'Settings page: Users' })).toBeVisible();
  } else {
    const admin = page
      .getByRole('navigation', { name: 'Settings pages' })
      .getByRole('region', { name: 'Admin' });
    await expect(admin.getByRole('link', { name: 'Users', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  }

  const users = page.getByRole('list', { name: 'Users' });
  await expect(users.getByRole('listitem', { name: 'admin@example.com' })).toContainText('You');
  await page.getByRole('searchbox', { name: 'Search users' }).fill(target.email);
  const row = users.getByRole('listitem', { name: target.email });
  await expect(row).toBeVisible();
  await expect(users.getByRole('listitem')).toHaveCount(1);
  await expect(row).toContainText('User');
  await expect(row).toContainText('Last sign-in');

  const manage = row.getByRole('button', { name: `Manage ${target.email}` });
  const choose = async (item: string) => {
    // A menu still animating closed dismisses one reopened from its trigger.
    await expect(page.getByRole('menu')).toHaveCount(0);
    await manage.click();
    await page.getByRole('menuitem', { name: item, exact: true }).click();
  };

  await choose('Make admin');
  const promote = page.getByRole('dialog', { name: `Make ${target.email} an admin?` });
  await promote.getByRole('button', { name: 'Make admin', exact: true }).click();
  await expect(promote).toHaveCount(0);
  await expect(row).toContainText('Admin');
  await choose('Remove admin access');
  const demote = page.getByRole('dialog', { name: `Remove ${target.email}’s admin access?` });
  await demote.getByRole('button', { name: 'Remove admin access', exact: true }).click();
  await expect(demote).toHaveCount(0);
  await expect(row).toContainText('User');

  await choose('Reset password');
  await page
    .getByRole('dialog', { name: 'Reset password?' })
    .getByRole('button', { name: 'Reset password', exact: true })
    .click();
  const shown = page.getByRole('dialog', { name: 'Temporary password' });
  const temporary = await shown.getByLabel('Temporary password', { exact: true }).inputValue();
  expect(temporary.length).toBeGreaterThanOrEqual(8);
  // The old session ended with the reset; the temporary password signs in.
  const ended = await page.request.get('/api/mcp-tokens', {
    headers: { ...target.headers, 'X-Throw-Protocol': '1' },
  });
  expect(ended.status()).toBe(401);
  const signIn = await page.request.post('/api/auth/sign-in/email', {
    headers: { Origin: origin() },
    data: { email: target.email, password: temporary },
  });
  expect(signIn.ok()).toBeTruthy();
  await shown.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(shown).toHaveCount(0);

  await choose('Delete user');
  const remove = page.getByRole('dialog', { name: 'Delete user?' });
  await remove.getByRole('button', { name: 'Delete user', exact: true }).click();
  await expect(remove).toHaveCount(0);
  await expect(page.getByText('No accounts match this search.')).toBeVisible();

  // An invite made here signs one person up, then reads as used.
  const label = `Guest ${crypto.randomUUID().slice(0, 8)}`;
  await page.getByRole('button', { name: 'Create invite', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Create invite' });
  await form.getByLabel('Who is it for?').fill(label);
  await form.getByRole('button', { name: 'Create invite', exact: true }).click();
  const made = page.getByRole('dialog', { name: 'Copy the invite link' });
  const link = await made.getByLabel('Invite link', { exact: true }).inputValue();
  expect(link).toMatch(/\/login#invite=[\w-]{43}$/);
  await made.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(made).toHaveCount(0);
  const invite = page.getByRole('list', { name: 'Invites' }).getByRole('listitem', { name: label });
  await expect(invite).toContainText('Usable until');

  const invited = freshEmail();
  const token = new URL(link).hash.slice('#invite='.length);
  expect((await signUpWith(page.request, invited, token)).ok()).toBeTruthy();
  expect((await signUpWith(page.request, freshEmail(), token)).status()).toBe(403);
  await page.reload();
  await expect(invite).toContainText(`by ${invited}`);
  await invite.getByRole('button', { name: `Remove ${label}`, exact: true }).click();
  await expect(invite).toHaveCount(0);
});

test('an invite link opens sign-up and makes the account', async ({ page }) => {
  const { token } = await createInvite(page.request, 'Link');
  await page.goto(`/login#invite=${token}`);
  await expect(page.getByText('You have been invited to this Throw server.')).toBeVisible();
  // The link carries the invite: there is nothing to paste.
  await expect(page.getByLabel('Invite link', { exact: true })).toHaveCount(0);
  const email = freshEmail();
  await page.getByLabel('Name').fill('Invited Person');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Personal' })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
  // The spent invite does not follow the person into the app.
  expect(new URL(page.url()).hash).toBe('');
  const again = await signUpWith(page.request, freshEmail(), token);
  expect(again.status()).toBe(403);
});

test('a pasted invite link signs up, and a broken or revoked one is refused', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'The sign-up form is the same on both layouts; the link test covers both.');
  const { token } = await createInvite(page.request, 'Pasted');
  await page.goto('/login');
  await page.getByRole('button', { name: 'Need an account? Sign up' }).click();
  await page.getByLabel('Email').fill(freshEmail());
  await page.getByLabel('Password').fill('password123');
  const field = page.getByLabel('Invite link', { exact: true });
  await field.fill('https://throw.example.com/login#invite=short');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(/not a whole invite link/);

  // A revoked invite is refused by the server.
  const revoked = await createInvite(page.request, 'Revoked');
  const removed = await page.request.delete(`/api/admin/invites/${revoked.invite.id}`, {
    headers: { ...(await adminHeaders(page.request)), 'X-Throw-Protocol': '1' },
  });
  expect(removed.ok()).toBeTruthy();
  await field.fill(`${origin()}/login#invite=${revoked.token}`);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(/invalid, expired or already used/);

  await field.fill(`${origin()}/login#invite=${token}`);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Personal' })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
});

test('regular accounts cannot open the user directory', async ({ page, isMobile }) => {
  const { headers } = await signUp(page);
  await page.goto('/settings/admin/users');
  await expect(page).toHaveURL(/\/settings\/general$/);
  if (!isMobile) {
    const nav = page.getByRole('navigation', { name: 'Settings pages' });
    await expect(nav.getByRole('link', { name: 'Users', exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('list', { name: 'Users' })).toHaveCount(0);
  for (const path of ['users', 'invites']) {
    const response = await page.request.get(`/api/admin/${path}`, {
      headers: { ...headers, 'X-Throw-Protocol': '1' },
    });
    expect(response.status()).toBe(403);
  }
});
