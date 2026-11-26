import { GITHUB_WEBHOOK_PATH } from '@throw/shared';
import { env } from '../env';
import { githubSecretKey as keyFor } from './secrets';

export const githubSecretKey = keyFor(env.BETTER_AUTH_SECRET);

/** The address GitHub posts to, on the server's public URL. */
export const githubWebhookUrl = (token: string) =>
  new URL(`${GITHUB_WEBHOOK_PATH}/${token}`, env.BETTER_AUTH_URL).toString();
