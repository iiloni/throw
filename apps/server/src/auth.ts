import { AsyncLocalStorage } from 'node:async_hooks';
import { defineRequestState } from '@better-auth/core/context';
import { INVITE_HEADER } from '@throw/shared';
import { type BetterAuthOptions, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { bearer } from 'better-auth/plugins/bearer';
import { and, eq, sql } from 'drizzle-orm';
import { db, type Transaction } from './db/client';
import * as schema from './db/schema';
import { env, NATIVE_APP_ORIGINS } from './env';
import { CLIENT_IP_HEADER } from './lib/clientIp';
import { claimInvite, recordInvitedUser } from './lib/invites';
import { createDefaultWorkspace } from './lib/workspaces';

// The digest Better Auth actually verified for this request, kept until session creation.
const verifiedCredential = defineRequestState<string | null>(() => null);

// Share Better Auth's transaction with signup hooks, including direct API calls from the seed.
const authTransaction = new AsyncLocalStorage<Transaction>();
function currentTransaction() {
  const tx = authTransaction.getStore();
  if (!tx) throw new Error('Signup requires a database transaction');
  return tx;
}

async function recordLogin(
  queryable: typeof db | Transaction,
  session: { userId: string; createdAt: Date },
) {
  await queryable
    .update(schema.user)
    .set({
      lastLoginAt: sql`greatest(${schema.user.lastLoginAt}, ${session.createdAt.toISOString()}::timestamptz)`,
    })
    .where(eq(schema.user.id, session.userId));
}

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  basePath: '/api/auth',
  trustedOrigins: [...NATIVE_APP_ORIGINS, ...env.TRUSTED_ORIGINS],
  database: (options: BetterAuthOptions) => {
    const config = { provider: 'pg' as const, schema };
    const adapter = drizzleAdapter(db, config)(options);
    adapter.transaction = (run) =>
      db.transaction((tx) =>
        authTransaction.run(tx, () => run(drizzleAdapter(tx, config)(options))),
      );
    return adapter;
  },
  rateLimit: { enabled: env.NODE_ENV === 'production' && env.AUTH_RATE_LIMIT },
  // The rate limit goes by the address `app.ts` reads from the connection, never by a
  // forwarding header as the client sent it.
  advanced: { ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] } },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    password: {
      hash: hashPassword,
      verify: async (credentials) => {
        const valid = await verifyPassword(credentials);
        if (valid) await verifiedCredential.set(credentials.hash);
        return valid;
      },
    },
  },
  user: {
    additionalFields: {
      role: { type: 'string', defaultValue: 'user', input: false },
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session, context) => {
          // Keep every signup write inside the transaction, including the first login date.
          if (context?.path === '/sign-up/email') await recordLogin(currentTransaction(), session);
        },
        after: async (session, context) => {
          if (context?.path === '/sign-up/email' || context?.path === '/change-password') return;
          if (context?.path === '/sign-in/email') {
            // The session row now exists, but its token has not been issued. A reset that
            // committed before insertion changed the digest. A later reset deletes the row.
            const [credential] = await db
              .select({ hash: schema.account.password })
              .from(schema.account)
              .where(
                and(
                  eq(schema.account.userId, session.userId),
                  eq(schema.account.accountId, session.userId),
                  eq(schema.account.providerId, 'credential'),
                ),
              );
            if (!credential?.hash || credential.hash !== (await verifiedCredential.get())) {
              await db.delete(schema.session).where(eq(schema.session.id, session.id));
              throw new APIError('UNAUTHORIZED', { message: 'Invalid email or password' });
            }
          }
          await recordLogin(db, session);
        },
      },
    },
    account: {
      create: {
        before: async (account, context) => {
          if (context?.path !== '/sign-up/email') return;
          const tx = currentTransaction();
          const token = context.headers?.get(INVITE_HEADER);
          if (token) await recordInvitedUser(tx, token, account.userId);
          await createDefaultWorkspace(tx, account.userId);
        },
      },
    },
    user: {
      create: {
        // The first account on a self-hosted instance becomes its admin.
        before: async (user, context) => {
          const tx = currentTransaction();
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('throw-registration'))`);
          const [existing] = await tx.select({ id: schema.user.id }).from(schema.user).limit(1);
          const first = !existing;
          if (!first && env.REGISTRATION === 'closed') {
            throw new APIError('FORBIDDEN', {
              message: 'This server is not accepting new accounts.',
            });
          }
          const token = context?.headers?.get(INVITE_HEADER);
          if (token != null) {
            if (!(await claimInvite(tx, token))) {
              throw new APIError('FORBIDDEN', {
                message: 'This invite is invalid, expired or already used.',
              });
            }
          } else if (!first && env.REGISTRATION === 'invite') {
            throw new APIError('FORBIDDEN', { message: 'Ask the server admin for an invite.' });
          }
          return { data: { ...user, role: first ? 'admin' : 'user' } };
        },
      },
    },
  },
  // The Android app runs on a different origin than the server, so it
  // authenticates with a bearer token instead of cookies. Only the signed token a sign-in
  // returns is accepted: the bare one in the session table (and so in a database dump)
  // signs nobody in.
  plugins: [bearer({ requireSignature: true })],
});

export type AuthSession = typeof auth.$Infer.Session;
