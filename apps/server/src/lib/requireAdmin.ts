import { eq, sql } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../context';
import { db, type Transaction } from '../db/client';
import { user } from '../db/schema';

export async function isAdmin(userId: string, queryable: typeof db | Transaction = db) {
  const [current] = await queryable
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, userId));
  return current?.role === 'admin';
}

/** Serialize admin edits and recheck an actor who may have been demoted while waiting. */
export async function lockAdminMutation(tx: Transaction, actorId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('throw-admin-roles'))`);
  return isAdmin(actorId, tx);
}

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const signedIn = c.get('user');
  if (!signedIn) return c.json({ error: 'Unauthorized' }, 401);
  // Roles can change while a session is open; the database is the authority.
  if (!(await isAdmin(signedIn.id))) return c.json({ error: 'Admin access required' }, 403);
  await next();
});
