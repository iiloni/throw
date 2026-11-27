import { parseArgs } from 'node:util';
import { GITHUB_WEBHOOK_PATH } from '@throw/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, sql } from '../db/client';
import { githubConnections, projects, user } from '../db/schema';
import { env } from '../env';
import { memberWorkspaces } from '../lib/workspaces';
import { demoRepository, demoSecret, signedDelivery, simulatedEvent } from './githubEvents';

async function demoToken() {
  const [admin] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, 'admin@example.com'));
  const [connection] = admin
    ? await db
        .select({ token: githubConnections.webhookToken })
        .from(githubConnections)
        .innerJoin(projects, eq(projects.id, githubConnections.projectId))
        .where(
          and(
            inArray(projects.workspaceId, memberWorkspaces(db, admin.id)),
            eq(projects.name, 'Throw'),
            isNull(projects.deletedAt),
          ),
        )
    : [];
  if (!connection)
    throw new Error(
      'No connected demo Throw project. Use a fresh demo seed or supply --token, --secret and --repo.',
    );
  return connection.token;
}

try {
  const {
    values,
    positionals: [command, task, ...extra],
  } = parseArgs({
    allowPositionals: true,
    options: {
      url: { type: 'string' },
      token: { type: 'string' },
      secret: { type: 'string' },
      repo: { type: 'string' },
      pr: { type: 'string' },
      issue: { type: 'string' },
      tag: { type: 'string' },
    },
  });
  if (!command || extra.length)
    throw new Error('Usage: github-sim EVENT [TASK] [options]. See ./scripts/dev.sh help.');
  const event = simulatedEvent(command, values.repo ?? demoRepository, task, {
    pr: values.pr === undefined ? undefined : Number(values.pr),
    issue: values.issue === undefined ? undefined : Number(values.issue),
    tag: values.tag,
  });
  const token = values.token ?? (await demoToken());
  // Compose exec targets this checkout, including when its public hostname is unreachable inside Docker.
  const url = new URL(
    `${GITHUB_WEBHOOK_PATH}/${encodeURIComponent(token)}`,
    values.url ?? `http://127.0.0.1:${env.PORT}`,
  );
  const response = await fetch(
    url,
    signedDelivery(event, values.secret ?? demoSecret(env.BETTER_AUTH_SECRET)),
  );
  console.log(response.status, await response.text());
  if (response.status !== 200) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
