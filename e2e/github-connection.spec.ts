import { createHmac, randomUUID } from 'node:crypto';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import {
  githubConnectionResponseSchema,
  githubConnectionSecretResponseSchema,
} from '../packages/shared/src/github';
import { STARTER_STATUSES } from '../packages/shared/src/statuses';
import { webhooksResponseSchema } from '../packages/shared/src/webhooks';
import { APP_LOAD_TIMEOUT, createAccount, signUp } from './helpers';

type Account = Awaited<ReturnType<typeof createAccount>>;

async function firstWorkspace(request: APIRequestContext, account: Account) {
  const response = await request.get('/api/webhooks', { headers: account.headers });
  return webhooksResponseSchema.parse(await response.json()).workspaces[0]!.id;
}

async function makeProject(request: APIRequestContext, account: Account) {
  const workspaceId = await firstWorkspace(request, account);
  const project = {
    id: randomUUID(),
    workspaceId,
    name: 'Linked',
    key: 'LNK',
    color: 'teal',
    icon: null,
    position: 'a0',
    statuses: STARTER_STATUSES.map((status) => ({
      ...status,
      id: randomUUID(),
      position: 'a0',
      isDefault: true,
    })),
  };
  expect(
    (await request.post('/api/projects', { data: project, headers: account.headers })).status(),
  ).toBe(201);
  return project;
}

const managed = (projectId: string, rest = '') =>
  `/api/integrations/github/projects/${projectId}${rest}`;

/** Posts to the connection's URL as GitHub does: no session, signed with the secret. */
function deliver(
  request: APIRequestContext,
  webhookUrl: string,
  secret: string,
  {
    event = 'ping',
    delivery = randomUUID(),
    repository = 'octo-org/website',
    signature,
  }: { event?: string; delivery?: string; repository?: string | null; signature?: string } = {},
) {
  const body = JSON.stringify({
    zen: 'Design for failure.',
    hook_id: 1,
    ...(repository ? { repository: { full_name: repository } } : {}),
  });
  return request.post(new URL(webhookUrl).pathname, {
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': event,
      'X-GitHub-Delivery': delivery,
      'X-Hub-Signature-256':
        signature ?? `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    },
    data: body,
  });
}

async function connection(request: APIRequestContext, account: Account, projectId: string) {
  const response = await request.get(managed(projectId), { headers: account.headers });
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  return githubConnectionResponseSchema.parse(await response.json()).connection;
}

test('a project connects to GitHub and receives signed, deduplicated deliveries @api', async ({
  request,
}) => {
  const owner = await createAccount(request);
  const project = await makeProject(request, owner);
  expect(await connection(request, owner, project.id)).toBeNull();

  const created = await request.post(managed(project.id), {
    headers: owner.headers,
    data: {
      repository: 'https://github.com/octo-org/website.git',
      authMode: 'token',
      token: 'github_pat_11AAAAAAA0123456789abcdef',
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  expect(created.headers()['cache-control']).toBe('no-store');
  const { secret, connection: made } = githubConnectionSecretResponseSchema.parse(
    await created.json(),
  );
  expect(secret).toMatch(/^throw_ghsec_[\w-]{43}$/);
  expect(made).toMatchObject({
    repository: 'octo-org/website',
    authMode: 'token',
    hasToken: true,
    enabled: true,
    lastDelivery: null,
  });
  expect(made.webhookUrl).toMatch(/\/api\/integrations\/github\/webhooks\/[\w-]{32}$/);
  const listed = await request.get(managed(project.id), { headers: owner.headers });
  const text = await listed.text();
  expect(text).not.toContain(secret);
  expect(text).not.toContain('github_pat_');
  expect(
    (
      await request.post(managed(project.id), {
        headers: owner.headers,
        data: { repository: 'octo-org/website' },
      })
    ).status(),
  ).toBe(409);

  // Another account cannot see, change, rotate or delete it.
  const stranger = await createAccount(request);
  expect((await request.get(managed(project.id), { headers: stranger.headers })).status()).toBe(
    404,
  );
  for (const [method, path] of [
    ['PATCH', managed(project.id)],
    ['POST', managed(project.id, '/secret')],
    ['POST', managed(project.id, '/url')],
  ] as const) {
    const response = await request.fetch(path, {
      method,
      headers: stranger.headers,
      data: method === 'PATCH' ? { enabled: false } : undefined,
    });
    expect(response.status(), `${method} ${path}`).toBe(404);
  }
  expect((await request.delete(managed(project.id), { headers: stranger.headers })).status()).toBe(
    204,
  );
  expect(await connection(request, owner, project.id)).toMatchObject({ enabled: true });

  // GitHub's ping, with a redelivery, is recorded once.
  const delivery = randomUUID();
  const ping = await deliver(request, made.webhookUrl, secret, { delivery });
  expect(ping.status(), await ping.text()).toBe(200);
  expect(await ping.json()).toEqual({ ok: true, status: 'ok' });
  const again = await deliver(request, made.webhookUrl, secret, { delivery });
  expect(await again.json()).toEqual({ ok: true, duplicate: true });
  expect((await connection(request, owner, project.id))?.lastDelivery).toMatchObject({
    id: delivery,
    event: 'ping',
    status: 'ok',
    detail: null,
  });

  // Unhandled events are verified and ignored; refusals say why.
  const push = await deliver(request, made.webhookUrl, secret, { event: 'push' });
  expect(push.status()).toBe(202);
  expect(
    (
      await deliver(request, made.webhookUrl, secret, { signature: `sha256=${'0'.repeat(64)}` })
    ).status(),
  ).toBe(401);
  expect((await connection(request, owner, project.id))?.lastDelivery).toMatchObject({
    status: 'error',
    detail: expect.stringMatching(/signature did not match/),
  });
  expect(
    (await deliver(request, made.webhookUrl, secret, { repository: 'octo-org/other' })).status(),
  ).toBe(422);
  expect(
    (await deliver(request, made.webhookUrl, secret, { repository: 'Octo-Org/Website' })).status(),
  ).toBe(200);

  // A new secret refuses the old one; a new URL retires the old address.
  const rotated = githubConnectionSecretResponseSchema.parse(
    await (await request.post(managed(project.id, '/secret'), { headers: owner.headers })).json(),
  );
  expect(rotated.secret).not.toBe(secret);
  expect((await deliver(request, made.webhookUrl, secret)).status()).toBe(401);
  expect((await deliver(request, made.webhookUrl, rotated.secret)).status()).toBe(200);
  const moved = githubConnectionResponseSchema.parse(
    await (await request.post(managed(project.id, '/url'), { headers: owner.headers })).json(),
  ).connection!;
  expect(moved.webhookUrl).not.toBe(made.webhookUrl);
  expect((await deliver(request, made.webhookUrl, rotated.secret)).status()).toBe(404);
  expect((await deliver(request, moved.webhookUrl, rotated.secret)).status()).toBe(200);

  // Off: recorded and ignored. Webhook-only forgets the token.
  const off = await request.patch(managed(project.id), {
    headers: owner.headers,
    data: { enabled: false, authMode: 'webhook' },
  });
  expect(githubConnectionResponseSchema.parse(await off.json()).connection).toMatchObject({
    enabled: false,
    authMode: 'webhook',
    hasToken: false,
  });
  const quiet = await deliver(request, moved.webhookUrl, rotated.secret);
  expect(quiet.status()).toBe(202);
  expect(await quiet.json()).toMatchObject({ status: 'ignored', reason: 'The connection is off.' });
  expect(
    (
      await request.patch(managed(project.id), {
        headers: owner.headers,
        data: { authMode: 'token' },
      })
    ).status(),
  ).toBe(400);

  expect((await request.delete(managed(project.id), { headers: owner.headers })).status()).toBe(
    204,
  );
  expect(await connection(request, owner, project.id)).toBeNull();
  expect((await deliver(request, moved.webhookUrl, rotated.secret)).status()).toBe(404);
});

async function openGithubPage(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByRole('button', { name: /^Settings page: / }).click();
    await page
      .getByRole('dialog', { name: 'Settings', exact: true })
      .getByRole('link', { name: 'GitHub', exact: true })
      .click();
  } else
    await page
      .getByRole('navigation', { name: 'Settings pages' })
      .getByRole('link', { name: 'GitHub', exact: true })
      .click({ timeout: APP_LOAD_TIMEOUT });
  await expect(page).toHaveURL(/section=github/);
}

test('connect a repository in project settings and see GitHub’s ping', async ({
  page,
  isMobile,
}) => {
  const account = await signUp(page);
  const project = await makeProject(page.request, account);
  await page.goto(`/w/${project.workspaceId}/p/${project.id}/settings`);
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Linked', {
    timeout: APP_LOAD_TIMEOUT,
  });
  await openGithubPage(page, isMobile);

  await page.getByRole('textbox', { name: 'Repository' }).fill('octo-org/website');
  await expect(page.getByLabel('Personal access token', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Connect repository' }).click();
  const setup = page.getByRole('dialog', { name: 'Add the webhook on GitHub' });
  const url = await setup.getByRole('textbox', { name: 'Payload URL' }).inputValue();
  const secret = await setup.getByRole('textbox', { name: 'Secret' }).inputValue();
  expect(url).toMatch(/\/api\/integrations\/github\/webhooks\/[\w-]{32}$/);
  expect(secret).toMatch(/^throw_ghsec_/);
  await setup.getByRole('button', { name: 'Done' }).click();
  await expect(setup).toBeHidden();

  await expect(page.getByText('octo-org/website', { exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'No deliveries yet' })).toBeVisible();
  expect((await deliver(page.request, url, secret)).status()).toBe(200);
  await page.getByRole('button', { name: 'Check for new deliveries' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Received ping/ })).toBeVisible();

  // The secret is not shown again after a reload.
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: /^Received ping/ })).toBeVisible({
    timeout: APP_LOAD_TIMEOUT,
  });
  await expect(page.getByRole('textbox', { name: 'Secret' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Payload URL' })).toHaveValue(url);

  await page.getByRole('button', { name: 'Disconnect GitHub' }).click();
  await page
    .getByRole('dialog', { name: 'Disconnect octo-org/website?' })
    .getByRole('button', { name: 'Disconnect' })
    .click();
  await expect(page.getByRole('button', { name: 'Connect repository' })).toBeVisible();
  expect((await deliver(page.request, url, secret)).status()).toBe(404);
});
