import { createHmac, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { githubReleaseSchema } from '../packages/shared/src/github';
import { STARTER_STATUSES } from '../packages/shared/src/statuses';
import { createAccount, shapeRows } from './helpers';

test('manual releases and lightweight tags survive disconnect and stay project scoped @api', async ({
  request,
}) => {
  const { headers } = await createAccount(request);
  const stranger = await createAccount(request);
  const [workspace] = await shapeRows(request, 'workspaces', headers);
  const projectId = randomUUID();
  expect(
    (
      await request.post('/api/projects', {
        headers,
        data: {
          id: projectId,
          workspaceId: workspace!.id,
          key: 'REL',
          name: 'Release tests',
          color: 'teal',
          position: 'a0',
          icon: null,
          statuses: STARTER_STATUSES.map((status) => ({
            ...status,
            id: randomUUID(),
            position: 'a0',
            isDefault: true,
          })),
        },
      })
    ).status(),
  ).toBe(201);
  const base = `/api/integrations/github/projects/${projectId}`;
  const path = `${base}/releases`;
  const manual = { repo: 'Octo/Repo', tagName: 'v0', isDraft: true };
  expect((await request.post(path, { headers: stranger.headers, data: manual })).status()).toBe(
    404,
  );
  const response = await request.post(path, { headers, data: manual });
  expect(response.status()).toBe(201);
  expect(githubReleaseSchema.parse(await response.json())).toMatchObject({
    isDraft: true,
    publishedAt: null,
    repo: 'octo/repo',
  });
  expect((await request.post(path, { headers, data: manual })).status()).toBe(409);
  const connected = await request.post(base, { headers, data: { repository: 'Octo/Repo' } });
  const { secret, connection } = await connected.json();
  const body = JSON.stringify({
    repository: { full_name: 'octo/repo' },
    ref: 'refs/tags/v1',
    after: 'a'.repeat(40),
    deleted: false,
  });
  const push = await request.post(new URL(connection.webhookUrl).pathname, {
    data: body,
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'push',
      'X-GitHub-Delivery': randomUUID(),
      'X-Hub-Signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    },
  });
  expect(push.status()).toBe(200);
  expect((await request.delete(base, { headers })).status()).toBe(204);
  expect((await (await request.get(path, { headers })).json()).releases).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ source: 'tag', tagName: 'v1' }),
      expect.objectContaining({ source: 'manual', tagName: 'v0' }),
    ]),
  );
  expect((await request.get(path, { headers: stranger.headers })).status()).toBe(404);
});
