import type { VersionInfo } from '@throw/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { env } from '../env';
import { listReleases } from '../lib/releases';
import { requireUser } from '../lib/requireUser';

export const updateRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .get('/', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({
      version: env.THROW_VERSION || null,
      channel: env.THROW_CHANNEL,
    } satisfies VersionInfo);
  })
  .get('/releases', async (c) => {
    try {
      return c.json(await listReleases(env.THROW_CHANNEL));
    } catch {
      return c.json({ error: 'Could not load releases from GitHub. Try again.' }, 502);
    }
  });
