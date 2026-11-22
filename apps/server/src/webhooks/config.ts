import { env } from '../env';
import { policyFrom } from './policy';
import { secretKey } from './signing';

export const webhookPolicy = policyFrom(env);
export const webhookSecretKey = secretKey(env.BETTER_AUTH_SECRET);
