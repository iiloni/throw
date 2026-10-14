import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { tags } from '../db/schema';
import { memberWorkspaces } from './workspaces';

/** Always acquire before task/project row locks, including creates and purges. */
export async function lockTagTree(tx: Transaction, projectId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`tags/${projectId}`}, 0))`);
}
export function projectTags(tx: Transaction, userId: string, projectId: string) {
  return tx
    .select()
    .from(tags)
    .where(
      and(eq(tags.projectId, projectId), inArray(tags.workspaceId, memberWorkspaces(tx, userId))),
    );
}
